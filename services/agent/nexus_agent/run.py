"""Orquestación de un run: sesión → Runner → eventos AG-UI."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack
from typing import Any

import httpx
from nas.adk import Runner
from nas.adk.core.events.event import Event
from nas.adk.core.interrupts import ResumeEntry
from nas.adk.models.base_llm import BaseLlm
from nas.adk.protocols.mcp.client import MCPClient, MCPServerConfig
from nas.adk.sessions.in_memory_session_service import InMemorySessionService
from nas.adk.tools.base_tool import BaseTool

from .agui import AgUiMapper
from .bff import BffClient
from .build import build_agent, build_tools, build_user_message
from .contract import RunRequest
from .errors import ErrorCapture, describe_model_error
from .models import UnsupportedProvider, build_model
from .policy import PolicyCallback
from .settings import Settings
from .state import RunState

log = logging.getLogger("nexus_agent")

NEXUS_RESULT = "nexus.result"
APP_NAME = "nexus"
ModelFactory = Callable[..., BaseLlm]


def _usage(raw: dict[str, Any]) -> dict[str, int]:
    """Uso de tokens en el formato que persiste Nexus (input/output/total/cache)."""
    out = {
        "input": int(raw.get("input_tokens", 0) or 0),
        "output": int(raw.get("output_tokens", 0) or 0),
        "total": int(raw.get("total_tokens", 0) or 0),
    }
    if not out["total"]:
        out["total"] = out["input"] + out["output"]
    cached = raw.get("cache_read_tokens", raw.get("cached_tokens", 0))
    if cached:
        out["cache_read"] = int(cached)
    return out


def _seed_session(service: InMemorySessionService, req: RunRequest) -> str:
    session = service.create_session(APP_NAME, req.userId, req.threadId)
    if req.checkpoint is not None:
        session.events.extend(Event.model_validate(item) for item in req.checkpoint)
    else:
        for index, message in enumerate(req.history):
            session.events.append(
                Event(
                    author=message.role,
                    role=message.role,
                    content=message.content,
                    invocation_id=f"history-{index}",
                )
            )
    return session.id


def _interrupts(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for item in metrics.get("interrupts", []):
        payload = item.get("payload") or {}
        try:
            args = json.loads(item.get("args") or "{}")
        except ValueError:
            args = {}
        result.append(
            {
                # Para aprobaciones el id es el de la fila `approvals`; si no, el de la llamada.
                "id": payload.get("approvalId") or item["id"],
                "reason": item.get("reason", "input_required"),
                "toolCallId": item["toolCallId"],
                "toolName": item.get("toolName", ""),
                "args": args,
                "payload": payload,
            }
        )
    return result


async def _connect_connectors(
    req: RunRequest, stack: AsyncExitStack
) -> list[BaseTool]:
    tools: list[BaseTool] = []
    for connector in req.connectors:
        client = MCPClient(
            MCPServerConfig(
                url=connector.url,
                transport=connector.transport,
                headers=connector.headers,
                name_prefix=connector.name,
                allow_tools=connector.allowTools,
                timeout=20.0,
            )
        )
        try:
            await asyncio.wait_for(client.connect(), 25)
        except Exception as error:  # noqa: BLE001 - un conector caído no debe tumbar el run
            log.warning("conector %s no disponible (%s)", connector.name, type(error).__name__)
            continue
        stack.push_async_callback(client.close)
        tools.extend(client.get_adk_tools())
    return tools


async def run_stream(
    req: RunRequest,
    settings: Settings,
    *,
    model_factory: ModelFactory = build_model,
    http: httpx.AsyncClient | None = None,
    bff_http: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Genera los eventos AG-UI de un run y termina con un evento ``nexus.result``."""
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    state = RunState(emit=queue.put_nowait)
    bff = BffClient(req.bff, bff_http) if req.bff else None

    async with AsyncExitStack() as stack:
        if bff is not None:
            stack.push_async_callback(bff.aclose)

        async def produce() -> None:
            mapper = AgUiMapper(f"msg-{req.runId}")
            final_text, usage = "", {}
            terminal: Event | None = None
            try:
                try:
                    model = model_factory(req.model, session_id=req.threadId)
                except UnsupportedProvider as error:
                    raise RuntimeError(str(error)) from error
                stack.push_async_callback(model.aclose)

                tools = build_tools(req, state, bff, settings.searxng_url, http)
                tools += await _connect_connectors(req, stack)
                agent = build_agent(req, model, tools)

                service = InMemorySessionService()
                session_id = _seed_session(service, req)
                errors = ErrorCapture()
                limits = req.limits
                runner = Runner(
                    app_name=APP_NAME,
                    agent=agent,
                    session_service=service,
                    callbacks=[PolicyCallback(bff), errors],
                    max_model_calls=limits.maxModelCalls,
                    max_turns=limits.maxTurns,
                    timeout=limits.timeoutS,
                    max_total_tokens=limits.maxTotalTokens,
                    max_tool_result_chars=limits.maxToolResultChars,
                    max_context_tokens=limits.maxContextTokens,
                )

                resume = None
                message: str | None = build_user_message(req)
                if req.resume:
                    message = None
                    resume = [
                        ResumeEntry(r.callId, r.status, r.payload, r.reason) for r in req.resume
                    ]

                async for event in runner.run_async(
                    req.userId, session_id, message=message, stream=True, resume=resume
                ):
                    for out in mapper.feed(event):
                        queue.put_nowait(out)
                    if event.type == "message" and event.role == "assistant" and event.final:
                        final_text = event.content or ""
                        usage = event.metrics.get("total_usage", {})
                    elif event.type == "status" and event.final:
                        terminal = event
                        usage = event.metrics.get("total_usage", usage)

                for out in mapper.finish():
                    queue.put_nowait(out)
                state.announce_sources()

                result: dict[str, Any]
                if terminal is None:
                    result = {"outcome": "success", "finalText": final_text}
                elif terminal.status == "interrupted":
                    session = service.get_session(session_id)
                    result = {
                        "outcome": "interrupt",
                        "interrupts": _interrupts(terminal.metrics),
                        "checkpoint": [
                            e.model_dump(mode="json") for e in (session.events if session else [])
                        ],
                    }
                else:
                    result = {
                        "outcome": "error",
                        "message": describe_model_error(errors.error)
                        or terminal.content
                        or f"el run terminó con {terminal.status}",
                    }
                result.update(
                    usage=_usage(usage),
                    sources=state.sources.as_dicts(),
                    followups=state.followups,
                )
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.exception("run %s falló", req.runId)
                for out in mapper.finish():
                    queue.put_nowait(out)
                result = {
                    "outcome": "error",
                    "message": describe_model_error(error) or f"{type(error).__name__}: {error}",
                }
            queue.put_nowait({"type": "CUSTOM", "name": NEXUS_RESULT, "value": result})
            queue.put_nowait(None)

        producer = asyncio.create_task(produce())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            producer.cancel()
            await asyncio.gather(producer, return_exceptions=True)

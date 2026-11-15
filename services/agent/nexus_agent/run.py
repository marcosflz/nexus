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
from nas.adk.sessions.checkpoint import SessionCheckpoint
from nas.adk.sessions.in_memory_session_service import InMemorySessionService
from nas.adk.skills import SkillRuntime, create_skill_creator
from nas.adk.tools.base_tool import BaseTool
from nas.adk.tools.function_tool import FunctionTool
from nas.adk.ui import TextCallRecovery

from .agui import AgUiMapper
from .bff import BffClient
from .build import build_agent, build_tools, build_user_message
from .computer import (
    COMPUTER_TOOLS,
    WORKSPACE_TOOLS,
    ComputerUnavailable,
    ScreenStore,
    ScreenTool,
    ScreenVision,
    bot_connector,
    has_vision,
    require_vision,
)
from .contract import ConnectorSpec, RunRequest
from .errors import ErrorCapture, describe_model_error
from .models import UnsupportedProvider, build_model
from .policy import PolicyCallback
from .settings import Settings
from .skills import BffSkillDraft, BffSkillExecutor, BffSkillStore
from .state import RunState
from .tools.board import BoardTools

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
    if isinstance(req.checkpoint, SessionCheckpoint):
        req.checkpoint.restore(session)
    elif req.checkpoint is not None:
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
    connectors: list[ConnectorSpec], stack: AsyncExitStack
) -> list[BaseTool]:
    tools: list[BaseTool] = []
    for connector in connectors:
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


async def _computer_tools(
    req: RunRequest, stack: AsyncExitStack, store: ScreenStore
) -> list[BaseTool]:
    """Solo las herramientas del bot: lo demás se ejecutaría fuera de su contenedor."""
    tools = await _connect_connectors([bot_connector(req)], stack)
    if not tools:
        raise RuntimeError("No se pudo conectar con el escritorio del bot")
    return [
        ScreenTool(name=t.name, description=t.description, inner=t, store=store)
        if t.mcp_name in COMPUTER_TOOLS and t.mcp_name.startswith("desktop_")  # type: ignore[attr-defined]
        else t
        for t in tools
    ]


async def _room_tools(
    req: RunRequest, stack: AsyncExitStack, store: ScreenStore, bff: BffClient | None, vision: bool
) -> list[BaseTool]:
    """Turno de sala: el entorno del propio bot y el tablero. Nada que actúe fuera de su contenedor."""
    tools: list[BaseTool] = []
    try:
        connector = bot_connector(req, COMPUTER_TOOLS if vision else WORKSPACE_TOOLS)
        connected = await _connect_connectors([connector], stack)
    except ComputerUnavailable:
        # Sin su contenedor, el bot aún puede hablar y organizar el tablero.
        connected = []
    for tool in connected:
        name = tool.mcp_name  # type: ignore[attr-defined]
        tools.append(
            ScreenTool(name=tool.name, description=tool.description, inner=tool, store=store)
            if name.startswith("desktop_")
            else tool
        )
    if req.room is None or not req.room.board:
        return tools
    board = BoardTools(bff)
    tools += [
        FunctionTool(fn)
        for fn in (
            board.board_list,
            board.board_create_subtask,
            board.board_set_status,
            board.board_assign,
            board.board_add_blocker,
        )
    ]
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

        async def drive(connections: AsyncExitStack) -> None:
            mapper = AgUiMapper(f"msg-{req.runId}")
            final_text, usage = "", {}
            terminal: Event | None = None
            try:
                screens = ScreenStore()
                try:
                    base = model_factory(req.model, session_id=req.threadId)
                    vision = has_vision(base)
                    model: BaseLlm
                    if req.room is not None:
                        model = ScreenVision(inner=base, store=screens) if vision else TextCallRecovery(inner=base, reasoning_summary=True)
                    elif req.computer:
                        model = ScreenVision(inner=require_vision(base), store=screens)
                    else:
                        model = TextCallRecovery(inner=base, reasoning_summary=True)
                except UnsupportedProvider as error:
                    raise RuntimeError(str(error)) from error
                stack.push_async_callback(model.aclose)

                if req.room is not None:
                    tools = await _room_tools(req, connections, screens, bff, vision)
                elif req.computer:
                    tools = await _computer_tools(req, connections, screens)
                else:
                    tools = build_tools(req, state, bff, settings.searxng_url, http)
                    tools += await _connect_connectors(req.connectors, connections)
                if req.skillCreator:
                    if bff is None:
                        raise RuntimeError("Skill creator requires a draft backend")
                    agent = create_skill_creator(model, BffSkillDraft(bff))
                else:
                    agent = build_agent(req, model, tools)
                skills = SkillRuntime(
                    BffSkillStore(bff, req.skills),
                    BffSkillExecutor(bff) if req.skillScripts and not req.computer and req.room is None else None,
                    explicit=req.explicitSkills,
                ) if bff and req.skills and not req.skillCreator else None

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
                    skills=skills,
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
                        "checkpoint": SessionCheckpoint.from_session(session).model_dump(mode="json") if session else None,
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

        async def produce() -> None:
            # Una sesión MCP debe cerrarse en la misma tarea que la abrió (anyio lo exige).
            try:
                async with AsyncExitStack() as connections:
                    await drive(connections)
            except Exception:
                log.warning("run %s: error al cerrar sus conexiones", req.runId, exc_info=True)
            finally:
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

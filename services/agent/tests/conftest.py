from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from nas.adk.models.base_llm import BaseLlm, LlmRequest, LlmResponse, ToolCall

from nexus_agent.contract import RunRequest
from nexus_agent.security import sign
from nexus_agent.settings import Settings

SECRET = "test-secret"


class ScriptedLlm(BaseLlm):
    model: str = "scripted"
    script: list[Any]
    seen: list[list[dict[str, Any]]] = []  # noqa: RUF012 - pydantic copia el valor por instancia

    async def generate_content_async(self, request: LlmRequest) -> LlmResponse:
        self.seen.append(list(request.messages))
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def tool_call(call_id: str, name: str, **args: Any) -> ToolCall:
    return ToolCall(id=call_id, function={"name": name, "arguments": json.dumps(args)})


def asks(*calls: ToolCall) -> LlmResponse:
    return LlmResponse(tool_calls=list(calls), finish_reason="tool_calls", usage={"total_tokens": 10})


def says(text: str) -> LlmResponse:
    return LlmResponse(
        content=text, usage={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10}
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(secret=SECRET, searxng_url="http://searx:8080")


def make_request(**overrides: Any) -> RunRequest:
    data: dict[str, Any] = {
        "runId": "run-1",
        "threadId": "thread-1",
        "userId": "user-1",
        "model": {"provider": "openrouter", "model": "m", "apiKey": "sk-secret"},
        "userText": "hola",
        "bff": {"baseUrl": "http://app:3000", "runToken": "run-token"},
    }
    data.update(overrides)
    return RunRequest.model_validate(data)


def factory(llm: ScriptedLlm):
    return lambda spec, **kwargs: llm


def signed_headers(body: bytes, ts: str | None = None) -> dict[str, str]:
    import time

    stamp = ts or str(time.time())
    return {"Authorization": f"Bearer {SECRET}", "X-Nexus-Timestamp": stamp,
            "X-Nexus-Signature": sign(SECRET, stamp, body)}


def searx_and_bff(bff_handler=None, searx_results=None):
    """Un único transporte que atiende SearXNG y los callbacks internos del BFF."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "searx":
            return httpx.Response(200, json={"results": searx_results or []})
        if bff_handler is not None:
            return bff_handler(request)
        path = request.url.path
        if path.endswith("/policy"):
            return httpx.Response(200, json={"effect": "allow", "rule": "allow-web"})
        if path.endswith("/openui/validate"):
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))

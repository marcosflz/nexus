"""Computer use: qué llega al modelo y qué herramientas tiene a su alcance."""

import asyncio
import json
from types import SimpleNamespace
from typing import Any, ClassVar

import pytest
from nas.adk.models.base_llm import BaseLlm, LlmRequest, LlmResponse, ModelCapabilities
from nas.adk.models.claude_code.llm import ClaudeCodeLlm
from nas.adk.models.errors import LlmModelError
from pydantic import Field

from nexus_agent import run as run_module
from nexus_agent.computer import (
    COMPUTER_TOOLS,
    MAX_IMAGE_CHARS,
    ComputerUnavailable,
    ScreenStore,
    ScreenTool,
    ScreenVision,
    bot_connector,
    require_vision,
)
from nexus_agent.contract import ConnectorSpec, ModelSpec, RunRequest
from nexus_agent.settings import Settings

BOT_URL = "http://nexus-bot-11111111-2222-4333-8444-555555555555:8900/mcp"


def request(**overrides):
    base = {
        "runId": "r",
        "threadId": "t",
        "userId": "u",
        "computer": True,
        "userText": "hola",
        "model": ModelSpec(provider="x", model="m"),
        "connectors": [ConnectorSpec(id="b", name="nexbot", url=BOT_URL)],
    }
    return RunRequest(**{**base, **overrides})


def test_connector_is_forced_to_the_computer_tools():
    spec = bot_connector(request(connectors=[ConnectorSpec(id="b", name="nexbot", url=BOT_URL, allowTools=["shell_exec"])]))
    assert set(spec.allowTools) == COMPUTER_TOOLS
    assert "shell_exec" not in spec.allowTools and "browser_click" not in spec.allowTools


@pytest.mark.parametrize(
    "connectors",
    [
        [],
        [ConnectorSpec(id="o", name="correo", url="https://mcp.example.com/mcp")],
        [ConnectorSpec(id="b", name="nexbot", url="http://169.254.169.254:8900/mcp")],
        [ConnectorSpec(id="b", name="nexbot", url="http://nexus-agent:8090/mcp")],
    ],
)
def test_only_the_bots_own_endpoint_is_accepted(connectors):
    with pytest.raises(ComputerUnavailable):
        bot_connector(request(connectors=connectors))


def test_two_bot_connectors_are_rejected():
    connector = ConnectorSpec(id="b", name="nexbot", url=BOT_URL)
    with pytest.raises(ComputerUnavailable):
        bot_connector(request(connectors=[connector, connector]))


class Scripted(BaseLlm):
    seen: list = Field(default_factory=list)
    caps: ModelCapabilities | None = None

    def get_capabilities(self):
        return self.caps

    async def generate_content_async(self, req: LlmRequest) -> LlmResponse:
        self.seen.append(req)
        return LlmResponse(content="fin")


def test_a_model_without_vision_is_refused():
    with pytest.raises(ComputerUnavailable, match="visión"):
        require_vision(Scripted(caps=ModelCapabilities()))
    assert "image" not in ClaudeCodeLlm.capabilities.input_modalities


def test_undeclared_capabilities_are_left_to_the_provider():
    model = Scripted()
    assert require_vision(model) is model


def session(content):
    async def call_tool(name, args):
        return SimpleNamespace(content=content, isError=False)

    return SimpleNamespace(call_tool=call_tool)


class FakeInner:
    mcp_name = "desktop_click"

    def __init__(self, content):
        self.session = session(content)

    def _parameters_schema(self):
        return {"type": "object", "properties": {}}


def tool(content, store=None):
    return ScreenTool(name="nexbot__desktop_click", description="d", inner=FakeInner(content), store=store or ScreenStore())


TEXT = SimpleNamespace(type="text", text='{"ok": true}')


def image(data="QUJD", mime="image/jpeg"):
    return SimpleNamespace(type="image", data=data, mimeType=mime)


async def test_screenshot_is_kept_out_of_the_tool_result_text():
    store = ScreenStore()
    out = json.loads(await tool([TEXT, image()], store).run_async())
    assert out["ok"] is True and "QUJD" not in json.dumps(out)
    assert store.get(out["screen"]) == {"media_type": "image/jpeg", "data": "QUJD"}


@pytest.mark.parametrize("bad", [image(mime="image/svg+xml"), image(data="x" * (MAX_IMAGE_CHARS + 1))])
async def test_an_untrusted_image_is_refused(bad):
    out = json.loads(await tool([TEXT, bad]).run_async())
    assert "error" in out and "screen" not in out


async def test_errors_from_the_bot_pass_through():
    error = SimpleNamespace(type="text", text='{"error": "ocupado"}')
    assert json.loads(await tool([error]).run_async()) == {"error": "ocupado"}


async def test_the_model_receives_the_image_only_on_real_tool_results():
    store = ScreenStore()
    reference = store.add("image/jpeg", "QUJD")
    inner = Scripted(seen=[])
    model = ScreenVision(inner=inner, store=store)
    history = [
        {"role": "user", "content": json.dumps({"screen": reference})},
        {"role": "tool", "tool_call_id": "a", "content": json.dumps({"screen": reference})},
        {"role": "tool", "tool_call_id": "b", "content": json.dumps({"screen": "inventada"})},
        {"role": "tool", "tool_call_id": "c", "content": "texto"},
    ]
    await model.generate_content_async(LlmRequest(messages=history))

    sent = inner.seen[0].messages
    assert "images" not in sent[0]  # un texto del usuario no puede pedir capturas
    assert sent[1]["images"] == [{"media_type": "image/jpeg", "data": "QUJD"}]
    assert "images" not in sent[2] and "images" not in sent[3]
    assert "images" not in history[1]  # el historial del Runner no carga el base64


class TextOnly(BaseLlm):
    """Como OpenRouter con un modelo de solo texto: 404 en cuanto la petición lleva una imagen."""

    model: str = "solo-texto"
    seen: list[Any]
    status: int = 404
    supports_streaming: ClassVar[bool] = True

    def _check(self, request: LlmRequest) -> None:
        self.seen.append(request)
        if any(message.get("images") for message in request.messages):
            raise LlmModelError(f"openrouter returned HTTP {self.status}", status_code=self.status)

    async def generate_content_async(self, request: LlmRequest) -> LlmResponse:
        self._check(request)
        return LlmResponse(content="No veo la pantalla.", finish_reason="stop")

    async def generate_stream_async(self, request: LlmRequest):
        self._check(request)
        yield LlmResponse(content="No veo la pantalla.", type="delta")
        yield LlmResponse(content="No veo la pantalla.", finish_reason="stop")


def screen_history(store):
    reference = store.add("image/jpeg", "QUJD")
    return [
        {"role": "user", "content": "busca en youtube rtve"},
        {"role": "tool", "tool_call_id": "a", "content": json.dumps({"ok": True, "screen": reference})},
    ]


@pytest.mark.parametrize("streaming", [False, True])
async def test_a_text_only_model_is_told_it_cannot_see_instead_of_failing_the_run(streaming):
    """Run real: el bot abrió YouTube y el turno murió con «openrouter returned HTTP 404»."""
    store = ScreenStore()
    inner = TextOnly(seen=[])
    model = ScreenVision(inner=inner, store=store)
    request = LlmRequest(messages=screen_history(store))

    if streaming:
        chunks = [chunk async for chunk in model.generate_stream_async(request)]
        assert chunks[-1].content == "No veo la pantalla."
    else:
        assert (await model.generate_content_async(request)).content == "No veo la pantalla."

    first, retry = inner.seen
    assert first.messages[1]["images"]
    told = json.loads(retry.messages[1]["content"])
    assert "images" not in retry.messages[1] and told["ok"] is True and "visión" in told["aviso"]

    # Ya se sabe que no ve: las siguientes llamadas no vuelven a probar con la imagen.
    await model.generate_content_async(request)
    assert len(inner.seen) == 3 and "images" not in inner.seen[2].messages[1]


async def test_other_provider_errors_are_not_mistaken_for_a_model_without_vision():
    store = ScreenStore()
    inner = TextOnly(seen=[], status=429)
    model = ScreenVision(inner=inner, store=store)

    with pytest.raises(LlmModelError):
        await model.generate_content_async(LlmRequest(messages=screen_history(store)))
    assert len(inner.seen) == 1


async def collect(req, model, monkeypatch, tools):
    connected = []

    async def fake_connect(connectors, stack):
        connected.extend(connectors)
        return tools

    monkeypatch.setattr(run_module, "_connect_connectors", fake_connect)
    events = [e async for e in run_module.run_stream(req, Settings(), model_factory=lambda *a, **k: model)]
    return connected, events[-1]["value"]


async def test_a_computer_run_has_no_tool_that_acts_outside_the_bot(monkeypatch):
    from nas.adk.tools.function_tool import FunctionTool

    async def workspace_list() -> str:
        """Lista."""
        return "[]"

    inner = Scripted(seen=[])
    req = request(
        connectors=[
            ConnectorSpec(id="o", name="correo", url="https://mcp.example.com/mcp"),
            ConnectorSpec(id="b", name="nexbot", url=BOT_URL),
        ]
    )

    class Stub(FunctionTool):
        mcp_name: str = "workspace_list"

    stub = Stub(workspace_list)
    stub.name = "nexbot__workspace_list"
    connected, result = await collect(req, inner, monkeypatch, [stub])

    assert [c.name for c in connected] == ["nexbot"]
    assert result["outcome"] == "success"
    offered = [t["function"]["name"] for t in inner.seen[0].tools]
    assert offered == ["nexbot__workspace_list"]


async def test_without_the_desktop_the_run_fails_instead_of_continuing_blind(monkeypatch):
    _, result = await collect(request(), Scripted(seen=[]), monkeypatch, [])
    assert result["outcome"] == "error" and "escritorio" in result["message"]


async def test_vision_is_checked_before_connecting(monkeypatch):
    connected, result = await collect(request(), Scripted(seen=[], caps=ModelCapabilities()), monkeypatch, [])
    assert connected == [] and result["outcome"] == "error" and "visión" in result["message"]


async def test_mcp_connections_close_in_the_task_that_opened_them(monkeypatch):
    tasks = {}

    async def fake_connect(connectors, stack):
        tasks["opened"] = asyncio.current_task()

        async def close():
            tasks["closed"] = asyncio.current_task()

        stack.push_async_callback(close)
        return []

    monkeypatch.setattr(run_module, "_connect_connectors", fake_connect)
    req = request(computer=False, connectors=[])
    req.agent.tools = []
    events = [e async for e in run_module.run_stream(req, Settings(), model_factory=lambda *a, **k: Scripted(seen=[]))]

    assert events[-1]["value"]["outcome"] == "success"
    assert tasks["opened"] is tasks["closed"]

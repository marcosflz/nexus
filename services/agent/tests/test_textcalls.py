"""Regresión: el modelo escribió `present_openui(...)` como texto y nada se pintó.

Run real: `Card(children: [...])` fue rechazado sin pista, el modelo reescribió la
llamada en la respuesta y el usuario vio el programa en crudo.
"""

from __future__ import annotations

import json
from typing import Any, ClassVar

import httpx
from nas.adk.models.base_llm import BaseLlm, LlmRequest, LlmResponse
from nas.adk.ui import OpenUiTools

from nexus_agent.build import build_instruction
from nexus_agent.run import run_stream

from .conftest import ScriptedLlm, asks, factory, make_request, says, searx_and_bff, tool_call

GOOD = 'root = Card([LineChart(labels, series, "linear")])\nlabels = ["Ene"]\nseries = [Series("N", [1])]'
LEAKED_INVALID = (
    'present_openui({ui: "root = Card(children: [LineChart(labels, series, variant: '
    '\\\\\\"linear\\\\\\")]) \\\\n labels = [\\\\\\"Ene\\\\\\"] \\\\n series = '
    '[Series(\\\\\\"N\\\\\\", [1])]"})\n\n'
    "El gráfico muestra la evolución del índice.\n\n"
    'suggest_followups({\n "questions": ["¿Y en 2023?", "¿Y frente al S&P?"]\n})'
)


class StreamingLlm(BaseLlm):
    model: str = "streaming"
    script: list[Any]
    supports_streaming: ClassVar[bool] = True

    async def generate_content_async(self, request: LlmRequest) -> LlmResponse:
        raise AssertionError("debe usarse streaming")

    async def generate_stream_async(self, request: LlmRequest):
        step = self.script.pop(0)
        if isinstance(step, LlmResponse):
            yield step
            return
        for start in range(0, len(step), 7):
            yield LlmResponse(content=step[start : start + 7], type="delta")
        yield says(step)


def strict_bff():
    """Rechaza los argumentos con nombre, como el validador real."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/openui/validate"):
            ok = "children:" not in json.loads(request.content)["ui"]
            error = None if ok else "el programa no produce un componente raíz"
            return httpx.Response(200, json={"ok": ok, "error": error})
        return httpx.Response(404)

    return searx_and_bff(bff_handler=handler)


async def run(settings, llm, **overrides):
    client = strict_bff()
    req = make_request(ui={"requested": True, "profile": "full", "spec": "ESPEC"}, **overrides)
    return [
        e
        async for e in run_stream(
            req, settings, model_factory=factory(llm), http=client, bff_http=client
        )
    ]


def result_of(events):
    return next(e for e in events if e.get("name") == "nexus.result")["value"]


def shown_text(events):
    return "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")


def calls_of(events):
    return [e["toolCallName"] for e in events if e["type"] == "TOOL_CALL_START"]


def results_of(events):
    return [json.loads(e["content"]) for e in events if e["type"] == "TOOL_CALL_RESULT"]


async def test_a_call_written_as_text_runs_as_a_real_call_and_can_be_corrected(settings):
    llm = StreamingLlm(script=[LEAKED_INVALID, asks(tool_call("c2", "present_openui", ui=GOOD)), "Listo."])

    events = await run(settings, llm)

    # La llamada escrita pasa por la validación real, como herramienta, en orden.
    assert calls_of(events) == ["present_openui", "suggest_followups", "present_openui"]
    rejected, followups, painted = results_of(events)
    assert "error" in rejected and "posicionales" in rejected["error"]
    assert followups["count"] == 2
    assert painted == {"displayed": True}
    assert result_of(events)["followups"] == ["¿Y en 2023?", "¿Y frente al S&P?"]

    text = shown_text(events)
    assert text == "Listo."
    assert result_of(events)["finalText"] == "Listo."


async def test_the_double_escaped_program_is_decoded_before_validating(settings):
    program = {}

    def handler(request: httpx.Request) -> httpx.Response:
        program["ui"] = json.loads(request.content)["ui"]
        return httpx.Response(200, json={"ok": True})

    client = searx_and_bff(bff_handler=handler)
    llm = ScriptedLlm(script=[says(LEAKED_INVALID), says("Listo.")], seen=[])
    req = make_request(ui={"requested": True, "spec": "ESPEC"})
    _ = [
        e
        async for e in run_stream(
            req, settings, model_factory=factory(llm), http=client, bff_http=client
        )
    ]

    assert program["ui"].startswith('root = Card(children: [LineChart(labels, series, variant: "linear")])')
    assert '\\"' not in program["ui"] and "\n labels" in program["ui"]


async def test_an_invalid_program_is_never_shown_even_if_the_model_gives_up(settings):
    llm = StreamingLlm(script=[LEAKED_INVALID, "No he podido dibujar el gráfico."])

    events = await run(settings, llm, agent={"followups": False, "tools": ["present_openui"]})

    assert not any("displayed" in r for r in results_of(events))
    text = shown_text(events) + result_of(events)["finalText"]
    assert "children" not in text and "present_openui" not in text and "Card(" not in text
    assert "No he podido" in text


async def test_prose_before_the_call_stays_and_an_unclosed_call_disappears(settings):
    llm = StreamingLlm(script=['Aquí va:\npresent_openui({ui: "root = Card(['])

    events = await run(settings, llm)

    assert shown_text(events).strip() == "Aquí va:"
    assert calls_of(events) == []
    assert "present_openui" not in result_of(events)["finalText"]


async def test_prose_is_untouched_and_only_presentation_tools_are_recovered(settings):
    answer = (
        "Se dibuja con present_openui(ui) cuando hace falta.\n"
        'web_fetch({"url": "http://169.254.169.254/"})\n'
        "suggest_more() no existe."
    )
    llm = StreamingLlm(script=[answer])

    events = await run(settings, llm)

    assert shown_text(events) == answer
    assert calls_of(events) == []


async def test_nothing_is_recovered_for_a_tool_the_agent_does_not_have(settings):
    written = 'suggest_followups({"questions": ["a"]})'
    llm = ScriptedLlm(script=[says(written)], seen=[])

    events = await run(settings, llm, agent={"followups": False, "tools": []})

    assert calls_of(events) == []
    assert shown_text(events) == written


async def test_a_real_call_is_not_duplicated_by_the_same_call_in_the_text(settings):
    written = f"present_openui({json.dumps({'ui': GOOD})})"
    response = asks(tool_call("c1", "present_openui", ui=GOOD))
    response.content = written
    llm = ScriptedLlm(script=[response, says("Listo.")], seen=[])

    events = await run(settings, llm)

    assert calls_of(events) == ["present_openui"]
    assert shown_text(events) == "Listo."


def test_the_error_explains_named_arguments_but_not_for_object_keys():

    def validator(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": False, "error": "sin raíz"})

    from nexus_agent.bff import BffClient, BffOpenUiBackend
    from nexus_agent.contract import BffLink

    link = BffLink(baseUrl="http://app", runToken="t")
    bff = BffClient(link, httpx.AsyncClient(transport=httpx.MockTransport(validator)))
    ui = OpenUiTools(BffOpenUiBackend(bff))

    async def error(program: str) -> str:
        return json.loads(await ui.present_openui(program))["error"]

    import asyncio

    named = asyncio.run(error('root = Card(children: [TextContent("a: b")])'))
    assert "posicionales" in named and "no escribas la llamada" in named
    plain = asyncio.run(error('root = Card([x], {title: "a: b"})'))
    assert "posicionales" not in plain and "no escribas la llamada" in plain


def test_the_prompt_forbids_writing_tool_calls_and_named_arguments():
    tools = {"present_openui", "prompt_openui", "suggest_followups"}
    text = build_instruction(make_request(ui={"requested": True, "spec": "ESPEC"}), tools)
    assert "llamada de herramienta real" in text
    assert "POSICIONALES" in text and "Card(children" in text
    assert "Nunca inventes cifras" in text

    without_tools = build_instruction(make_request(), set())
    assert "llamada de herramienta real" not in without_tools


# Run real (nemotron): la respuesta entera fue el programa, sin llamada ni bloque cercado.
BARE = (
    "root = Card([\n"
    'TextContent("No se pudieron obtener las noticias de Nasdaq para hoy debido a limitaciones técnicas."),\n'
    "followUpBlock\n"
    "])\n"
    "\n"
    'item1 = FollowUpItem("¿Qué movimientos hubo en el mercado?")\n'
    'item2 = FollowUpItem("Noticias de tecnología y IA")\n'
    "followUpBlock = FollowUpBlock([item1, item2])"
)


async def test_a_bare_program_in_the_answer_is_painted_instead_of_shown(settings):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["ui"] = json.loads(request.content)["ui"]
        return httpx.Response(200, json={"ok": True})

    client = searx_and_bff(bff_handler=handler)
    llm = StreamingLlm(script=[BARE, "Listo."])
    req = make_request(ui={"requested": True, "spec": "ESPEC"}, agent={"followups": False, "tools": ["present_openui"]})
    events = [
        e async for e in run_stream(req, settings, model_factory=factory(llm), http=client, bff_http=client)
    ]

    assert calls_of(events) == ["present_openui"]
    assert results_of(events) == [{"displayed": True}]
    assert seen["ui"] == BARE
    assert shown_text(events) == "Listo."


async def test_a_fenced_program_keeps_its_prose_and_loses_the_fence(settings):
    text = f"Aquí tienes el resumen:\n\n```openui\n{BARE}\n```\n"
    llm = StreamingLlm(script=[text, "Listo."])

    events = await run(settings, llm, agent={"followups": False, "tools": ["present_openui"]})

    assert calls_of(events) == ["present_openui"]
    shown = shown_text(events)
    assert shown.startswith("Aquí tienes el resumen:") and "```" not in shown and "Card(" not in shown


async def test_code_that_merely_looks_like_a_program_is_left_alone(settings):
    code = "Usa esto:\n\n```python\nroot = Node(1)\nleft = Node(2)\n```\n\nY `root = x` va en línea."
    llm = StreamingLlm(script=[code])

    events = await run(settings, llm, agent={"followups": False, "tools": ["present_openui"]})

    assert calls_of(events) == []
    assert shown_text(events) == code


# Run real: el programa entero en una sola línea. Se recuperaba como llamada, pero mientras
# llegaba (sin salto de línea aún) se le enseñaba al usuario en crudo.
ONE_LINE = (
    'root = Card([CardHeader(title="Nasdaq", subtitle="Hoy"), TextContent("Sube un 3 %.[1]", "default"), '
    'Separator()], sources=[{title="NHK", sourceName="note.com", url="https://note.com/n"}])\n\n'
)


async def test_a_one_line_program_never_reaches_the_user_while_streaming(settings):
    llm = StreamingLlm(script=[ONE_LINE, "Listo."])

    events = await run(settings, llm, agent={"followups": False, "tools": ["present_openui"]})

    assert calls_of(events) == ["present_openui"]
    assert shown_text(events) == "Listo."

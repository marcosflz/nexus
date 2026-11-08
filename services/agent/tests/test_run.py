from __future__ import annotations

import json

import httpx

from nexus_agent.run import run_stream

from .conftest import ScriptedLlm, asks, factory, make_request, says, searx_and_bff, tool_call


async def collect(req, settings, llm, client):
    return [
        e
        async for e in run_stream(
            req, settings, model_factory=factory(llm), http=client, bff_http=client
        )
    ]


def result_of(events):
    return next(e for e in events if e.get("name") == "nexus.result")["value"]


def types(events):
    return [e["type"] for e in events]


async def test_a_search_turn_streams_tool_events_then_text_and_a_success_result(settings):
    llm = ScriptedLlm(
        script=[
            asks(tool_call("c1", "web_search", query="bun js")),
            says("Bun es un runtime [1].\n\n## Sources\n[1] Bun — https://bun.sh"),
        ],
        seen=[],
    )
    client = searx_and_bff(searx_results=[{"title": "Bun", "url": "https://bun.sh", "content": "x"}])

    events = await collect(make_request(), settings, llm, client)

    kinds = types(events)
    assert kinds.index("TOOL_CALL_START") < kinds.index("TOOL_CALL_RESULT") < kinds.index(
        "TEXT_MESSAGE_START"
    )
    result = result_of(events)
    assert result["outcome"] == "success"
    assert result["finalText"].startswith("Bun es un runtime [1]")
    assert result["sources"] == [
        {"id": 1, "url": "https://bun.sh", "domain": "bun.sh", "title": "Bun"}
    ]
    assert result["usage"]["total"] == 20  # dos llamadas al modelo
    # Las fuentes se anuncian en vivo, antes del resultado final.
    assert any(e.get("name") == "nexus.sources" for e in events)
    # El run termina con el resultado y nada después.
    assert events[-1].get("name") == "nexus.result"


async def test_history_and_attachments_reach_the_model(settings):
    llm = ScriptedLlm(script=[says("ok")], seen=[])
    req = make_request(
        history=[{"role": "user", "content": "antes"}, {"role": "assistant", "content": "respuesta"}],
        attachments=[{"name": "n.txt", "text": "CONTENIDO"}],
    )

    await collect(req, settings, llm, searx_and_bff())

    sent = llm.seen[0]
    assert sent[0]["role"] == "system" and "Hoy es" in sent[0]["content"]
    assert [m["content"] for m in sent[1:3]] == ["antes", "respuesta"]
    assert "CONTENIDO" in sent[-1]["content"] and sent[-1]["content"].rstrip().endswith("hola")


async def test_custom_instructions_and_role_are_part_of_the_system_prompt(settings):
    llm = ScriptedLlm(script=[says("ok")], seen=[])
    req = make_request(agent={"name": "Fiscal", "role": "asesor fiscal", "instructions": "Habla de IVA."})

    await collect(req, settings, llm, searx_and_bff())

    system = llm.seen[0][0]["content"]
    assert "Fiscal" in system and "asesor fiscal" in system and "Habla de IVA." in system


async def test_prompt_openui_pauses_and_resumes_from_the_checkpoint(settings):
    form = "root = Form([])"
    first_llm = ScriptedLlm(script=[asks(tool_call("c1", "prompt_openui", ui=form))], seen=[])
    client = searx_and_bff()

    paused = await collect(make_request(), settings, first_llm, client)

    result = result_of(paused)
    assert result["outcome"] == "interrupt"
    interrupt = result["interrupts"][0]
    assert interrupt["reason"] == "openui_form" and interrupt["toolCallId"] == "c1"
    assert interrupt["args"] == {"ui": form}
    assert not [e for e in paused if e["type"] == "TOOL_CALL_RESULT"]  # sigue pendiente
    assert result["checkpoint"], "el sidecar devuelve la sesión para poder reanudar"

    # Segunda petición: sin estado en el sidecar, solo con el checkpoint que devolvió.
    second_llm = ScriptedLlm(script=[says("Viaje a Lisboa")], seen=[])
    resumed = await collect(
        make_request(
            userText=None,
            checkpoint=result["checkpoint"],
            resume=[{"callId": "c1", "status": "resolved", "payload": {"destino": "Lisboa"}}],
        ),
        settings,
        second_llm,
        client,
    )

    assert result_of(resumed)["outcome"] == "success"
    tool_result = next(e for e in resumed if e["type"] == "TOOL_CALL_RESULT")
    assert json.loads(tool_result["content"]) == {"destino": "Lisboa"}
    # El modelo ve el formulario que se mostró y la respuesta del usuario.
    assert [m["role"] for m in second_llm.seen[0][-2:]] == ["assistant", "tool"]


async def test_policy_ask_creates_an_approval_interrupt_then_runs_when_approved(settings):
    def bff(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/policy"):
            tool = json.loads(request.content)["tool"]
            if tool == "web_fetch":
                return httpx.Response(
                    200, json={"effect": "ask", "rule": "ask-x", "approvalId": "ap-1", "reason": "r"}
                )
        return httpx.Response(200, json={"effect": "allow", "ok": True})

    client = searx_and_bff(bff)
    llm = ScriptedLlm(script=[asks(tool_call("c1", "web_fetch", url="https://example.com"))], seen=[])

    paused = await collect(make_request(), settings, llm, client)

    result = result_of(paused)
    assert result["outcome"] == "interrupt"
    assert result["interrupts"][0]["id"] == "ap-1"  # el id de la aprobación, no el de la llamada
    assert result["interrupts"][0]["reason"] == "approval"
    assert result["interrupts"][0]["payload"]["rule"] == "ask-x"
    # No se ejecutó nada: no hay resultado de herramienta.
    assert not [e for e in paused if e["type"] == "TOOL_CALL_RESULT"]


async def test_a_denied_policy_gives_the_model_an_error_and_the_run_continues(settings):
    def bff(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"effect": "deny", "reason": "host privado"})

    llm = ScriptedLlm(
        script=[asks(tool_call("c1", "web_search", query="x")), says("No pude buscar.")], seen=[]
    )

    events = await collect(make_request(), settings, llm, searx_and_bff(bff))

    tool_result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    assert "host privado" in tool_result["content"] and tool_result["metadata"]["isError"]
    assert result_of(events)["outcome"] == "success"


async def test_policy_fails_closed_when_the_bff_is_unreachable(settings):
    def bff(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("caído")

    llm = ScriptedLlm(
        script=[asks(tool_call("c1", "web_search", query="x")), says("fin")], seen=[]
    )
    events = await collect(make_request(), settings, llm, searx_and_bff(bff))

    tool_result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    assert "no se pudo evaluar la política" in tool_result["content"]


async def test_model_failures_become_an_error_result_without_leaking_the_api_key(settings):
    llm = ScriptedLlm(script=[RuntimeError("fallo del proveedor")], seen=[])

    events = await collect(make_request(), settings, llm, searx_and_bff())

    result = result_of(events)
    assert result["outcome"] == "error" and "fallo del proveedor" in result["message"]
    assert "sk-secret" not in json.dumps(events)


async def test_unsupported_providers_are_reported_cleanly(settings):
    req = make_request(model={"provider": "inventado", "model": "m"})
    events = [e async for e in run_stream(req, settings, http=searx_and_bff(), bff_http=searx_and_bff())]
    assert result_of(events)["outcome"] == "error"
    assert "inventado" in result_of(events)["message"]


async def test_tools_are_filtered_by_the_agent_spec(settings):
    llm = ScriptedLlm(script=[says("ok")], seen=[])
    req = make_request(agent={"tools": ["web_search"], "followups": False, "ui": {"openui": "off"}})

    await collect(req, settings, llm, searx_and_bff())

    from nexus_agent.build import build_tools
    from nexus_agent.state import RunState

    names = {t.name for t in build_tools(req, RunState(emit=lambda e: None), None, "http://s")}
    assert names == {"web_search"}


async def test_knowledge_and_memory_are_added_only_when_enabled():
    from nexus_agent.build import build_tools
    from nexus_agent.state import RunState

    state = RunState(emit=lambda e: None)
    plain = {t.name for t in build_tools(make_request(), state, None, "http://s")}
    assert "knowledge_search" not in plain and "remember" not in plain

    rich = {
        t.name
        for t in build_tools(
            make_request(agent={"knowledgeEnabled": True, "memoryEnabled": True}), state, None, "http://s"
        )
    }
    assert {"knowledge_search", "remember", "recall", "forget"} <= rich


def test_the_ui_request_and_spec_reach_the_instruction():
    from nexus_agent.build import build_instruction

    tools = {"present_openui", "prompt_openui", "openui_spec"}
    plain = build_instruction(make_request(), tools)
    assert "Antes de terminar DEBES" not in plain
    assert "Especificación de OpenUI" not in plain

    asked = build_instruction(
        make_request(ui={"requested": True, "profile": "full", "spec": "root = Card([...])"}), tools
    )
    assert "Antes de terminar DEBES" in asked
    assert "perfil full" in asked and "root = Card([...])" in asked

    off = build_instruction(
        make_request(agent={"ui": {"openui": "off"}}, ui={"requested": True, "spec": "x"}), set()
    )
    assert "present_openui" not in off


def test_inline_spec_drops_the_openui_spec_tool_and_the_context_budget_is_configurable():
    from nexus_agent.build import build_tools
    from nexus_agent.state import RunState

    state = RunState(emit=lambda e: None)
    plain = {t.name for t in build_tools(make_request(), state, None, "http://s")}
    assert "openui_spec" in plain

    inline = {
        t.name for t in build_tools(make_request(ui={"spec": "root = Card([])"}), state, None, "http://s")
    }
    assert "openui_spec" not in inline and "present_openui" in inline

    assert make_request().limits.maxContextTokens == 64000
    assert make_request(limits={"maxContextTokens": 100000}).limits.maxContextTokens == 100000


def test_turn_instructions_from_the_bff_reach_the_system_prompt():
    from nexus_agent.build import build_instruction

    text = build_instruction(make_request(turnInstructions="Modo Research: informe."), set())
    assert "Para esta pregunta:\nModo Research: informe." in text
    assert "Para esta pregunta" not in build_instruction(make_request(), set())

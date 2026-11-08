import json

import httpx
import pytest
from nas.adk.core.interrupts import ToolInterrupt

from nexus_agent.bff import BffClient, BffError
from nexus_agent.contract import BffLink
from nexus_agent.state import RunState
from nexus_agent.tools.ui import FollowupTools, UiTools
from nexus_agent.tools.web import WebTools


def new_state():
    events = []
    return RunState(emit=events.append), events


def resolver(mapping):
    async def resolve(host):
        return mapping[host]

    return resolve


PUBLIC = resolver({"example.com": ["93.184.216.34"], "cdn.example.com": ["93.184.216.35"]})


def web(handler, state):
    return WebTools(
        state, "http://searx:8080", httpx.AsyncClient(transport=httpx.MockTransport(handler)), PUBLIC
    )


async def test_web_search_numbers_sources_and_announces_them():
    state, events = new_state()

    def handler(request):
        assert request.url.path == "/search" and request.url.params["q"] == "bun"
        assert request.url.params["format"] == "json"
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "A", "url": "https://a.test/x", "content": "sobre A"},
                    {"title": "B", "url": "https://b.test/y", "content": "sobre B"},
                    {"title": "sin url"},
                ]
            },
        )

    out = json.loads(await web(handler, state).web_search("bun"))

    assert [r["n"] for r in out["results"]] == [1, 2]
    assert out["results"][0]["snippet"] == "sobre A"
    assert events[-1]["name"] == "nexus.sources"
    assert [s["id"] for s in events[-1]["value"]["sources"]] == [1, 2]


async def test_a_repeated_url_keeps_its_number_across_searches():
    state, events = new_state()

    def handler(request):
        return httpx.Response(200, json={"results": [{"title": "A", "url": "https://a.test/x"}]})

    tools = web(handler, state)
    first = json.loads(await tools.web_search("uno"))
    second = json.loads(await tools.web_search("dos"))
    assert first["results"][0]["n"] == second["results"][0]["n"] == 1
    assert len(events) == 1  # no se re-anuncia si no hay fuentes nuevas


async def test_web_search_reports_failures_as_data_not_exceptions():
    state, _ = new_state()
    out = json.loads(await web(lambda r: httpx.Response(500), state).web_search("x"))
    assert "la búsqueda falló" in out["error"]


async def test_web_fetch_extracts_text_and_registers_the_source():
    state, events = new_state()

    def handler(request):
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="<html><title>Hola</title><body><p>Texto útil</p><script>x</script></body></html>",
        )

    out = json.loads(await web(handler, state).web_fetch("https://example.com/p"))

    assert out["title"] == "Hola" and out["text"] == "Texto útil" and out["n"] == 1
    assert events[-1]["name"] == "nexus.sources"


async def test_web_fetch_blocks_private_targets_without_requesting_them():
    state, _ = new_state()
    called = []

    def handler(request):
        called.append(str(request.url))
        return httpx.Response(200, text="x")

    tools = web(handler, state)
    for url in ["http://169.254.169.254/latest", "http://localhost:3000", "http://10.0.0.2/"]:
        out = json.loads(await tools.web_fetch(url))
        assert "bloqueada" in out["error"]
    assert called == []


async def test_web_fetch_revalidates_every_redirect_hop():
    state, _ = new_state()

    def handler(request):
        if request.url.host == "example.com":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/secret"})
        return httpx.Response(200, text="SECRETO")

    out = json.loads(await web(handler, state).web_fetch("https://example.com/redir"))
    assert "bloqueada" in out["error"]


async def test_web_fetch_follows_safe_redirects_and_rejects_binary():
    state, _ = new_state()

    def handler(request):
        if request.url.path == "/a":
            return httpx.Response(301, headers={"location": "https://cdn.example.com/b"})
        if request.url.path == "/b":
            return httpx.Response(200, headers={"content-type": "text/plain"}, text="final")
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")

    tools = web(handler, state)
    ok = json.loads(await tools.web_fetch("https://example.com/a"))
    assert ok["text"] == "final" and ok["url"] == "https://cdn.example.com/b"
    pdf = json.loads(await tools.web_fetch("https://example.com/doc.pdf"))
    assert "no soportado" in pdf["error"]


async def test_web_fetch_stops_redirect_loops():
    state, _ = new_state()
    out = json.loads(
        await web(
            lambda r: httpx.Response(302, headers={"location": "https://example.com/loop"}), state
        ).web_fetch("https://example.com/loop")
    )
    assert "demasiadas" in out["error"]


def bff_with(handler):
    return BffClient(
        BffLink(baseUrl="http://app:3000", runToken="tok"),
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


async def test_present_openui_validates_through_the_bff():
    state, _ = new_state()
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        body = json.loads(request.content)
        ok = "root =" in body["ui"]
        return httpx.Response(200, json={"ok": ok, "error": None if ok else "sin root"})

    ui = UiTools(state, bff_with(handler))
    assert json.loads(await ui.present_openui("root = Card([])")) == {"displayed": True}
    bad = json.loads(await ui.present_openui("hola"))
    assert "sin root" in bad["error"]
    assert seen["auth"] == "Bearer tok"
    assert "vacío" in json.loads(await ui.present_openui("   "))["error"]


async def test_prompt_openui_interrupts_only_when_the_program_is_valid():
    state, _ = new_state()
    ui = UiTools(state, bff_with(lambda r: httpx.Response(200, json={"ok": True})))
    with pytest.raises(ToolInterrupt) as raised:
        await ui.prompt_openui("root = Form([])")
    assert raised.value.reason == "openui_form"

    invalid = UiTools(state, bff_with(lambda r: httpx.Response(200, json={"ok": False, "error": "mal"})))
    assert "mal" in json.loads(await invalid.prompt_openui("x"))["error"]


async def test_validator_outage_does_not_block_the_ui():
    state, _ = new_state()
    ui = UiTools(state, bff_with(lambda r: httpx.Response(503)))
    assert json.loads(await ui.present_openui("root = Card([])")) == {"displayed": True}


async def test_openui_spec_rejects_unknown_profiles():
    state, _ = new_state()
    ui = UiTools(state, bff_with(lambda r: httpx.Response(200, json={"spec": "ESPEC"})))
    assert await ui.openui_spec("data") == "ESPEC"
    assert "desconocido" in json.loads(await ui.openui_spec("inventado"))["error"]


async def test_followups_are_cleaned_capped_and_emitted():
    state, events = new_state()
    out = json.loads(await FollowupTools(state).suggest_followups(["  ¿A?  ", "", "B", "C", "D", "E", "F"]))
    assert out["count"] == 5
    assert events[-1] == {
        "type": "CUSTOM", "name": "nexus.followups", "value": {"questions": ["¿A?", "B", "C", "D", "E"]},
    }


async def test_bff_client_maps_http_errors():
    client = bff_with(lambda r: httpx.Response(403))
    with pytest.raises(BffError, match="403"):
        await client.policy("x", {}, "c1")

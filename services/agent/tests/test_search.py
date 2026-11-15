"""Motores de búsqueda. Las respuestas siguen el formato documentado por cada servicio."""

import json

import httpx

from nexus_agent.contract import SearchConfig, SearchProviderSpec
from nexus_agent.search import Query, probe, search
from nexus_agent.state import RunState
from nexus_agent.tools.web import WebTools

SEARX = SearchProviderSpec(id="searxng", baseUrl="http://searx:8080/")
LANG = SearchProviderSpec(id="langsearch", apiKey="clave-lang")
BRAVE = SearchProviderSpec(id="brave", apiKey="clave-brave")

SEARX_OK = {"results": [{"title": "S", "url": "https://s.test/", "content": "desde searx"}]}
LANG_OK = {
    "code": 200,
    "data": {
        "webPages": {
            "value": [
                {
                    "name": "L",
                    "url": "https://l.test/",
                    "snippet": "desde lang",
                    "datePublished": "2026-01-02",
                },
                {"name": "sin url"},
            ]
        }
    },
}
BRAVE_OK = {
    "web": {
        "results": [
            {"title": "B", "url": "https://b.test/", "description": "con <strong>marcas</strong>"}
        ]
    }
}
BLOCKED = {"results": [], "unresponsive_engines": [["brave", "too many requests"], ["google", "HTTP 403"]]}


def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_langsearch_request_and_normalization():
    seen = {}

    def handler(request):
        seen.update(
            url=str(request.url),
            auth=request.headers["authorization"],
            body=json.loads(request.content),
        )
        return httpx.Response(200, json=LANG_OK)

    attempt, hits = await probe(client(handler), LANG, Query("hola", time_range="week", max_results=5))

    assert seen["url"] == "https://api.langsearch.com/v1/web-search"
    assert seen["auth"] == "Bearer clave-lang"
    assert seen["body"] == {"query": "hola", "count": 5, "freshness": "oneWeek"}
    assert attempt.ok and [h.url for h in hits] == ["https://l.test/"]
    assert hits[0].title == "L" and hits[0].published == "2026-01-02"


async def test_brave_request_and_normalization():
    seen = {}

    def handler(request):
        seen.update(path=request.url.path, params=dict(request.url.params), token=request.headers["x-subscription-token"])
        return httpx.Response(200, json=BRAVE_OK)

    attempt, hits = await probe(client(handler), BRAVE, Query("hola", time_range="day", language="es-ES", max_results=50))

    assert seen["path"] == "/res/v1/web/search" and seen["token"] == "clave-brave"
    assert seen["params"] == {"q": "hola", "count": "20", "freshness": "pd", "search_lang": "es"}
    assert attempt.ok and hits[0].snippet == "con marcas"


async def test_all_searxng_engines_blocked_is_a_failure_not_an_empty_result():
    attempt, hits = await probe(client(lambda r: httpx.Response(200, json=BLOCKED)), SEARX, Query("x"))
    assert not attempt.ok and hits == []
    assert "brave" in attempt.error and "google" in attempt.error


async def test_searxng_relaxes_the_filters_when_the_filtered_engines_fail():
    """Run real: «noticias de hoy» (news + day) fallaba entera y la búsqueda general sí respondía."""
    seen = []

    def handler(request):
        params = dict(request.url.params)
        seen.append((params["categories"], params.get("time_range")))
        if params["categories"] == "news":
            return httpx.Response(200, json={"results": [], "unresponsive_engines": [["bing news", "parsing error"]]})
        return httpx.Response(200, json={"results": [{"url": "https://a.test", "title": "A", "content": "a"}]})

    attempt, hits = await probe(client(handler), SEARX, Query("nasdaq", categories="news", time_range="day"))

    assert attempt.ok and [hit.url for hit in hits] == ["https://a.test"]
    assert seen == [("news", "day"), ("news", None), ("general", None)]


async def test_a_dated_query_falls_back_to_news_first_then_general():
    """Run real: con «day» ningún motor respondía y el modelo recibió 12 veces las mismas páginas fijas."""

    def handler(request):
        params = dict(request.url.params)
        if params.get("time_range"):
            return httpx.Response(200, json={"results": [], "unresponsive_engines": [["google", "access denied"]]})
        name = params["categories"]
        urls = ["https://dup.test", f"https://{name}.test"]
        return httpx.Response(200, json={"results": [{"url": url, "title": name, "content": ""} for url in urls]})

    attempt, hits = await probe(client(handler), SEARX, Query("nasdaq hoy", time_range="day"))

    assert attempt.ok
    assert [hit.url for hit in hits] == ["https://dup.test", "https://news.test", "https://general.test"]


async def test_searxng_does_not_retry_a_genuinely_empty_result():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, json={"results": [], "unresponsive_engines": []})

    attempt, hits = await probe(client(handler), SEARX, Query("zxqv", categories="news", time_range="day"))

    assert attempt.ok and hits == [] and len(calls) == 1


async def test_missing_key_does_not_call_the_service():
    def handler(request):
        raise AssertionError("no debería llamar")

    attempt, _ = await probe(client(handler), SearchProviderSpec(id="brave"), Query("x"))
    assert not attempt.ok and "clave" in attempt.error


async def test_errors_never_leak_the_key():
    for status in (401, 403, 429, 500):
        response = httpx.Response(status, text="clave-lang")
        attempt, _ = await probe(client(lambda _r, r=response: r), LANG, Query("x"))
        assert not attempt.ok and "clave-lang" not in attempt.error and str(status) in attempt.error

    def explode(request):
        raise httpx.ConnectError("fallo con clave-lang", request=request)

    attempt, _ = await probe(client(explode), LANG, Query("x"))
    assert attempt.error == "ConnectError"
    assert "clave-brave" not in repr(BRAVE)


async def test_falls_back_in_order_until_there_are_enough_results():
    order = []

    def handler(request):
        host = request.url.host
        order.append(host)
        if host == "searx":
            return httpx.Response(200, json=BLOCKED)
        if host == "api.langsearch.com":
            return httpx.Response(429)
        return httpx.Response(200, json=BRAVE_OK)

    outcome = await search(
        client(handler), SearchConfig(providers=[SEARX, LANG, BRAVE], minResults=1), Query("x")
    )

    assert order == ["searx", "api.langsearch.com", "api.search.brave.com"]
    assert outcome.provider == "brave" and len(outcome.hits) == 1
    assert [a.ok for a in outcome.attempts] == [False, False, True]


async def test_stops_at_the_first_engine_that_is_enough():
    order = []

    def handler(request):
        order.append(request.url.host)
        return httpx.Response(200, json=SEARX_OK)

    await search(client(handler), SearchConfig(providers=[SEARX, BRAVE], minResults=1), Query("x"))
    assert order == ["searx"]


async def test_too_few_results_tries_the_next_and_keeps_the_best():
    def handler(request):
        if request.url.host == "searx":
            return httpx.Response(200, json={"results": [
                {"url": "https://a.test/"}, {"url": "https://b.test/"},
            ]})
        return httpx.Response(200, json=BRAVE_OK)

    outcome = await search(client(handler), SearchConfig(providers=[SEARX, BRAVE], minResults=3), Query("x"))
    assert outcome.provider == "searxng" and len(outcome.hits) == 2
    assert len(outcome.attempts) == 2


def tools(handler, config):
    return WebTools(RunState(emit=lambda _: None), "http://env:8080", client(handler), search_config=config)


async def test_web_search_reports_an_error_when_every_engine_fails():
    out = json.loads(
        await tools(lambda r: httpx.Response(200, json=BLOCKED), SearchConfig(providers=[SEARX])).web_search("x")
    )
    assert out["error"] == "la búsqueda falló: ningún motor pudo responder"
    assert out["engines"][0]["engine"] == "searxng"


async def test_web_search_with_nothing_enabled_is_an_error():
    out = json.loads(await tools(lambda r: httpx.Response(500), SearchConfig(providers=[])).web_search("x"))
    assert "error" in out


async def test_genuinely_empty_results_are_not_an_error():
    out = json.loads(
        await tools(lambda r: httpx.Response(200, json={"results": []}), SearchConfig(providers=[SEARX])).web_search("x")
    )
    assert out["results"] == [] and "error" not in out


async def test_web_search_says_which_engine_answered_and_numbers_sources():
    out = json.loads(
        await tools(lambda r: httpx.Response(200, json=LANG_OK), SearchConfig(providers=[LANG])).web_search("x")
    )
    assert out["engine"] == "langsearch" and out["results"][0]["n"] == 1


async def test_without_config_it_uses_the_searxng_of_the_environment():
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        return httpx.Response(200, json=SEARX_OK)

    await tools(handler, None).web_search("x")
    assert hosts == ["env"]


async def test_snippetless_news_results_are_completed_and_sorted_after_snippets():
    """Run real: solo respondía el motor de noticias, sin extracto, y el modelo veía titulares."""

    def handler(request):
        params = dict(request.url.params)
        if params["categories"] == "news" or params.get("time_range"):
            return httpx.Response(
                200,
                json={
                    "results": [{"url": "https://news.test/1", "title": "Titular", "content": ""}],
                    "unresponsive_engines": [["brave", "too many requests"], ["duckduckgo", "CAPTCHA"]],
                },
            )
        return httpx.Response(200, json={"results": [{"url": "https://web.test/1", "title": "Web", "content": "con datos"}]})

    attempt, hits = await probe(client(handler), SEARX, Query("bolsa hoy", categories="news", time_range="day"))

    assert attempt.ok and attempt.degraded == ["brave", "duckduckgo"]
    assert [hit.url for hit in hits] == ["https://web.test/1", "https://news.test/1"]


async def test_web_search_asks_to_read_the_sources_when_there_are_no_snippets():
    only_titles = {"results": [{"url": "https://a.test/", "title": "A", "content": ""}]}
    out = json.loads(
        await tools(lambda r: httpx.Response(200, json=only_titles), SearchConfig(providers=[SEARX])).web_search("x")
    )
    assert out["results"][0]["snippet"] is None and "web_fetch" in out["note"]
    with_snippet = json.loads(
        await tools(lambda r: httpx.Response(200, json=SEARX_OK), SearchConfig(providers=[SEARX])).web_search("x")
    )
    assert "note" not in with_snippet

"""Motores de búsqueda web y orden de respaldo entre ellos.

Qué motores se usan y en qué orden lo decide un admin desde la web; el BFF lo manda
en cada run. Un motor que falla o devuelve pocos resultados cede el turno al
siguiente, y cada intento queda registrado: un fallo nunca se presenta como una
búsqueda sin resultados.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from typing import Any

import httpx

from .contract import SearchConfig, SearchProviderSpec

log = logging.getLogger("nexus_agent.search")

PROVIDER_TIMEOUT_S = 12.0
MAX_RESULTS = 20
_TAGS = re.compile(r"<[^>]+>")


class SearchUnavailable(Exception):
    """El motor no pudo responder. El mensaje nunca contiene la clave."""


@dataclass(frozen=True)
class Query:
    text: str
    categories: str = "general"
    time_range: str = ""
    language: str = ""
    max_results: int = 8


@dataclass(frozen=True)
class Hit:
    url: str
    title: str | None
    snippet: str
    published: str | None = None


@dataclass
class Attempt:
    provider: str
    ok: bool
    results: int = 0
    ms: int = 0
    error: str | None = None
    # Motores internos que no respondieron aunque hubiera resultados (p. ej. de SearXNG).
    degraded: list[str] = field(default_factory=list)


# Motores caídos que va encontrando el adaptador en curso (SearXNG responde 200 igualmente).
_DEGRADED: ContextVar[list[str] | None] = ContextVar("nexus_search_degraded", default=None)


@dataclass
class Outcome:
    hits: list[Hit] = field(default_factory=list)
    provider: str | None = None
    attempts: list[Attempt] = field(default_factory=list)


Adapter = Callable[[httpx.AsyncClient, SearchProviderSpec, Query], Awaitable[list[Hit]]]


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _parse(response: httpx.Response) -> Any:
    if response.status_code == 429:
        raise SearchUnavailable("límite de peticiones alcanzado (HTTP 429)")
    if response.status_code in (401, 403):
        raise SearchUnavailable(f"clave rechazada (HTTP {response.status_code})")
    if response.status_code == 422:
        # Brave responde así también a una clave con formato incorrecto.
        raise SearchUnavailable("clave o petición no válida (HTTP 422)")
    if response.status_code >= 400:
        raise SearchUnavailable(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as error:
        raise SearchUnavailable("respuesta no válida") from error


def _api_key(spec: SearchProviderSpec) -> str:
    if spec.apiKey is None or not spec.apiKey.get_secret_value():
        raise SearchUnavailable("falta la clave de API")
    return spec.apiKey.get_secret_value()


async def _searxng(http: httpx.AsyncClient, spec: SearchProviderSpec, query: Query) -> list[Hit]:
    if not spec.baseUrl:
        raise SearchUnavailable("falta la URL del servicio")
    hits, broken = await _searxng_once(http, spec.baseUrl, query)
    sink = _DEGRADED.get()
    if sink is not None:
        sink.extend(e for e in broken if e not in sink)
    if hits and not any(hit.snippet for hit in hits) and broken:
        # Solo han respondido motores sin extracto (típico de noticias): se completa con la
        # consulta general, que suele traerlo.
        extra, _ = await _searxng_once(http, spec.baseUrl, replace(query, categories="general", time_range=""))
        known = {hit.url for hit in hits}
        hits.extend(hit for hit in extra if hit.url not in known)
    if hits or not broken:  # vacío de verdad: ningún motor falló, no hay nada que reintentar
        return _with_snippets_first(hits)
    # Con filtros responden menos motores (los de noticias y los que admiten fecha), y son los
    # que más se bloquean. Si fallan, se relaja la consulta antes de darla por perdida. Quien
    # pedía un periodo quería lo reciente: sin el filtro, las noticias van delante.
    relaxed: list[Query] = []
    if query.time_range:
        relaxed.append(replace(query, categories="news", time_range=""))
    if query.categories != "general" or query.time_range:
        relaxed.append(replace(query, categories="general", time_range=""))
    seen: set[str] = set()
    for attempt in relaxed:
        found, _ = await _searxng_once(http, spec.baseUrl, attempt)
        for hit in found:
            if hit.url not in seen:
                seen.add(hit.url)
                hits.append(hit)
        if len(hits) >= query.max_results:
            break
    if not hits:
        # SearXNG responde 200 aunque todos sus motores estén bloqueados.
        raise SearchUnavailable(f"motores sin respuesta: {', '.join(broken)[:200]}")
    return _with_snippets_first(hits)


def _with_snippets_first(hits: list[Hit]) -> list[Hit]:
    """Los resultados con extracto primero (orden estable): sin él, el modelo solo ve titulares."""
    return sorted(hits, key=lambda hit: not hit.snippet)


async def _searxng_once(http: httpx.AsyncClient, base_url: str, query: Query) -> tuple[list[Hit], list[str]]:
    """Resultados de una consulta y los motores de SearXNG que no respondieron."""
    params = {"q": query.text, "format": "json", "categories": query.categories}
    if query.time_range:
        params["time_range"] = query.time_range
    if query.language:
        params["language"] = query.language
    response = await http.get(f"{base_url.rstrip('/')}/search", params=params, timeout=PROVIDER_TIMEOUT_S)
    data = _parse(response)
    hits = [
        Hit(
            url=item["url"],
            title=_text(item.get("title")),
            snippet=_text(item.get("content")) or "",
            published=_text(item.get("publishedDate")),
        )
        for item in data.get("results", [])
        if _text(item.get("url"))
    ]
    broken = sorted({str(entry[0]) for entry in data.get("unresponsive_engines", []) if entry})
    return hits, broken


_LANGSEARCH_FRESHNESS = {"day": "oneDay", "week": "oneWeek", "month": "oneMonth", "year": "oneYear"}


async def _langsearch(http: httpx.AsyncClient, spec: SearchProviderSpec, query: Query) -> list[Hit]:
    body = {
        "query": query.text,
        "count": min(query.max_results, 50),
        "freshness": _LANGSEARCH_FRESHNESS.get(query.time_range, "noLimit"),
    }
    response = await http.post(
        f"{(spec.baseUrl or 'https://api.langsearch.com').rstrip('/')}/v1/web-search",
        json=body,
        headers={"Authorization": f"Bearer {_api_key(spec)}"},
        timeout=PROVIDER_TIMEOUT_S,
    )
    data = _parse(response)
    pages = ((data.get("data") or {}).get("webPages") or {}).get("value") or []
    return [
        Hit(
            url=item["url"],
            title=_text(item.get("name")),
            snippet=_text(item.get("snippet")) or _text(item.get("text")) or "",
            published=_text(item.get("datePublished")),
        )
        for item in pages
        if _text(item.get("url"))
    ]


_BRAVE_FRESHNESS = {"day": "pd", "week": "pw", "month": "pm", "year": "py"}


async def _brave(http: httpx.AsyncClient, spec: SearchProviderSpec, query: Query) -> list[Hit]:
    params: dict[str, Any] = {"q": query.text, "count": min(query.max_results, 20)}
    if query.time_range in _BRAVE_FRESHNESS:
        params["freshness"] = _BRAVE_FRESHNESS[query.time_range]
    if query.language:
        params["search_lang"] = query.language[:2].lower()
    response = await http.get(
        f"{(spec.baseUrl or 'https://api.search.brave.com').rstrip('/')}/res/v1/web/search",
        params=params,
        headers={"X-Subscription-Token": _api_key(spec), "Accept": "application/json"},
        timeout=PROVIDER_TIMEOUT_S,
    )
    data = _parse(response)
    return [
        Hit(
            url=item["url"],
            title=_text(item.get("title")),
            # Brave marca los términos buscados con <strong>.
            snippet=_TAGS.sub("", _text(item.get("description")) or ""),
            published=_text(item.get("page_age")),
        )
        for item in (data.get("web") or {}).get("results") or []
        if _text(item.get("url"))
    ]


ADAPTERS: dict[str, Adapter] = {"searxng": _searxng, "langsearch": _langsearch, "brave": _brave}


async def probe(http: httpx.AsyncClient, spec: SearchProviderSpec, query: Query) -> tuple[Attempt, list[Hit]]:
    """Una consulta a un solo motor. Nunca lanza: el fallo queda en el intento."""
    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    degraded: list[str] = []
    token = _DEGRADED.set(degraded)
    try:
        hits = (await ADAPTERS[spec.id](http, spec, query))[: query.max_results]
    except SearchUnavailable as error:
        return Attempt(spec.id, ok=False, ms=elapsed(), error=str(error), degraded=degraded), []
    except httpx.TimeoutException:
        return Attempt(spec.id, ok=False, ms=elapsed(), error="tiempo agotado"), []
    except (httpx.HTTPError, ValueError, KeyError, AttributeError, TypeError) as error:
        # Solo el tipo: el mensaje de httpx puede incluir la URL con la consulta.
        return Attempt(spec.id, ok=False, ms=elapsed(), error=type(error).__name__), []
    finally:
        _DEGRADED.reset(token)
    if degraded:
        log.warning("motor de búsqueda %s degradado: %s", spec.id, ", ".join(degraded))
    return Attempt(spec.id, ok=True, results=len(hits), ms=elapsed(), degraded=degraded), hits


def with_default_searxng(spec: SearchProviderSpec, url: str) -> SearchProviderSpec:
    """SearXNG sin URL configurada usa la del entorno del sidecar."""
    if spec.id == "searxng" and not spec.baseUrl:
        return spec.model_copy(update={"baseUrl": url})
    return spec


async def search(http: httpx.AsyncClient, config: SearchConfig, query: Query) -> Outcome:
    """Prueba los motores en orden hasta tener suficientes resultados; si no, el mejor parcial."""
    outcome = Outcome()
    for spec in config.providers:
        attempt, hits = await probe(http, spec, query)
        outcome.attempts.append(attempt)
        if not attempt.ok:
            log.warning("motor de búsqueda %s: %s", spec.id, attempt.error)
        if len(hits) > len(outcome.hits):
            outcome.hits, outcome.provider = hits, spec.id
        if len(hits) >= min(config.minResults, query.max_results):
            break
    return outcome

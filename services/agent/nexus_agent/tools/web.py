from __future__ import annotations

import json
from typing import Any

import httpx

from ..contract import SearchConfig, SearchProviderSpec
from ..htmltext import html_to_text
from ..netguard import BlockedUrl, Resolver, check_url, system_resolver
from ..search import MAX_RESULTS, Query, search, with_default_searxng
from ..state import RunState

USER_AGENT = "Mozilla/5.0 (compatible; NexusBot/0.1; +https://github.com/marcosflz/nexus)"
MAX_BODY_BYTES = 2_000_000
MAX_REDIRECTS = 4
_TEXT_TYPES = ("text/", "application/json", "application/xml", "application/xhtml")


class WebTools:
    def __init__(
        self,
        state: RunState,
        searxng_url: str,
        http: httpx.AsyncClient | None = None,
        resolver: Resolver = system_resolver,
        search_config: SearchConfig | None = None,
    ) -> None:
        self._state = state
        default = SearchConfig(providers=[SearchProviderSpec(id="searxng")], minResults=1)
        chosen = search_config or default
        self._search = chosen.model_copy(
            update={"providers": [with_default_searxng(p, searxng_url) for p in chosen.providers]}
        )
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(20.0))
        self._resolver = resolver

    async def web_search(
        self,
        query: str,
        categories: str = "general",
        time_range: str = "",
        language: str = "",
        max_results: int = 8,
    ) -> str:
        """Busca en la web. Devuelve resultados numerados [n]: cítalos así en la respuesta.

        categories: general, news, science, it, social media… time_range: day, week, month, year.
        """
        outcome = await search(
            self._http,
            self._search,
            Query(query, categories, time_range, language, max(1, min(max_results, MAX_RESULTS))),
        )
        failures = [
            {"engine": a.provider, "error": a.error} for a in outcome.attempts if not a.ok
        ]
        if not outcome.hits and (failures or not outcome.attempts):
            # Distinto de «no hay resultados»: el modelo no debe concluir que no existe nada.
            return json.dumps(
                {"error": "la búsqueda falló: ningún motor pudo responder", "engines": failures},
                ensure_ascii=False,
            )

        results: list[dict[str, Any]] = []
        for hit in outcome.hits:
            source = self._state.sources.add(hit.url, hit.title)
            results.append(
                {
                    "n": source.id,
                    "title": hit.title or source.domain,
                    "url": hit.url,
                    "snippet": hit.snippet[:400],
                    "published": hit.published,
                }
            )
        self._state.announce_sources()
        payload: dict[str, Any] = {"query": query, "engine": outcome.provider, "results": results}
        if results and not any(r["snippet"] for r in results):
            for r in results:
                r["snippet"] = None
            # Sin extractos el modelo tiende a responder solo con titulares (o a rendirse).
            payload["note"] = (
                "Los resultados no traen extracto: lee con web_fetch las fuentes más relevantes "
                "antes de responder."
            )
        return json.dumps(payload, ensure_ascii=False)

    async def web_fetch(self, url: str, max_chars: int = 12000) -> str:
        """Lee una página web y devuelve su texto. Úsala tras web_search para verificar datos."""
        current = url
        try:
            for _ in range(MAX_REDIRECTS + 1):
                current = await check_url(current, self._resolver)
                async with self._http.stream(
                    "GET", current, headers={"User-Agent": USER_AGENT}, follow_redirects=False
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            return json.dumps({"error": "redirección sin destino"})
                        current = str(httpx.URL(current).join(location))
                        continue
                    if response.status_code >= 400:
                        return json.dumps({"error": f"HTTP {response.status_code}", "url": current})
                    content_type = response.headers.get("content-type", "").lower()
                    if not content_type.startswith(_TEXT_TYPES):
                        return json.dumps(
                            {"error": f"tipo de contenido no soportado: {content_type or '?'}"}
                        )
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BODY_BYTES:
                            break
                    encoding = response.encoding or "utf-8"
                    raw = bytes(body).decode(encoding, errors="replace")
                    break
            else:
                return json.dumps({"error": "demasiadas redirecciones"})
        except BlockedUrl as error:
            return json.dumps({"error": f"URL bloqueada: {error}"})
        except httpx.HTTPError as error:
            return json.dumps({"error": f"no se pudo leer la página ({type(error).__name__})"})

        if "html" in content_type:
            title, text = html_to_text(raw)
        else:
            title, text = "", raw.strip()
        limit = max(500, min(max_chars, 40000))
        source = self._state.sources.add(current, title or None)
        self._state.announce_sources()
        return json.dumps(
            {
                "n": source.id,
                "url": current,
                "title": title,
                "text": text[:limit],
                "truncated": len(text) > limit,
            },
            ensure_ascii=False,
        )

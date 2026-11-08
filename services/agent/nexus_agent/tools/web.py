from __future__ import annotations

import json
from typing import Any

import httpx

from ..htmltext import html_to_text
from ..netguard import BlockedUrl, Resolver, check_url, system_resolver
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
    ) -> None:
        self._state = state
        self._searxng = searxng_url.rstrip("/")
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
        params = {"q": query, "format": "json", "categories": categories}
        if time_range:
            params["time_range"] = time_range
        if language:
            params["language"] = language
        try:
            response = await self._http.get(f"{self._searxng}/search", params=params)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            return json.dumps({"error": f"la búsqueda falló ({type(error).__name__})"})

        results: list[dict[str, Any]] = []
        for item in data.get("results", [])[: max(1, min(max_results, 20))]:
            url = item.get("url")
            if not isinstance(url, str) or not url:
                continue
            title = item.get("title") if isinstance(item.get("title"), str) else None
            source = self._state.sources.add(url, title)
            results.append(
                {
                    "n": source.id,
                    "title": title or source.domain,
                    "url": url,
                    "snippet": (item.get("content") or "")[:400],
                    "published": item.get("publishedDate"),
                }
            )
        self._state.announce_sources()
        return json.dumps({"query": query, "results": results}, ensure_ascii=False)

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

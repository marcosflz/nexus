"""Registro de fuentes de un run con numeración estable.

Cada URL recibe un número la primera vez que se ve y lo conserva, de modo que
las citas [n] del modelo no se descuadran aunque haya varias búsquedas.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit


def domain_of(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host.removeprefix("www.")


@dataclass
class Source:
    id: int
    url: str
    title: str | None
    domain: str

    def as_dict(self) -> dict[str, object]:
        data: dict[str, object] = {"id": self.id, "url": self.url, "domain": self.domain}
        if self.title:
            data["title"] = self.title
        return data


class SourceRegistry:
    def __init__(self) -> None:
        self._by_url: dict[str, Source] = {}

    def add(self, url: str, title: str | None = None) -> Source:
        existing = self._by_url.get(url)
        if existing is not None:
            if title and not existing.title:
                existing.title = title
            return existing
        source = Source(len(self._by_url) + 1, url, title, domain_of(url))
        self._by_url[url] = source
        return source

    def all(self) -> list[Source]:
        return list(self._by_url.values())

    def as_dicts(self) -> list[dict[str, object]]:
        return [source.as_dict() for source in self.all()]

    def __len__(self) -> int:
        return len(self._by_url)

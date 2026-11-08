from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .sources import SourceRegistry

NEXUS_SOURCES = "nexus.sources"
NEXUS_FOLLOWUPS = "nexus.followups"


@dataclass
class RunState:
    """Estado mutable de un run, compartido entre herramientas y el stream."""

    emit: Callable[[dict[str, Any]], None]
    sources: SourceRegistry = field(default_factory=SourceRegistry)
    followups: list[str] = field(default_factory=list)
    _announced_sources: int = 0

    def announce_sources(self) -> None:
        """Publica la lista acumulada de fuentes si ha crecido."""
        if len(self.sources) == self._announced_sources:
            return
        self._announced_sources = len(self.sources)
        self.emit(
            {"type": "CUSTOM", "name": NEXUS_SOURCES, "value": {"sources": self.sources.as_dicts()}}
        )

    def set_followups(self, questions: list[str]) -> None:
        self.followups = questions
        self.emit({"type": "CUSTOM", "name": NEXUS_FOLLOWUPS, "value": {"questions": questions}})

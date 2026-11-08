from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    secret: str = field(default_factory=lambda: os.getenv("NEXUS_AGENT_SECRET", ""))
    searxng_url: str = field(default_factory=lambda: os.getenv("SEARXNG_URL", "http://searxng:8080"))

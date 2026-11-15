"""Configuración y organización de directorios del NexBot.

Todo lo persistente cuelga de un único volumen (``root``):

    workspace/   ficheros del bot: artifacts/, downloads/, uploads/, memory/
    state/       tareas (journal JSON + eventos) y bot.json
    browser/     sesión del navegador, solo si se ha autorizado conservarla
    deps/        dependencias que instala el propio bot (pip/npm)
    logs/        log estructurado del runtime

Lo demás (/tmp, /dev/shm, procesos, la RAM del navegador) es efímero a propósito.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class PathEscape(ValueError):
    """La ruta pedida se sale del directorio permitido."""


def safe_path(base: Path, relative: str) -> Path:
    """Resuelve ``relative`` dentro de ``base``, también a través de enlaces simbólicos."""
    if not relative or "\x00" in relative or relative.startswith(("/", "~")):
        raise PathEscape("la ruta debe ser relativa al workspace")
    resolved_base = base.resolve()
    candidate = (resolved_base / relative).resolve()
    if not candidate.is_relative_to(resolved_base) or candidate == resolved_base:
        raise PathEscape("la ruta se sale del workspace")
    return candidate


@dataclass(frozen=True)
class Settings:
    bot_id: str
    token: str
    root: Path = Path("/bot")
    proxy: str | None = None
    persist_browser: bool = False
    desktop: bool = False
    task_timeout_s: int = 600
    approval_timeout_s: int = 3600
    disk_quota_bytes: int = 2 * 1024**3

    @classmethod
    def from_env(cls) -> Settings:
        token = os.environ.get("NEXBOT_TOKEN", "")
        if not token:
            raise RuntimeError("NEXBOT_TOKEN es obligatorio")
        return cls(
            bot_id=os.environ.get("NEXBOT_ID", ""),
            token=token,
            root=Path(os.environ.get("NEXBOT_ROOT", "/bot")),
            proxy=os.environ.get("NEXBOT_PROXY") or None,
            persist_browser=os.environ.get("NEXBOT_PERSIST_BROWSER") == "1",
            desktop=os.environ.get("NEXBOT_DESKTOP") == "1",
            task_timeout_s=int(os.environ.get("NEXBOT_TASK_TIMEOUT", "600")),
            approval_timeout_s=int(os.environ.get("NEXBOT_APPROVAL_TIMEOUT", "3600")),
            disk_quota_bytes=int(os.environ.get("NEXBOT_DISK_QUOTA_MB", "2048")) * 1024**2,
        )

    @property
    def workspace(self) -> Path:
        return self.root / "workspace"

    @property
    def tasks_dir(self) -> Path:
        return self.root / "state" / "tasks"

    @property
    def browser_state(self) -> Path:
        return self.root / "browser" / "storage-state.json"

    @property
    def deps_dir(self) -> Path:
        return self.root / "deps"

    @property
    def log_file(self) -> Path:
        return self.root / "logs" / "botd.jsonl"

    def prepare(self) -> None:
        for directory in (
            self.workspace / "artifacts",
            self.workspace / "downloads",
            self.workspace / "uploads",
            self.workspace / "memory",
            self.tasks_dir,
            self.browser_state.parent,
            self.deps_dir,
            self.log_file.parent,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def disk_usage(self) -> int:
        """Bytes usados en el volumen. Es una cuota blanda: se comprueba, no la impone el kernel."""
        total = 0
        for folder, _, files in os.walk(self.root):
            for name in files:
                try:
                    total += (Path(folder) / name).lstat().st_size
                except OSError:
                    continue
        return total

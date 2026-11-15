"""Journal de tareas en el volumen: una tarea por fichero, con escritura atómica.

Conservar este journal NO significa poder reanudar: tras un reinicio se sabe qué
tarea estaba en marcha, pero la página, el DOM y el proceso ya no existen.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class InvalidTaskId(ValueError):
    pass


def check_id(task_id: str) -> str:
    if not _ID.match(task_id):
        raise InvalidTaskId("id de tarea no válido")
    return task_id


class TaskJournal:
    def __init__(self, directory: Path) -> None:
        self._dir = directory

    def _file(self, task_id: str) -> Path:
        return self._dir / f"{check_id(task_id)}.json"

    def _events(self, task_id: str) -> Path:
        return self._dir / f"{check_id(task_id)}.events.jsonl"

    def artifact(self, task_id: str, suffix: str) -> Path:
        return self._dir / f"{check_id(task_id)}{suffix}"

    def save(self, task: dict[str, Any]) -> None:
        target = self._file(task["id"])
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(task, ensure_ascii=False))
        os.replace(temporary, target)

    def load(self, task_id: str) -> dict[str, Any] | None:
        try:
            return json.loads(self._file(task_id).read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def all(self) -> list[dict[str, Any]]:
        tasks = []
        for path in self._dir.glob("*.json"):
            try:
                tasks.append(json.loads(path.read_text()))
            except json.JSONDecodeError:
                continue
        return sorted(tasks, key=lambda task: task.get("createdAt", 0), reverse=True)

    def append_event(self, task_id: str, event: dict[str, Any]) -> None:
        with self._events(task_id).open("a") as handle:
            handle.write(json.dumps({"ts": time.time(), **event}, ensure_ascii=False) + "\n")

    def events(self, task_id: str, limit: int = 500) -> list[dict[str, Any]]:
        try:
            lines = self._events(task_id).read_text().splitlines()
        except FileNotFoundError:
            return []
        parsed = []
        for line in lines[-limit:]:
            try:
                parsed.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return parsed

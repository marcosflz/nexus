"""Tablero de la sala para un NexBot. Las reglas (sala, permisos, tope por turno) las aplica el BFF."""

from __future__ import annotations

import json
from typing import Any

from ..bff import BffClient, BffError


class BoardTools:
    def __init__(self, bff: BffClient | None) -> None:
        self._bff = bff

    async def _op(self, op: str, **fields: Any) -> str:
        if self._bff is None:
            return json.dumps({"error": "tablero no disponible"})
        try:
            return json.dumps(await self._bff.board(op, **fields), ensure_ascii=False)
        except BffError as error:
            return json.dumps({"error": str(error)})

    async def board_list(self) -> str:
        """Lista las tareas de la sala: id, título, estado y responsable. `current` es la de este hilo."""
        return await self._op("list")

    async def board_create_subtask(self, title: str, description: str = "", assignee: str = "") -> str:
        """Crea una subtarea de la tarea de este hilo. `assignee` es el @handle del bot que la hará (opcional)."""
        return await self._op("create_subtask", title=title, description=description, assignee=assignee)

    async def board_set_status(self, status: str, topic: str = "") -> str:
        """Cambia el estado de una tarea: todo, in_progress, in_review o blocked. Sin `topic`, la de este hilo."""
        return await self._op("set_status", status=status, topic=topic)

    async def board_assign(self, assignee: str, topic: str = "") -> str:
        """Asigna una tarea al bot con ese @handle, que recibirá un turno. Sin `topic`, la de este hilo."""
        return await self._op("assign", assignee=assignee, topic=topic)

    async def board_add_blocker(self, blocked_by: str, topic: str = "") -> str:
        """Marca que una tarea no puede avanzar hasta que termine otra (`blocked_by` es su id)."""
        return await self._op("add_blocker", blockedBy=blocked_by, topic=topic)

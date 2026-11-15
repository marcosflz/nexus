from __future__ import annotations

import json
from typing import Any

from ..bff import BffClient, BffError
from ..state import RunState


class KnowledgeTools:
    def __init__(self, state: RunState, bff: BffClient | None, top_k: int = 6) -> None:
        self._state = state
        self._bff = bff
        self._top_k = top_k

    async def knowledge_search(self, query: str) -> str:
        """Busca en los documentos de conocimiento del agente. Cita los resultados como [n]."""
        if self._bff is None:
            return json.dumps({"error": "conocimiento no disponible"})
        try:
            rows = await self._bff.knowledge_search(query, self._top_k)
        except BffError as error:
            return json.dumps({"error": str(error)})
        results: list[dict[str, Any]] = []
        for row in rows:
            url = str(row.get("url") or "")
            name = str(row.get("name") or "documento")
            source = self._state.sources.add(url, name) if url else None
            results.append(
                {
                    "n": source.id if source else None,
                    "document": name,
                    "passage": row.get("ordinal"),
                    "text": str(row.get("content") or "")[:1500],
                }
            )
        self._state.announce_sources()
        return json.dumps({"query": query, "results": results}, ensure_ascii=False)


class MemoryTools:
    def __init__(self, bff: BffClient | None) -> None:
        self._bff = bff

    async def _op(self, op: str, **fields: Any) -> str:
        if self._bff is None:
            return json.dumps({"error": "memoria no disponible"})
        try:
            return json.dumps(await self._bff.memory(op, **fields), ensure_ascii=False)
        except BffError as error:
            return json.dumps({"error": str(error)})

    async def remember(self, key: str, value: str) -> str:
        """Guarda un dato duradero sobre el usuario (clave corta + valor)."""
        return await self._op("remember", key=key, value=value)

    async def recall(self, query: str) -> str:
        """Busca en lo que el agente recuerda del usuario."""
        return await self._op("recall", query=query)

    async def forget(self, key: str) -> str:
        """Olvida un dato guardado."""
        return await self._op("forget", key=key)

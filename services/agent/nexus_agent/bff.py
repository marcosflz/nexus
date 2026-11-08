"""Cliente de los callbacks internos del BFF de Nexus.

El sidecar no tiene acceso a la base de datos: política, conocimiento, memoria
y validación de OpenUI se piden al BFF con un token de run (HMAC firmado por el
BFF, de corta duración y atado a run + usuario + agente).
"""

from __future__ import annotations

from typing import Any

import httpx

from .contract import BffLink


class BffError(RuntimeError):
    pass


class BffClient:
    def __init__(self, link: BffLink, http: httpx.AsyncClient | None = None) -> None:
        self._base = link.baseUrl.rstrip("/")
        self._token = link.runToken.get_secret_value()
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(20.0))
        self._owns_http = http is None

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._http.post(
                f"{self._base}/api/internal/{path}",
                json=body,
                headers={"Authorization": f"Bearer {self._token}"},
            )
        except httpx.HTTPError as error:
            raise BffError(f"el BFF no responde ({type(error).__name__})") from error
        if response.status_code >= 400:
            raise BffError(f"el BFF rechazó {path}: HTTP {response.status_code}")
        data = response.json()
        return data if isinstance(data, dict) else {}

    async def policy(self, tool: str, args: dict[str, Any], tool_call_id: str) -> dict[str, Any]:
        return await self._post("policy", {"tool": tool, "args": args, "toolCallId": tool_call_id})

    async def validate_openui(self, program: str) -> dict[str, Any]:
        return await self._post("openui/validate", {"ui": program})

    async def openui_spec(self, profile: str) -> str:
        data = await self._post("openui/spec", {"profile": profile})
        return str(data.get("spec", ""))

    async def knowledge_search(self, query: str, top_k: int) -> list[dict[str, Any]]:
        data = await self._post("knowledge/search", {"query": query, "topK": top_k})
        results = data.get("results", [])
        return results if isinstance(results, list) else []

    async def memory(self, op: str, **fields: Any) -> dict[str, Any]:
        return await self._post("memory", {"op": op, **fields})

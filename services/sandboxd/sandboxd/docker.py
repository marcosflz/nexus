"""Cliente mínimo de la API de Docker Engine.

No habla con ``/var/run/docker.sock``: usa ``DOCKER_HOST`` (HTTP), pensado para
apuntar a un *docker-socket-proxy* que solo permite las rutas de contenedores y
volúmenes. Así un fallo en este servicio no equivale a root en el host.
"""

from __future__ import annotations

from typing import Any

import httpx


class DockerError(RuntimeError):
    pass


class DockerClient:
    def __init__(self, base_url: str, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(30.0))

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, ok: tuple[int, ...] = (200, 201, 204), **kw: Any):
        response = await self._http.request(method, path, **kw)
        if response.status_code not in ok:
            raise DockerError(f"{method} {path} → HTTP {response.status_code}: {response.text[:200]}")
        return response

    async def inspect(self, name: str) -> dict[str, Any] | None:
        response = await self._http.get(f"/containers/{name}/json")
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise DockerError(f"inspect {name} → HTTP {response.status_code}")
        return response.json()

    async def create(self, name: str, spec: dict[str, Any]) -> None:
        await self._request("POST", "/containers/create", params={"name": name}, json=spec)

    async def start(self, name: str) -> None:
        await self._request("POST", f"/containers/{name}/start", ok=(204, 304))

    async def stop(self, name: str, timeout: int = 10) -> None:
        await self._request("POST", f"/containers/{name}/stop", params={"t": timeout}, ok=(204, 304, 404))

    async def remove(self, name: str) -> None:
        await self._request("DELETE", f"/containers/{name}", params={"force": "true"}, ok=(204, 404))

    async def create_volume(self, name: str, labels: dict[str, str]) -> None:
        await self._request("POST", "/volumes/create", json={"Name": name, "Labels": labels})

    async def remove_volume(self, name: str) -> None:
        await self._request("DELETE", f"/volumes/{name}", ok=(204, 404))

    async def list_by_label(self, label: str) -> list[dict[str, Any]]:
        import json

        response = await self._request(
            "GET", "/containers/json", params={"all": "false", "filters": json.dumps({"label": [label]})}
        )
        return response.json()

    # --- Redes (solo las usan los NexBots) -----------------------------------

    async def list_networks(self, label: str) -> list[dict[str, Any]]:
        import json

        response = await self._request("GET", "/networks", params={"filters": json.dumps({"label": [label]})})
        return response.json()

    async def inspect_network(self, name: str) -> dict[str, Any] | None:
        response = await self._http.get(f"/networks/{name}")
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise DockerError(f"inspect network {name} → HTTP {response.status_code}")
        return response.json()

    async def create_network(self, name: str, spec: dict[str, Any]) -> None:
        await self._request("POST", "/networks/create", json={"Name": name, **spec})

    async def connect(self, network: str, container: str) -> None:
        response = await self._http.post(f"/networks/{network}/connect", json={"Container": container})
        # 403 con «already exists»: el contenedor ya estaba en esa red.
        if response.status_code == 200 or "already exists" in response.text:
            return
        raise DockerError(f"connect {container} → HTTP {response.status_code}: {response.text[:200]}")

    async def disconnect(self, network: str, container: str) -> None:
        response = await self._http.post(f"/networks/{network}/disconnect", json={"Container": container, "Force": True})
        if response.status_code in (200, 404):
            return
        # Desconectar algo que no estaba conectado no es un fallo. Docker lo responde con
        # 403 o con 500 según la versión; tratarlo como error abortaba el borrado del bot
        # y dejaba su red y su volumen huérfanos.
        if "not connected" in response.text.lower():
            return
        raise DockerError(f"POST /networks/{network}/disconnect → HTTP {response.status_code}: {response.text[:200]}")

    async def remove_network(self, name: str) -> None:
        await self._request("DELETE", f"/networks/{name}", ok=(204, 404))

    async def logs(self, name: str, tail: int = 200) -> str:
        response = await self._request(
            "GET", f"/containers/{name}/logs", params={"stdout": 1, "stderr": 1, "tail": tail}
        )
        return demux(response.content)


def demux(raw: bytes) -> str:
    """Quita la cabecera de 8 bytes con la que Docker multiplexa stdout y stderr."""
    out = bytearray()
    index = 0
    while index + 8 <= len(raw) and raw[index] in (0, 1, 2):
        size = int.from_bytes(raw[index + 4 : index + 8], "big")
        out += raw[index + 8 : index + 8 + size]
        index += 8 + size
    return (out if out or not raw else raw).decode("utf-8", "replace")

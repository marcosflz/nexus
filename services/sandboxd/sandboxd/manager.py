"""Ciclo de vida del espacio de trabajo de cada agente.

Cada agente tiene su propio contenedor (navegador con Playwright MCP) y un
volumen persistente: las cookies y los ficheros sobreviven entre ejecuciones,
pero un agente nunca ve el contenedor de otro. El contenedor no publica
puertos: solo es alcanzable por la red interna ``sandbox-net``.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from .docker import DockerClient

LABEL = "nexus.sandbox"
MCP_PORT = 8931
_AGENT_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class InvalidAgentId(ValueError):
    pass


def check_agent_id(agent_id: str) -> str:
    """El id acaba en nombres de contenedor y volumen: solo se admite un UUID."""
    if not _AGENT_ID.match(agent_id):
        raise InvalidAgentId("id de agente no válido")
    return agent_id.lower()


def container_name(agent_id: str) -> str:
    return f"nexus-sbx-{check_agent_id(agent_id)[:8]}"


def volume_name(agent_id: str) -> str:
    return f"nexus-sbx-data-{check_agent_id(agent_id)}"


@dataclass
class SandboxConfig:
    image: str = "mcr.microsoft.com/playwright/mcp:latest"
    network: str = "nexus-sandbox"
    memory_bytes: int = 1536 * 1024 * 1024
    cpus: float = 1.0
    pids_limit: int = 512
    idle_minutes: int = 20
    # Hosts que el navegador no debe tocar nunca (red local y metadatos de la nube).
    blocked_origins: str = (
        "http://localhost:*;http://127.*;http://10.*;http://192.168.*;http://169.254.*;"
        "https://localhost:*;https://127.*;https://10.*;https://192.168.*;https://169.254.*"
    )


def container_spec(agent_id: str, config: SandboxConfig) -> dict[str, Any]:
    """Especificación del contenedor, con el mínimo de privilegios."""
    return {
        "Image": config.image,
        "Cmd": [
            "--headless", "--browser", "chromium", "--no-sandbox",
            "--host", "0.0.0.0", "--port", str(MCP_PORT),
            "--user-data-dir", "/data/profile",
            "--blocked-origins", config.blocked_origins,
        ],
        "Labels": {LABEL: "1", "nexus.agent": check_agent_id(agent_id)},
        "ExposedPorts": {},  # sin puertos publicados
        "HostConfig": {
            "NetworkMode": config.network,
            "Binds": [f"{volume_name(agent_id)}:/data"],
            "Memory": config.memory_bytes,
            "MemorySwap": config.memory_bytes,
            "NanoCpus": int(config.cpus * 1_000_000_000),
            "PidsLimit": config.pids_limit,
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges:true"],
            "ReadonlyRootfs": True,
            # El navegador necesita /tmp escribible; el resto del sistema queda de solo lectura.
            "Tmpfs": {"/tmp": "rw,noexec,nosuid,size=512m"},
            "RestartPolicy": {"Name": "no"},
            "Privileged": False,
            "PortBindings": {},
        },
    }


@dataclass
class Workspace:
    agent_id: str
    name: str
    url: str
    status: str


@dataclass
class SandboxManager:
    docker: DockerClient
    config: SandboxConfig = field(default_factory=SandboxConfig)
    _last_active: dict[str, float] = field(default_factory=dict)

    def _url(self, agent_id: str) -> str:
        return f"http://{container_name(agent_id)}:{MCP_PORT}/mcp"

    async def ensure(self, agent_id: str) -> Workspace:
        """Deja el contenedor del agente en marcha (lo crea si no existe) y lo marca activo."""
        name = container_name(agent_id)
        info = await self.docker.inspect(name)
        if info is None:
            await self.docker.create_volume(volume_name(agent_id), {LABEL: "1", "nexus.agent": agent_id})
            await self.docker.create(name, container_spec(agent_id, self.config))
            await self.docker.start(name)
        elif not info.get("State", {}).get("Running"):
            await self.docker.start(name)
        self._last_active[agent_id] = time.monotonic()
        return Workspace(agent_id, name, self._url(agent_id), "running")

    async def status(self, agent_id: str) -> Workspace:
        info = await self.docker.inspect(container_name(agent_id))
        running = bool(info and info.get("State", {}).get("Running"))
        state = "running" if running else ("stopped" if info else "absent")
        return Workspace(agent_id, container_name(agent_id), self._url(agent_id), state)

    async def stop(self, agent_id: str) -> None:
        await self.docker.stop(container_name(agent_id))
        self._last_active.pop(agent_id, None)

    async def destroy(self, agent_id: str, purge: bool = False) -> None:
        await self.docker.remove(container_name(agent_id))
        self._last_active.pop(agent_id, None)
        if purge:
            await self.docker.remove_volume(volume_name(agent_id))

    async def reap_idle(self, now: float | None = None) -> list[str]:
        """Para los contenedores sin actividad reciente. Devuelve los agentes parados."""
        moment = now if now is not None else time.monotonic()
        limit = self.config.idle_minutes * 60
        stopped: list[str] = []
        for container in await self.docker.list_by_label(LABEL):
            agent_id = container.get("Labels", {}).get("nexus.agent")
            if not agent_id:
                continue
            # Sin registro (el servicio se reinició) se asume activo ahora: se le da otra ventana.
            last = self._last_active.setdefault(agent_id, moment)
            if moment - last >= limit:
                await self.stop(agent_id)
                stopped.append(agent_id)
        return stopped

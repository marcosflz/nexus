"""Ciclo de vida de los NexBots.

Un bot es un contenedor, un volumen y una red interna propios. Lo que se reutiliza
entre recreaciones es solo el volumen: el contenedor es desechable.

La red es ``internal``, sin ruta a internet ni al host. A ella se conectan solo el
proxy de salida y los servicios de control, de modo que un bot no alcanza a otro.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import os
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

from .docker import DockerClient, DockerError
from .manager import check_agent_id

LABEL = "nexus.bot"
CONFIG_LABEL = "nexus.bot.config"
NETWORK_LABEL = "nexus.bot.network"
OPTIONS_LABEL = "nexus.bot.options"
# Un bot comprometido no debe poder agotar la memoria del plano de control.
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
BOT_PORT = 8900
PROXIED_PATHS = re.compile(r"status|logs|desktop/frame|files(/content)?|skills/(run|cancel)|tasks(/[0-9a-f-]{36}(/(cancel|decision))?)?")


class BotNotRunning(RuntimeError):
    pass


class BotStartFailed(RuntimeError):
    pass


class NoSubnetAvailable(RuntimeError):
    pass


class BotResponseTooLarge(RuntimeError):
    pass


class BotDesktopRefused(RuntimeError):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(body)
        self.status = status


class BotOptions(BaseModel):
    """Lo configurable por bot. Los márgenes los impone este servicio, no el cliente."""

    model_config = ConfigDict(extra="forbid")

    network: Literal["restricted", "none"] = "restricted"
    persistBrowser: bool = False
    # Escritorio virtual: el navegador se ve en el visor y hay acciones por píxeles.
    desktop: bool = True
    memoryMb: int = Field(default=2048, ge=512, le=8192)
    cpus: float = Field(default=1.0, ge=0.25, le=4.0)
    diskMb: int = Field(default=2048, ge=64, le=51200)
    taskTimeoutS: int = Field(default=600, ge=10, le=86400)


@dataclass(frozen=True)
class BotConfig:
    secret: str
    image: str = "nexus-nexbot:latest"
    egress_container: str = "nexus-bot-egress"
    egress_port: int = 3128
    control_containers: tuple[str, ...] = ("nexus-sandboxd", "nexus-agent")
    subnet_base: str = "10.239.0.0/16"
    start_timeout_s: float = 45.0
    retry_delay_s: float = 0.5
    # Etiqueta de los bots de ESTA instalación: dos instalaciones en el mismo Docker
    # no deben tocar los bots de la otra (ni conectarles sus servicios).
    label: str = LABEL

    @classmethod
    def from_env(cls, secret: str) -> BotConfig:
        control = os.getenv("BOT_CONTROL_CONTAINERS", ",".join(cls.control_containers))
        return cls(
            secret=secret,
            image=os.getenv("BOT_IMAGE", cls.image),
            egress_container=os.getenv("BOT_EGRESS_CONTAINER", cls.egress_container),
            control_containers=tuple(name.strip() for name in control.split(",") if name.strip()),
            subnet_base=os.getenv("BOT_SUBNET_BASE", cls.subnet_base),
            label=os.getenv("BOT_LABEL", cls.label),
        )


def container_name(bot_id: str) -> str:
    return f"nexus-bot-{check_agent_id(bot_id)}"


def volume_name(bot_id: str) -> str:
    return f"nexus-bot-data-{check_agent_id(bot_id)}"


def network_name(bot_id: str) -> str:
    return f"nexus-bot-net-{check_agent_id(bot_id)}"


def bot_token(secret: str, bot_id: str) -> str:
    """Token del bot, derivado: conocer el de uno no permite calcular el de otro."""
    message = f"nexbot-token:{check_agent_id(bot_id)}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def bot_spec(bot_id: str, options: BotOptions, config: BotConfig) -> dict[str, Any]:
    """Contenedor con el mínimo de privilegios. Ningún secreto salvo su propio token."""
    env = [
        f"NEXBOT_ID={check_agent_id(bot_id)}",
        f"NEXBOT_TOKEN={bot_token(config.secret, bot_id)}",
        f"NEXBOT_PERSIST_BROWSER={'1' if options.persistBrowser else '0'}",
        f"NEXBOT_DESKTOP={'1' if options.desktop else '0'}",
        f"NEXBOT_TASK_TIMEOUT={options.taskTimeoutS}",
        f"NEXBOT_DISK_QUOTA_MB={options.diskMb}",
        "HOME=/tmp",
    ]
    if options.network == "restricted":
        env.append(f"NEXBOT_PROXY=http://{config.egress_container}:{config.egress_port}")
    memory = options.memoryMb * 1024 * 1024
    return {
        "Image": config.image,
        "Hostname": "nexbot",
        "Env": env,
        "Labels": {
            config.label: "1",
            "nexus.bot.id": check_agent_id(bot_id),
            NETWORK_LABEL: options.network,
            CONFIG_LABEL: config_hash(options, config),
            OPTIONS_LABEL: options.model_dump_json(),
        },
        "ExposedPorts": {},
        "HostConfig": {
            "NetworkMode": network_name(bot_id),
            "Binds": [f"{volume_name(bot_id)}:/bot"],
            "Memory": memory,
            "MemorySwap": memory,
            "NanoCpus": int(options.cpus * 1_000_000_000),
            "PidsLimit": 512,
            "ShmSize": 256 * 1024 * 1024,
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges:true"],
            "ReadonlyRootfs": True,
            "Tmpfs": {"/tmp": "rw,noexec,nosuid,size=512m"},
            "Init": True,
            "Privileged": False,
            "PortBindings": {},
            "RestartPolicy": {"Name": "on-failure", "MaximumRetryCount": 3},
            "LogConfig": {"Type": "json-file", "Config": {"max-size": "10m", "max-file": "3"}},
        },
    }


def config_hash(options: BotOptions, config: BotConfig) -> str:
    """Si cambia la configuración o la imagen, el contenedor se recrea (el volumen no)."""
    raw = json.dumps({"options": options.model_dump(), "image": config.image}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class BotManager:
    def __init__(self, docker: DockerClient, config: BotConfig, http: httpx.AsyncClient) -> None:
        self.docker = docker
        self.config = config
        self.http = http
        self._network_lock = asyncio.Lock()

    def _base_url(self, bot_id: str) -> str:
        return f"http://{container_name(bot_id)}:{BOT_PORT}"

    def _auth(self, bot_id: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {bot_token(self.config.secret, bot_id)}"}

    async def _ensure_network(self, bot_id: str) -> None:
        name = network_name(bot_id)
        # Las subredes se eligen aquí: el pool por defecto de Docker se agota enseguida.
        async with self._network_lock:
            if await self.docker.inspect_network(name) is not None:
                return
            used = {
                ipam["Subnet"]
                for network in await self.docker.list_networks(self.config.label)
                for ipam in (network.get("IPAM", {}).get("Config") or [])
                if "Subnet" in ipam
            }
            for subnet in ipaddress.ip_network(self.config.subnet_base).subnets(new_prefix=28):
                if str(subnet) in used:
                    continue
                spec = {
                    "Driver": "bridge",
                    "Internal": True,
                    "CheckDuplicate": True,
                    "IPAM": {"Config": [{"Subnet": str(subnet)}]},
                    # Sin IP en el puente: `internal` por sí solo deja al bot llegar a los
                    # servicios del host por la IP del gateway (comprobado con el SSH del NAS).
                    "Options": {"com.docker.network.bridge.inhibit_ipv4": "true"},
                    "Labels": {self.config.label: "1", "nexus.bot.id": check_agent_id(bot_id)},
                }
                try:
                    await self.docker.create_network(name, spec)
                    return
                except DockerError as error:
                    if "overlap" not in str(error).lower():
                        raise
            raise NoSubnetAvailable("No quedan subredes libres para otro bot")

    async def _attach_services(self, bot_id: str, mode: str, strict: bool = True) -> None:
        network = network_name(bot_id)
        wanted = list(self.config.control_containers)
        if mode == "restricted":
            wanted.append(self.config.egress_container)
        else:
            await self.docker.disconnect(network, self.config.egress_container)
        for container in wanted:
            try:
                await self.docker.connect(network, container)
            except DockerError:
                if strict:
                    raise

    async def reattach_all(self) -> None:
        """Recrear un servicio de control le quita sus redes: se las devuelve a los bots activos."""
        for container in await self.docker.list_by_label(self.config.label):
            labels = container.get("Labels", {})
            bot_id = labels.get("nexus.bot.id")
            if bot_id:
                await self._attach_services(bot_id, labels.get(NETWORK_LABEL, "restricted"), strict=False)

    async def _wait_healthy(self, bot_id: str) -> None:
        deadline = asyncio.get_running_loop().time() + self.config.start_timeout_s
        last_error = "sin respuesta"
        while asyncio.get_running_loop().time() < deadline:
            info = await self.docker.inspect(container_name(bot_id))
            state = (info or {}).get("State", {})
            if not state.get("Running") and state.get("Status") in ("exited", "dead"):
                raise BotStartFailed(f"El contenedor terminó al arrancar (código {state.get('ExitCode')})")
            try:
                response = await self.http.get(f"{self._base_url(bot_id)}/healthz", timeout=2.0)
                if response.status_code == 200:
                    return
                last_error = f"HTTP {response.status_code}"
            except httpx.HTTPError as error:
                last_error = type(error).__name__
            await asyncio.sleep(0.5)
        raise BotStartFailed(f"El bot no respondió a tiempo ({last_error})")

    async def ensure(self, bot_id: str, options: BotOptions) -> dict[str, Any]:
        """Deja el bot en marcha. Idempotente; recrea el contenedor si cambió la configuración."""
        name = container_name(bot_id)
        await self._ensure_network(bot_id)
        await self.docker.create_volume(volume_name(bot_id), {self.config.label: "1", "nexus.bot.id": bot_id})
        wanted = config_hash(options, self.config)
        info = await self.docker.inspect(name)
        if info is not None and info.get("Config", {}).get("Labels", {}).get(CONFIG_LABEL) != wanted:
            await self.docker.remove(name)
            info = None
        if info is None:
            await self.docker.create(name, bot_spec(bot_id, options, self.config))
        await self._attach_services(bot_id, options.network)
        await self.docker.start(name)
        await self._wait_healthy(bot_id)
        return await self.status(bot_id)

    async def recreate(self, bot_id: str, options: BotOptions) -> dict[str, Any]:
        """Tira el contenedor y crea otro sobre el mismo volumen."""
        await self.docker.stop(container_name(bot_id), timeout=20)
        await self.docker.remove(container_name(bot_id))
        return await self.ensure(bot_id, options)

    async def stop(self, bot_id: str) -> None:
        # 20 s: el runtime marca sus tareas y guarda la sesión del navegador antes de salir.
        await self.docker.stop(container_name(bot_id), timeout=20)

    async def destroy(self, bot_id: str, purge: bool = False) -> None:
        name, network = container_name(bot_id), network_name(bot_id)
        await self.docker.remove(name)
        for container in (*self.config.control_containers, self.config.egress_container):
            await self.docker.disconnect(network, container)
        # Docker tarda un instante en soltar la red y el volumen de un contenedor recién
        # borrado; sin reintentar, quedaban huérfanos y el borrado parecía completo.
        await self._retry(lambda: self.docker.remove_network(network))
        if purge:
            await self._retry(lambda: self.docker.remove_volume(volume_name(bot_id)))

    async def _retry(self, action: Any, attempts: int = 6) -> None:
        for attempt in range(attempts):
            try:
                await action()
                return
            except DockerError:
                if attempt == attempts - 1:
                    raise
                await asyncio.sleep(self.config.retry_delay_s)

    async def status(self, bot_id: str) -> dict[str, Any]:
        name = container_name(bot_id)
        info = await self.docker.inspect(name)
        if info is None:
            return {"botId": bot_id, "state": "absent", "container": name}
        state = info.get("State", {})
        report: dict[str, Any] = {
            "botId": bot_id,
            "container": name,
            "volume": volume_name(bot_id),
            "state": "running" if state.get("Running") else "stopped",
            "exitCode": state.get("ExitCode"),
            "oomKilled": bool(state.get("OOMKilled")),
            "restarts": info.get("RestartCount", 0),
            "error": state.get("Error") or None,
        }
        applied = info.get("Config", {}).get("Labels", {}).get(OPTIONS_LABEL)
        if applied:
            report["options"] = json.loads(applied)
        if report["state"] == "running":
            try:
                response = await self.http.get(
                    f"{self._base_url(bot_id)}/v1/status", headers=self._auth(bot_id), timeout=5.0
                )
                report["runtime"] = response.json() if response.status_code == 200 else None
            except (httpx.HTTPError, ValueError):
                report["runtime"] = None
        return report

    async def logs(self, bot_id: str, tail: int) -> str:
        return await self.docker.logs(container_name(bot_id), tail)

    async def mcp_link(self, bot_id: str) -> dict[str, Any]:
        """Conector MCP para el sidecar. Es el único sitio donde sale el token del bot."""
        info = await self.docker.inspect(container_name(bot_id))
        if not (info or {}).get("State", {}).get("Running"):
            raise BotNotRunning("El bot está detenido")
        return {
            "url": f"{self._base_url(bot_id)}/mcp",
            "transport": "streamable-http",
            "headers": self._auth(bot_id),
        }

    async def open_desktop_stream(self, bot_id: str, fps: float) -> tuple[str, AsyncIterator[bytes]]:
        """Abre la emisión de la pantalla. Solo fotogramas: no hay camino de vuelta al bot."""
        info = await self.docker.inspect(container_name(bot_id))
        if not (info or {}).get("State", {}).get("Running"):
            raise BotNotRunning("El bot está detenido")
        request = self.http.build_request(
            "GET",
            f"{self._base_url(bot_id)}/v1/desktop/stream",
            params={"fps": fps},
            headers=self._auth(bot_id),
            timeout=httpx.Timeout(10.0, read=30.0),
        )
        response = await self.http.send(request, stream=True)
        if response.status_code != 200:
            body = await response.aread()
            await response.aclose()
            raise BotDesktopRefused(response.status_code, body.decode("utf-8", "replace")[:300])

        async def relay() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()

        return response.headers.get("content-type", "application/octet-stream"), relay()

    async def forward(
        self, bot_id: str, method: str, path: str, params: dict[str, str], body: bytes
    ) -> httpx.Response:
        info = await self.docker.inspect(container_name(bot_id))
        if not (info or {}).get("State", {}).get("Running"):
            raise BotNotRunning("El bot está detenido")
        request = self.http.build_request(
            method,
            f"{self._base_url(bot_id)}/v1/{path}",
            params=params,
            content=body,
            headers={**self._auth(bot_id), "Content-Type": "application/json"},
        )
        response = await self.http.send(request, stream=True)
        try:
            received = bytearray()
            async for chunk in response.aiter_bytes():
                received += chunk
                if len(received) > MAX_RESPONSE_BYTES:
                    raise BotResponseTooLarge("La respuesta del bot es demasiado grande")
        finally:
            await response.aclose()
        # Los bytes ya están leídos: sin esto, response.content lanzaría StreamClosed.
        return httpx.Response(response.status_code, headers=response.headers, content=bytes(received))

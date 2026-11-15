"""Proxy de salida de los NexBots.

La red de cada bot no tiene ruta al exterior: este proxy es la única salida.
Decide con la IP ya resuelta y se conecta a esa misma IP, de modo que un DNS que
apunte a una dirección privada (o que cambie entre consulta y conexión) no sirve.

Solo se admiten los puertos web. No descifra TLS: ve destinos, no contenidos.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import socket
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

log = logging.getLogger("nexus.egress")

HEADER_LIMIT = 32 * 1024
CONNECT_TIMEOUT = 15.0
IDLE_TIMEOUT = 300.0
MAX_CLIENTS = 256

Resolver = Callable[[str, int], Awaitable[list[str]]]


class Denied(Exception):
    pass


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def system_resolver(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


@dataclass
class EgressPolicy:
    allow_ports: frozenset[int] = frozenset({80, 443})
    # Excepción explícita (nombres exactos): por defecto, ninguna.
    allow_hosts: frozenset[str] = frozenset()
    resolver: Resolver = field(default=system_resolver)

    async def check(self, host: str, port: int) -> list[str]:
        """Devuelve las IP a las que se puede conectar, o lanza ``Denied``."""
        name = host.strip().rstrip(".").lower()
        allowed_name = name in self.allow_hosts
        if not allowed_name and port not in self.allow_ports:
            raise Denied(f"puerto {port} no permitido")
        try:
            addresses = await self.resolver(name, port)
        except OSError as error:
            raise Denied("no se pudo resolver el nombre") from error
        if not addresses:
            raise Denied("el nombre no tiene direcciones")
        # Basta una dirección privada para rechazar: no se elige la buena.
        if not allowed_name and not all(is_public(address) for address in addresses):
            raise Denied("destino privado")
        return addresses

    @classmethod
    def from_env(cls) -> EgressPolicy:
        hosts = os.getenv("EGRESS_ALLOW_HOSTS", "")
        return cls(allow_hosts=frozenset(h.strip().lower() for h in hosts.split(",") if h.strip()))


def parse_target(method: str, target: str) -> tuple[str, int, str]:
    """(host, puerto, ruta) de la línea de petición de un proxy."""
    if method == "CONNECT":
        parts = urlsplit(f"//{target}")
        if not parts.hostname or not parts.port:
            raise Denied("destino CONNECT no válido")
        return parts.hostname, parts.port, ""
    parts = urlsplit(target)
    if parts.scheme != "http" or not parts.hostname:
        raise Denied("solo http o CONNECT")
    path = parts.path or "/"
    return parts.hostname, parts.port or 80, f"{path}?{parts.query}" if parts.query else path


def rewrite_headers(lines: list[bytes]) -> list[bytes]:
    drop = (b"proxy-", b"connection:", b"keep-alive:")
    kept = [line for line in lines if not line.lower().startswith(drop)]
    # Una petición por conexión: otra podría ir a un destino que no se ha comprobado.
    return [*kept, b"Connection: close"]


def audit(**data: object) -> None:
    print(json.dumps({"ts": time.time(), **data}, ensure_ascii=False), file=sys.stdout, flush=True)


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            chunk = await asyncio.wait_for(reader.read(65536), IDLE_TIMEOUT)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()
    except (TimeoutError, ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            writer.close()
        except ConnectionError:
            pass


async def _connect(addresses: list[str], port: int):
    last: Exception = Denied("sin direcciones")
    for address in addresses:
        try:
            return await asyncio.wait_for(asyncio.open_connection(address, port), CONNECT_TIMEOUT)
        except (OSError, TimeoutError) as error:
            last = error
    raise last


async def _reply(writer: asyncio.StreamWriter, status: str) -> None:
    writer.write(f"HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".encode())
    await writer.drain()
    writer.close()


async def handle(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, policy: EgressPolicy
) -> None:
    peer = (writer.get_extra_info("peername") or ("?",))[0]
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
    except (asyncio.LimitOverrunError, asyncio.IncompleteReadError, TimeoutError, ConnectionError):
        writer.close()
        return
    if len(head) > HEADER_LIMIT:
        await _reply(writer, "431 Request Header Fields Too Large")
        return

    lines = head[:-4].split(b"\r\n")
    host, port = "?", 0
    try:
        method, target, version = lines[0].decode("latin-1").split(" ", 2)
        host, port, path = parse_target(method, target)
        addresses = await policy.check(host, port)
    except (Denied, ValueError) as error:
        audit(src=peer, host=host, port=port, decision="deny", reason=str(error))
        await _reply(writer, "403 Forbidden")
        return

    try:
        upstream_reader, upstream_writer = await _connect(addresses, port)
    except (OSError, TimeoutError) as error:
        audit(src=peer, host=host, port=port, decision="error", reason=type(error).__name__)
        await _reply(writer, "502 Bad Gateway")
        return

    audit(src=peer, host=host, port=port, decision="allow", method=method)
    if method == "CONNECT":
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
    else:
        request = [f"{method} {path} {version}".encode("latin-1"), *rewrite_headers(lines[1:])]
        upstream_writer.write(b"\r\n".join(request) + b"\r\n\r\n")
        await upstream_writer.drain()
    await asyncio.gather(_pipe(reader, upstream_writer), _pipe(upstream_reader, writer))


async def serve(policy: EgressPolicy, host: str = "0.0.0.0", port: int = 3128) -> asyncio.Server:
    slots = asyncio.Semaphore(MAX_CLIENTS)

    async def client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        async with slots:
            try:
                await handle(reader, writer, policy)
            except Exception:
                log.exception("error en el proxy de salida")
                writer.close()

    return await asyncio.start_server(client, host, port, limit=HEADER_LIMIT)


async def main() -> None:
    server = await serve(EgressPolicy.from_env())
    audit(event="egress_ready", port=3128)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())

"""Guardia SSRF para ``web_fetch``.

Un agente que lee URLs elegidas por un modelo (o por una página inyectada) no
debe poder alcanzar la red local ni los endpoints de metadatos de la nube. Se
valida el esquema, se resuelve el DNS y se rechaza cualquier dirección
privada, de loopback, link-local, reservada o multicast, **en cada salto** de
redirección. Limitación conocida: entre la resolución y la conexión hay una
ventana (DNS rebinding); la defensa en profundidad es la red del contenedor.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

Resolver = Callable[[str], Awaitable[list[str]]]

_BLOCKED_NAMES = {"localhost", "metadata", "metadata.google.internal"}
_BLOCKED_SUFFIXES = (".local", ".internal", ".localhost", ".lan", ".home.arpa")


class BlockedUrl(ValueError):
    """La URL apunta a un destino que un agente no debe alcanzar."""


async def system_resolver(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return sorted({info[4][0] for info in infos})


def is_blocked_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value.split("%")[0])
    except ValueError:
        return True  # lo que no es una IP interpretable se trata como sospechoso
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


async def check_url(url: str, resolver: Resolver = system_resolver) -> str:
    """Devuelve la URL normalizada o lanza ``BlockedUrl``."""
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"}:
        raise BlockedUrl("solo se permiten URLs http(s)")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise BlockedUrl("la URL no tiene host")
    if parts.username or parts.password:
        raise BlockedUrl("las URLs con credenciales no están permitidas")
    if host in _BLOCKED_NAMES or host.endswith(_BLOCKED_SUFFIXES):
        raise BlockedUrl("el host pertenece a la red local")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        try:
            addresses = await resolver(host)
        except OSError as error:
            raise BlockedUrl(f"no se pudo resolver {host}") from error
    else:
        addresses = [str(literal)]

    if not addresses or any(is_blocked_address(a) for a in addresses):
        raise BlockedUrl("el host resuelve a una dirección privada o reservada")
    return parts.geturl()

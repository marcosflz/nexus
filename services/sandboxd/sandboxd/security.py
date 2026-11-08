"""Autenticación de las peticiones del BFF.

Doble comprobación: secreto compartido (Bearer) y firma HMAC del cuerpo con
marca de tiempo, para que una petición capturada no pueda repetirse pasado
un minuto. El sidecar solo debe ser alcanzable desde la red interna.
"""

from __future__ import annotations

import hashlib
import hmac
import time

MAX_SKEW_SECONDS = 60


class AuthError(Exception):
    pass


def sign(secret: str, timestamp: str, body: bytes) -> str:
    message = timestamp.encode() + b"." + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify(
    secret: str,
    authorization: str | None,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    now: float | None = None,
) -> None:
    if not secret:
        raise AuthError("el sidecar no tiene NEXUS_AGENT_SECRET configurado")
    expected = f"Bearer {secret}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise AuthError("secreto no válido")
    if not timestamp or not signature:
        raise AuthError("falta la firma")
    try:
        sent_at = float(timestamp)
    except ValueError as error:
        raise AuthError("marca de tiempo no válida") from error
    if abs((now if now is not None else time.time()) - sent_at) > MAX_SKEW_SECONDS:
        raise AuthError("petición caducada")
    if not hmac.compare_digest(sign(secret, timestamp, body), signature):
        raise AuthError("firma no válida")

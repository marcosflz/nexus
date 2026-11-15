"""Vinculación del plan de ChatGPT de cada usuario («Sign in with ChatGPT»).

El sidecar solo guarda en memoria lo necesario entre abrir la URL de OpenAI y recibir la
dirección pegada (verificador PKCE, ``state``, ``nonce``). Las credenciales resultantes se
devuelven al BFF, que las guarda cifradas en la cuenta del usuario y serializa los refrescos.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
from nas.adk.models.chatgpt import oauth
from nas.adk.models.chatgpt.oauth import ChatGptCredentials, PendingLogin
from nas.adk.models.errors import LlmAuthError, LlmError, LlmPermissionError

from .claude_code import LoginError

log = logging.getLogger("nexus_agent")

APP_NAME = "Nexus"


def login_error_message(error: LlmAuthError) -> str:
    """Traduce causas conocidas sin exponer códigos, tokens ni respuestas del proveedor."""
    messages = {
        "That is not the address of the ChatGPT sign-in page (127.0.0.1:1455)":
            "Copia la dirección completa del navegador: debe empezar por "
            "http://127.0.0.1:1455/auth/callback. Después, vuelve a empezar.",
        "The address is from another sign-in attempt; start again":
            "Esa dirección pertenece a otro intento de vinculación. Pulsa Empezar de nuevo, "
            "abre ChatGPT y pega únicamente la nueva dirección.",
        "The address does not contain an authorization code":
            "La dirección no contiene el código de autorización. Vuelve a empezar y copia "
            "la dirección completa después de autorizar en ChatGPT.",
        "The ID token does not match this sign-in attempt":
            "La identidad devuelta por OpenAI no coincide con este intento. Vuelve a empezar.",
        "The ID token has expired":
            "La identidad devuelta por OpenAI ha caducado. Vuelve a empezar.",
        "OpenAI returned an invalid ID token":
            "OpenAI ha devuelto una identidad que Nexus no puede validar. Vuelve a empezar.",
        "OpenAI did not return a refresh token":
            "OpenAI no ha devuelto el permiso necesario para mantener la sesión. "
            "Vuelve a vincular la cuenta.",
    }
    if str(error) in messages:
        return messages[str(error)]
    if error.body == "invalid_grant":
        return ("OpenAI ha rechazado el código de autorización (invalid_grant). Puede haber "
                "caducado, haberse usado ya o no corresponder a este intento. Vuelve a empezar.")
    if error.body in {"invalid_client", "unauthorized_client", "invalid_scope", "invalid_request"}:
        return (f"OpenAI ha rechazado la solicitud de Nexus ({error.body}). "
                "Revisa la integración de ChatGPT.")
    return "No se pudo validar la vinculación con OpenAI. Vuelve a empezar con una dirección nueva."


def credentials_json(creds: ChatGptCredentials) -> dict[str, Any]:
    return {
        "clientId": creds.client_id,
        "accessToken": creds.access_token,
        "refreshToken": creds.refresh_token,
        "expiresAt": creds.expires_at,
        "account": creds.account,
    }


@dataclass
class _Pending:
    owner: str
    login: PendingLogin
    expires: float


Exchange = Callable[[str, PendingLogin], Awaitable[ChatGptCredentials]]


class ChatGptLogins:
    """Inicios de sesión en curso, uno por usuario de Nexus; caducan a los quince minutos."""

    TTL_SECONDS = 900.0
    MAX_ACTIVE = 50

    def __init__(self, exchange: Exchange | None = None, ttl: float = TTL_SECONDS) -> None:
        self._exchange = exchange or (lambda pasted, pending: oauth.exchange_code(pasted, pending))
        self._ttl = ttl
        self._pending: dict[str, _Pending] = {}
        self._lock = asyncio.Lock()

    def _sweep(self) -> None:
        now = time.monotonic()
        for login_id in [k for k, v in self._pending.items() if now >= v.expires]:
            del self._pending[login_id]

    async def start(self, owner: str, host_id: str, client_id: str | None) -> tuple[str, str]:
        async with self._lock:
            self._sweep()
            for login_id in [k for k, v in self._pending.items() if v.owner == owner]:
                del self._pending[login_id]
            if len(self._pending) >= self.MAX_ACTIVE:
                raise LoginError(429, "Hay demasiados inicios de sesión en curso. Prueba en unos minutos.")
            login = oauth.start_login(host_id=host_id, app_name=APP_NAME, client_id=client_id)
            login_id = secrets.token_urlsafe(24)
            self._pending[login_id] = _Pending(owner, login, time.monotonic() + self._ttl)
        return login_id, login.url

    async def finish(self, login_id: str, owner: str, redirect_url: str) -> ChatGptCredentials:
        async with self._lock:
            self._sweep()
            pending = self._pending.get(login_id)
            if pending is None or not secrets.compare_digest(pending.owner, owner):
                raise LoginError(404, "El inicio de sesión ha caducado. Vuelve a empezar.")
            del self._pending[login_id]
        try:
            return await self._exchange(redirect_url, pending.login)
        except LlmPermissionError as error:
            raise LoginError(
                403,
                "No se ha activado el uso del plan de ChatGPT para Nexus, o tu cuenta no puede usarlo.",
            ) from error
        except LlmAuthError as error:
            raise LoginError(400, login_error_message(error)) from error
        except LlmError as error:
            log.warning("no se pudo completar el inicio de sesión de ChatGPT (%s)", type(error).__name__)
            raise LoginError(503, "No se pudo contactar con OpenAI. Inténtalo de nuevo.") from error

    async def cancel(self, login_id: str, owner: str) -> None:
        async with self._lock:
            pending = self._pending.get(login_id)
            if pending is not None and secrets.compare_digest(pending.owner, owner):
                del self._pending[login_id]


async def refresh(raw: dict[str, Any], client: httpx.AsyncClient | None = None) -> ChatGptCredentials:
    creds = ChatGptCredentials(
        client_id=str(raw["clientId"]),
        access_token=str(raw["accessToken"]),
        refresh_token=str(raw["refreshToken"]),
        expires_at=float(raw["expiresAt"]),
        account=raw.get("account"),
    )
    return await oauth.refresh(creds, client=client)

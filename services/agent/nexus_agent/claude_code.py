"""Claude Code en este contenedor: disponibilidad para Ajustes y vinculación de cuentas.

Cada persona vincula su propia suscripción de Anthropic. El sidecar nunca usa un token común
ni el de su entorno: el token de cada cuenta llega en cada petición y solo se pasa al proceso
del CLI que la atiende.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
import shutil
import tempfile
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

from nas.adk.models.claude_code import isolation
from nas.adk.models.claude_code.llm import ClaudeCodeLlm
from nas.adk.models.claude_code.login import SetupTokenSession
from nas.adk.models.claude_code.transport import AsyncioProcessTransport, capture
from nas.adk.models.errors import (
    LlmAuthError,
    LlmBillingModeError,
    LlmError,
    LlmProcessError,
    LlmTimeoutError,
)

log = logging.getLogger("nexus_agent")

RunCli = Callable[[list[str], dict[str, str]], Awaitable[tuple[int, str]]]
Status = dict[str, Any]

CACHE_SECONDS = 60.0
NOT_LINKED = "Vincula tu cuenta de Anthropic para usar Claude Code."
EXPIRED = "Tu cuenta de Anthropic ya no está vinculada o el token ha caducado. Vuelve a vincularla."


async def _run_cli(argv: list[str], env: dict[str, str]) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="nexus-cc-") as cwd:
        code, out, _ = await capture(AsyncioProcessTransport(), argv, env=env, cwd=cwd, timeout=30)
    return code, out


def _status(available: bool, reason: str | None, *, cli_ready: bool) -> Status:
    return {"available": available, "reason": reason, "cliReady": cli_ready}


def _child_env(environ: Mapping[str, str], token: str | None) -> dict[str, str]:
    env = isolation.build_child_env(environ, policy=environ.get("CLAUDE_CODE_ENV_POLICY") or "reject")
    # El token del entorno del contenedor no cuenta: sería una suscripción compartida.
    env.pop(isolation.OAUTH_TOKEN_VAR, None)
    if token:
        env[isolation.OAUTH_TOKEN_VAR] = token
    return env


async def probe_claude_code(
    token: str | None = None,
    run: RunCli = _run_cli,
    which: Callable[[str], str | None] = shutil.which,
    environ: Mapping[str, str] = os.environ,
) -> Status:
    """Comprueba el CLI y, si se da ``token``, que esa cuenta sea una suscripción válida.

    Aplica las mismas reglas que nas-adk al usarlo.
    """
    path = which(environ.get("CLAUDE_CODE_BIN") or "claude")
    if not path:
        return _status(False, "El CLI de Claude Code no está instalado en el sidecar.", cli_ready=False)
    try:
        env = _child_env(environ, token)
        code, version = await run([path, "--version"], env)
        if code != 0:
            raise LlmProcessError("`claude --version` failed")
        _, help_text = await run([path, "--help"], env)
        isolation.check_cli(version, help_text)
    except LlmBillingModeError:
        return _status(
            False,
            "Claude Code facturaría por API: el sidecar no debe tener variables ANTHROPIC_*.",
            cli_ready=False,
        )
    except LlmError as error:
        return _status(False, f"El CLI de Claude Code no es compatible: {error}", cli_ready=False)
    except Exception as error:  # noqa: BLE001 - un fallo aquí solo debe marcarlo como no disponible
        log.warning("no se pudo comprobar Claude Code (%s)", type(error).__name__)
        return _status(False, "El CLI de Claude Code no respondió.", cli_ready=False)

    if not token:
        return _status(False, NOT_LINKED, cli_ready=True)
    try:
        code, status = await run([path, "auth", "status", "--json"], env)
        isolation.check_auth_status(status, code)
    except LlmBillingModeError:
        return _status(False, "Esa credencial no es de una suscripción de Claude.", cli_ready=True)
    except LlmError:
        return _status(False, EXPIRED, cli_ready=True)
    except Exception as error:  # noqa: BLE001
        log.warning("no se pudo comprobar la cuenta de Claude Code (%s)", type(error).__name__)
        return _status(False, "El CLI de Claude Code no respondió.", cli_ready=True)
    return _status(True, None, cli_ready=True)


def _key(token: str | None) -> str:
    return hashlib.sha256(token.encode()).hexdigest() if token else ""


class ClaudeCodeStatus:
    """Resultado cacheado por cuenta: arrancar el CLI varias veces por petición sería caro."""

    def __init__(self, probe: Callable[..., Awaitable[Status]] = probe_claude_code) -> None:
        self._probe = probe
        self._lock = asyncio.Lock()
        # hash del token → (caduca, estado). Nunca se guarda el token en claro.
        self._cache: dict[str, tuple[float, Status]] = {}

    async def get(self, token: str | None = None) -> Status:
        """Estado del CLI y, con ``token``, de la cuenta vinculada de esa persona."""
        key = _key(token)
        async with self._lock:
            now = time.monotonic()
            hit = self._cache.get(key)
            if hit is None or now >= hit[0]:
                for stale in [k for k, (expires, _) in self._cache.items() if now >= expires]:
                    del self._cache[stale]
                hit = (now + CACHE_SECONDS, await self._probe(token=token))
                self._cache[key] = hit
            return hit[1]

    def forget(self, token: str) -> None:
        self._cache.pop(_key(token), None)


class LoginError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class _Login:
    owner: str
    session: SetupTokenSession
    expires: float


SessionFactory = Callable[[], SetupTokenSession]


class ClaudeCodeLogins:
    """Vinculaciones en curso (``claude setup-token``), cada una ligada a su usuario de Nexus.

    Una por usuario y pocas a la vez en todo el contenedor; caducan a los diez minutos.
    """

    MAX_ACTIVE = 5
    TTL_SECONDS = 600.0

    def __init__(
        self,
        status: ClaudeCodeStatus,
        factory: SessionFactory = SetupTokenSession,
        ttl: float = TTL_SECONDS,
    ) -> None:
        self._status = status
        self._factory = factory
        self._ttl = ttl
        self._logins: dict[str, _Login] = {}
        self._lock = asyncio.Lock()

    async def _sweep(self) -> None:
        now = time.monotonic()
        for login_id in [k for k, v in self._logins.items() if now >= v.expires]:
            await self._logins.pop(login_id).session.close()

    async def _drop_owner(self, owner: str) -> None:
        for login_id in [k for k, v in self._logins.items() if v.owner == owner]:
            await self._logins.pop(login_id).session.close()

    async def start(self, owner: str) -> tuple[str, str]:
        async with self._lock:
            await self._sweep()
            await self._drop_owner(owner)
            if len(self._logins) >= self.MAX_ACTIVE:
                raise LoginError(429, "Hay demasiadas vinculaciones en curso. Prueba en unos minutos.")
            session = self._factory()
            login_id = secrets.token_urlsafe(24)
            # Se reserva el hueco antes de lanzar el CLI para respetar el máximo.
            self._logins[login_id] = _Login(owner, session, time.monotonic() + self._ttl)
        try:
            url = await session.start()
        except LlmError as error:
            async with self._lock:
                self._logins.pop(login_id, None)
            await session.close()
            log.warning("no se pudo iniciar la vinculación de Claude Code (%s)", type(error).__name__)
            raise LoginError(503, "No se pudo iniciar la vinculación con Anthropic. Inténtalo de nuevo.") from error
        return login_id, url

    async def _take(self, login_id: str, owner: str) -> _Login:
        async with self._lock:
            await self._sweep()
            login = self._logins.get(login_id)
            # Otro usuario no puede ni saber que existe: mismo error que si no existiera.
            if login is None or not secrets.compare_digest(login.owner, owner):
                raise LoginError(404, "La vinculación ha caducado. Vuelve a empezar.")
            return self._logins.pop(login_id)

    async def finish(self, login_id: str, owner: str, code: str) -> str:
        login = await self._take(login_id, owner)
        try:
            token = await login.session.submit(code)
        except LlmAuthError as error:
            raise LoginError(
                400,
                "Anthropic no ha aceptado el código. Puede estar incompleto, caducado o ser de "
                "otro intento: vuelve a empezar.",
            ) from error
        except LlmTimeoutError as error:
            raise LoginError(408, "La vinculación ha caducado. Vuelve a empezar.") from error
        except LlmError as error:
            raise LoginError(503, "Claude Code no respondió al vincular la cuenta.") from error
        finally:
            await login.session.close()
        status = await self._status.get(token)
        if not status["available"]:
            self._status.forget(token)
            raise LoginError(400, status["reason"] or "La cuenta no es una suscripción válida de Claude.")
        return token

    async def cancel(self, login_id: str, owner: str) -> None:
        try:
            login = await self._take(login_id, owner)
        except LoginError:
            return
        await login.session.close()

    async def close(self) -> None:
        async with self._lock:
            logins, self._logins = list(self._logins.values()), {}
        for login in logins:
            await login.session.close()


ListModels = Callable[[str], Awaitable[list[dict[str, Any]]]]


async def _list_models(token: str) -> list[dict[str, Any]]:
    models = await ClaudeCodeLlm(oauth_token=token).list_models()
    return [m.model_dump() for m in models]


class ClaudeCodeModels:
    """Modelos de cada suscripción, cacheados por cuenta (hash del token) diez minutos."""

    CACHE_SECONDS = 600.0

    def __init__(self, list_models: ListModels = _list_models) -> None:
        self._list = list_models
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()

    async def get(self, token: str) -> list[dict[str, Any]]:
        key = _key(token)
        async with self._lock:
            now = time.monotonic()
            hit = self._cache.get(key)
            if hit and now < hit[0]:
                return hit[1]
            try:
                models = await self._list(token)
            except LlmAuthError as error:
                raise LoginError(401, EXPIRED) from error
            except LlmError as error:
                log.warning("no se pudieron listar los modelos de Claude Code (%s)", type(error).__name__)
                raise LoginError(503, "Claude Code no ha devuelto su lista de modelos.") from error
            for stale in [k for k, (expires, _) in self._cache.items() if now >= expires]:
                del self._cache[stale]
            self._cache[key] = (now + self.CACHE_SECONDS, models)
            return models

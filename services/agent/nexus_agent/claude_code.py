"""Disponibilidad de Claude Code en este contenedor, para mostrarla en Ajustes."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from nas.adk.models.claude_code import isolation
from nas.adk.models.claude_code.transport import AsyncioProcessTransport, capture
from nas.adk.models.errors import LlmAuthError, LlmBillingModeError, LlmError, LlmProcessError

log = logging.getLogger("nexus_agent")

RunCli = Callable[[list[str], dict[str, str]], Awaitable[tuple[int, str]]]
Status = dict[str, Any]

CACHE_SECONDS = 60.0


async def _run_cli(argv: list[str], env: dict[str, str]) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="nexus-cc-") as cwd:
        code, out, _ = await capture(AsyncioProcessTransport(), argv, env=env, cwd=cwd, timeout=30)
    return code, out


def _unavailable(reason: str) -> Status:
    return {"available": False, "reason": reason}


async def probe_claude_code(
    run: RunCli = _run_cli,
    which: Callable[[str], str | None] = shutil.which,
    environ: Mapping[str, str] = os.environ,
) -> Status:
    """Comprueba el CLI y la sesión con las mismas reglas que aplica nas-adk al usarlo."""
    path = which(environ.get("CLAUDE_CODE_BIN") or "claude")
    if not path:
        return _unavailable("El CLI de Claude Code no está instalado en el sidecar.")
    try:
        env = isolation.build_child_env(environ, policy=environ.get("CLAUDE_CODE_ENV_POLICY") or "reject")
        code, version = await run([path, "--version"], env)
        if code != 0:
            raise LlmProcessError("`claude --version` failed")
        _, help_text = await run([path, "--help"], env)
        isolation.check_cli(version, help_text)
        code, status = await run([path, "auth", "status", "--json"], env)
        isolation.check_auth_status(status, code)
    except LlmBillingModeError:
        return _unavailable(
            "Claude Code facturaría por API: el sidecar no debe tener variables ANTHROPIC_* "
            "y debe usar CLAUDE_CODE_OAUTH_TOKEN."
        )
    except LlmAuthError:
        return _unavailable(
            "Falta CLAUDE_CODE_OAUTH_TOKEN en el servidor o ha caducado (se genera con `claude setup-token`)."
        )
    except LlmError as error:
        return _unavailable(f"El CLI de Claude Code no es compatible: {error}")
    except Exception as error:  # noqa: BLE001 - un fallo aquí solo debe marcarlo como no disponible
        log.warning("no se pudo comprobar Claude Code (%s)", type(error).__name__)
        return _unavailable("El CLI de Claude Code no respondió.")
    return {"available": True, "reason": None}


class ClaudeCodeStatus:
    """Resultado cacheado: arrancar el CLI varias veces por petición sería caro."""

    def __init__(self, probe: Callable[[], Awaitable[Status]] = probe_claude_code) -> None:
        self._probe = probe
        self._lock = asyncio.Lock()
        self._value: Status | None = None
        self._expires = 0.0

    async def get(self) -> Status:
        async with self._lock:
            if self._value is None or time.monotonic() >= self._expires:
                self._value = await self._probe()
                self._expires = time.monotonic() + CACHE_SECONDS
            return self._value

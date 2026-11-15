"""Comandos dentro del contenedor del bot, con tiempo máximo y salida acotada."""

from __future__ import annotations

import asyncio
import os
import signal
from typing import Any

from .desktop import DISPLAY
from .settings import Settings

OUTPUT_LIMIT = 64_000
_SCRUBBED = {"NEXBOT_TOKEN"}


def shell_env(settings: Settings) -> dict[str, str]:
    """Entorno de los comandos: sin el token del bot y con dependencias en el volumen."""
    env = {key: value for key, value in os.environ.items() if key not in _SCRUBBED}
    python_deps = settings.deps_dir / "python"
    npm_deps = settings.deps_dir / "npm"
    env.update(
        HOME=str(settings.workspace),
        PYTHONUSERBASE=str(python_deps),
        PIP_USER="1",
        NPM_CONFIG_PREFIX=str(npm_deps),
        PATH=f"{python_deps}/bin:{npm_deps}/bin:{env.get('PATH', '')}",
    )
    if settings.desktop:
        env["DISPLAY"] = DISPLAY  # una aplicación gráfica lanzada por el bot se ve en el visor
    if settings.proxy:
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            env[name] = settings.proxy
    return env


async def run_shell(command: str, timeout_s: int, settings: Settings) -> dict[str, Any]:
    process = await asyncio.create_subprocess_shell(
        command,
        cwd=settings.workspace,
        env=shell_env(settings),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # grupo propio: al cortar se matan también sus hijos
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout_s)
    except (TimeoutError, asyncio.CancelledError) as error:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
        if isinstance(error, TimeoutError):
            return {"exitCode": -1, "stdout": "", "stderr": f"tiempo agotado ({timeout_s}s)"}
        raise
    return {
        "exitCode": process.returncode,
        "stdout": stdout[-OUTPUT_LIMIT:].decode("utf-8", "replace"),
        "stderr": stderr[-OUTPUT_LIMIT:].decode("utf-8", "replace"),
    }

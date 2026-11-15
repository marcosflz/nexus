"""Escritorio virtual del bot: pantalla Xvfb, gestor de ventanas y acciones con xdotool.

Da dos cosas: un sitio donde el navegador se ve (para que una persona observe qué
hace el bot) y acciones por píxeles. La pantalla es solo de este contenedor y no se
publica como servicio: los fotogramas salen por la API autenticada del bot.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import os
import re
import shutil
import time
from pathlib import Path

import mss
from PIL import Image

from .settings import Settings

log = logging.getLogger("nexbot.desktop")

DISPLAY = ":99"
WIDTH = 1280
HEIGHT = 800
JPEG_QUALITY = 60
# Lo que ve el modelo: más nítido que el visor, para leer texto pequeño.
MODEL_JPEG_QUALITY = 80
OPENBOX_CONFIG = "/etc/nexbot/openbox.xml"
# Varios espectadores comparten captura: no se hace más de una por este intervalo.
FRAME_CACHE_S = 0.2
START_TIMEOUT_S = 15.0
_KEY = re.compile(r"^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$")


class DesktopUnavailable(RuntimeError):
    pass


class InvalidKey(ValueError):
    pass


def _grab_jpeg(display: str, quality: int) -> bytes:
    with mss.mss(display=display) as screen:
        shot = screen.grab(screen.monitors[0])
    buffer = io.BytesIO()
    Image.frombytes("RGB", shot.size, shot.rgb).save(buffer, "JPEG", quality=quality)
    return buffer.getvalue()


def _grab_png(display: str, path: str) -> None:
    with mss.mss(display=display) as screen:
        shot = screen.grab(screen.monitors[0])
    Image.frombytes("RGB", shot.size, shot.rgb).save(path, "PNG")


class Desktop:
    def __init__(self, settings: Settings, display: str = DISPLAY) -> None:
        self._settings = settings
        self.display = display
        self.error: str | None = None
        self._server: asyncio.subprocess.Process | None = None
        self._manager: asyncio.subprocess.Process | None = None
        self._frame: tuple[float, bytes] | None = None
        self._frame_lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self._server is not None and self._server.returncode is None and self.error is None

    def status(self) -> dict[str, object]:
        return {
            "enabled": self._settings.desktop,
            "available": self.available,
            "error": self.error,
            "width": WIDTH,
            "height": HEIGHT,
        }

    def _env(self) -> dict[str, str]:
        env = {key: value for key, value in os.environ.items() if key != "NEXBOT_TOKEN"}
        env["DISPLAY"] = self.display
        return env

    def _socket(self) -> Path:
        return Path(f"/tmp/.X11-unix/X{self.display.lstrip(':')}")

    async def start(self) -> None:
        """Arranca la pantalla. Si falla, el bot sigue funcionando sin ella (headless)."""
        if not self._settings.desktop:
            return
        missing = [name for name in ("Xvfb", "openbox", "xdotool") if shutil.which(name) is None]
        if missing:
            self.error = f"faltan programas: {', '.join(missing)}"
            log.warning("escritorio no disponible", extra={"data": {"error": self.error}})
            return
        self._socket().unlink(missing_ok=True)
        self._server = await asyncio.create_subprocess_exec(
            "Xvfb", self.display, "-screen", "0", f"{WIDTH}x{HEIGHT}x24", "-nolisten", "tcp", "-dpi", "96",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=self._env(),
        )
        deadline = time.monotonic() + START_TIMEOUT_S
        while not self._socket().exists():
            if self._server.returncode is not None or time.monotonic() > deadline:
                self.error = "Xvfb no arrancó"
                log.warning("escritorio no disponible", extra={"data": {"error": self.error}})
                return
            await asyncio.sleep(0.05)
        self._manager = await asyncio.create_subprocess_exec(
            "openbox", *(["--config-file", OPENBOX_CONFIG] if Path(OPENBOX_CONFIG).exists() else []),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=self._env(),
        )
        log.info("escritorio listo", extra={"data": {"display": self.display}})

    async def stop(self) -> None:
        for process in (self._manager, self._server):
            if process is not None and process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    process.terminate()
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(process.wait(), 3)
        self._manager, self._server = None, None

    def _require(self) -> None:
        if not self.available:
            raise DesktopUnavailable(self.error or "este bot no tiene escritorio")

    async def frame(self) -> bytes:
        """Fotograma JPEG de toda la pantalla."""
        self._require()
        async with self._frame_lock:
            now = time.monotonic()
            if self._frame is not None and now - self._frame[0] < FRAME_CACHE_S:
                return self._frame[1]
            data = await asyncio.to_thread(_grab_jpeg, self.display, JPEG_QUALITY)
            self._frame = (now, data)
            return data

    async def capture(self) -> bytes:
        """Captura recién tomada para el modelo, sin la caché del visor."""
        self._require()
        return await asyncio.to_thread(_grab_jpeg, self.display, MODEL_JPEG_QUALITY)

    async def save_png(self, path: Path) -> None:
        self._require()
        await asyncio.to_thread(_grab_png, self.display, str(path))

    async def _xdotool(self, *args: str) -> None:
        self._require()
        # Lista de argumentos, sin shell: el texto del modelo no se interpreta.
        process = await asyncio.create_subprocess_exec(
            "xdotool", *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            env=self._env(),
        )
        try:
            _, stderr = await process.communicate()
        except asyncio.CancelledError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            raise
        if process.returncode != 0:
            raise RuntimeError(f"xdotool falló: {stderr.decode('utf-8', 'replace')[:200]}")

    @staticmethod
    def _check_point(x: int, y: int) -> None:
        if not (0 <= x < WIDTH and 0 <= y < HEIGHT):
            raise ValueError(f"el punto ({x}, {y}) está fuera de la pantalla de {WIDTH}x{HEIGHT}")

    async def click(self, x: int, y: int, button: int = 1, double: bool = False) -> None:
        self._check_point(x, y)
        repeat = ["--repeat", "2", "--delay", "80"] if double else []
        await self._xdotool("mousemove", "--sync", str(x), str(y), "click", *repeat, str(button))

    async def type_text(self, text: str) -> None:
        await self._xdotool("type", "--delay", "15", "--", text)

    async def key(self, combo: str) -> None:
        if not _KEY.fullmatch(combo):
            raise InvalidKey("tecla no válida; usa nombres como Return o ctrl+l")
        await self._xdotool("key", "--", combo)

    async def scroll(self, dy: int) -> None:
        button = "5" if dy > 0 else "4"
        clicks = str(max(1, min(abs(dy) // 100, 50)))
        await self._xdotool("click", "--repeat", clicks, "--delay", "20", button)

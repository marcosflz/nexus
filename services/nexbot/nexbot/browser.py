"""Navegador del bot (Chromium con Playwright).

Es automatización estructurada de páginas. Si el bot tiene escritorio, la ventana
se abre en él para que se pueda observar; si no, funciona en modo headless.

La sesión (cookies y localStorage) solo se guarda en el volumen si se autorizó.
Se usa ``storage_state`` y no un perfil de Chromium: sobrevive a un cierre brusco
desde la última tarea y conserva también las cookies de sesión.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from urllib.parse import urlsplit

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

from .desktop import Desktop
from .settings import Settings

log = logging.getLogger("nexbot.browser")
SNAPSHOT_LIMIT = 30_000


class BlockedScheme(ValueError):
    pass


def check_url(url: str) -> str:
    """Solo se navega por http(s): nada de file:, chrome: ni javascript:."""
    if urlsplit(url).scheme.lower() not in ("http", "https"):
        raise BlockedScheme("solo se permiten URLs http(s)")
    return url


class BrowserSession:
    def __init__(self, settings: Settings, desktop: Desktop | None = None) -> None:
        self._settings = settings
        self._desktop = desktop
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    @property
    def started(self) -> bool:
        return self._browser is not None and self._browser.is_connected()

    async def _ensure_context(self) -> BrowserContext:
        if self._context is not None and self.started:
            return self._context
        await self._teardown()
        self._playwright = await async_playwright().start()
        visible = self._desktop is not None and self._desktop.available
        options: dict[str, Any] = {
            "headless": not visible,
            # El sandbox de Chromium necesita user namespaces, que el contenedor no concede:
            # el aislamiento lo da el contenedor. Ver docs/nexbots.md.
            "args": ["--no-sandbox", *(["--start-maximized"] if visible else [])],
        }
        if visible:
            options["env"] = {**os.environ, "DISPLAY": self._desktop.display}  # type: ignore[union-attr]
        if self._settings.proxy:
            options["proxy"] = {"server": self._settings.proxy}
        self._browser = await self._playwright.chromium.launch(**options)
        self._context = await self._browser.new_context(
            storage_state=self._load_state(),
            accept_downloads=True,
            # En el escritorio la página ocupa la ventana real, y así coinciden los píxeles.
            **({"no_viewport": True} if visible else {"viewport": {"width": 1280, "height": 800}}),
            # Un service worker esquivaría los controles sobre las peticiones de la página.
            service_workers="block",
        )
        self._context.set_default_timeout(30_000)
        return self._context

    def _load_state(self) -> dict[str, Any] | None:
        if not self._settings.persist_browser:
            return None
        try:
            return json.loads(self._settings.browser_state.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    async def page(self) -> Page:
        context = await self._ensure_context()
        if self._page is None or self._page.is_closed():
            self._page = await context.new_page()
        return self._page

    async def fresh_page(self) -> Page:
        """Cada tarea empieza en una pestaña limpia; la sesión se mantiene."""
        if self._page is not None and not self._page.is_closed():
            await self._page.close()
        self._page = None
        return await self.page()

    async def start_trace(self) -> None:
        context = await self._ensure_context()
        await context.tracing.start(screenshots=True, snapshots=True)

    async def stop_trace(self, path: str) -> None:
        if self._context is not None:
            await self._context.tracing.stop(path=path)

    async def snapshot(self) -> dict[str, Any]:
        """Estado de la página. Es contenido de terceros: dato, nunca instrucciones."""
        page = await self.page()
        tree = await page.locator("body").aria_snapshot()
        return {
            "url": page.url,
            "title": await page.title(),
            "untrusted": True,
            "snapshot": tree[:SNAPSHOT_LIMIT],
            "truncated": len(tree) > SNAPSHOT_LIMIT,
        }

    async def save_state(self) -> None:
        if not self._settings.persist_browser or self._context is None or not self.started:
            return
        target = self._settings.browser_state
        temporary = target.with_suffix(".tmp")
        await self._context.storage_state(path=str(temporary), indexed_db=True)
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)

    async def _teardown(self) -> None:
        for closer in (self._context, self._browser):
            if closer is not None:
                try:
                    await closer.close()
                except Exception:
                    log.debug("cierre del navegador con error", exc_info=True)
        if self._playwright is not None:
            await self._playwright.stop()
        self._context, self._browser, self._playwright, self._page = None, None, None, None

    async def close(self) -> None:
        try:
            await self.save_state()
        except Exception:
            log.warning("no se pudo guardar la sesión del navegador", exc_info=True)
        await self._teardown()

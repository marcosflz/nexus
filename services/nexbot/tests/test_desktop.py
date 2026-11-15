"""Escritorio sin pantalla real: la pantalla y xdotool los prueba el e2e dentro del contenedor."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

from nexbot import steps as S
from nexbot.app import create_app
from nexbot.desktop import Desktop, DesktopUnavailable, InvalidKey
from nexbot.journal import TaskJournal
from nexbot.runner import TaskRunner
from nexbot.settings import Settings
from nexbot.shell import shell_env
from nexbot.steps import public_step
from nexbot.tools import build_mcp

AUTH = {"Authorization": "Bearer t"}
DESKTOP_DIR = Path(__file__).parent.parent / "desktop"


class FakeDesktop:
    def __init__(self, available: bool = True) -> None:
        self.available = available
        self.error = None if available else "sin pantalla"
        self.calls: list[tuple] = []

    def status(self):
        return {"enabled": True, "available": self.available, "error": self.error}

    async def start(self):
        return None

    async def stop(self):
        return None

    async def frame(self) -> bytes:
        if not self.available:
            raise DesktopUnavailable(self.error or "")
        return b"\xff\xd8jpeg"

    async def capture(self) -> bytes:
        return b"\xff\xd8captura"

    async def save_png(self, path: Path):
        path.write_bytes(b"png")
        self.calls.append(("png", path.name))

    async def click(self, x, y, button, double):
        self.calls.append(("click", x, y, button, double))

    async def type_text(self, text):
        self.calls.append(("type", text))

    async def key(self, combo):
        self.calls.append(("key", combo))

    async def scroll(self, dy):
        self.calls.append(("scroll", dy))


class NoBrowser:
    started = False

    async def fresh_page(self):
        raise AssertionError("un paso de escritorio no debe abrir el navegador")

    async def page(self):
        raise AssertionError("un paso de escritorio no debe abrir el navegador")

    async def save_state(self):
        return None

    async def close(self):
        return None


def make_settings(tmp_path: Path, **overrides) -> Settings:
    settings = Settings(bot_id="b1", token="t", root=tmp_path, **overrides)
    settings.prepare()
    return settings


def make_runner(tmp_path: Path, desktop) -> TaskRunner:
    settings = make_settings(tmp_path)
    return TaskRunner(settings, NoBrowser(), TaskJournal(settings.tasks_dir), desktop)  # type: ignore[arg-type]


async def finish(runner: TaskRunner, task_id: str) -> dict:
    async with asyncio.timeout(5):
        while True:
            task = runner.journal.load(task_id)
            if task and task["status"] not in ("queued", "running"):
                return task
            await asyncio.sleep(0.01)


async def test_desktop_steps_run_without_opening_the_browser(tmp_path: Path):
    desktop = FakeDesktop()
    runner = make_runner(tmp_path, desktop)
    runner.start()
    task = runner.submit([
        {"action": "desktop_click", "x": 10, "y": 20, "double": True},
        {"action": "desktop_type", "text": "hola"},
        {"action": "desktop_key", "key": "ctrl+l"},
        {"action": "desktop_scroll", "dy": -300},
        {"action": "desktop_screenshot", "path": "artifacts/pantalla.png"},
    ])
    done = await finish(runner, task["id"])
    await runner.stop()

    assert done["status"] == "succeeded", done["error"]
    assert desktop.calls == [
        ("click", 10, 20, 1, True),
        ("type", "hola"),
        ("key", "ctrl+l"),
        ("scroll", -300),
        ("png", "pantalla.png"),
    ]
    assert done["artifacts"] == ["artifacts/pantalla.png"]


async def test_desktop_step_fails_clearly_without_a_screen(tmp_path: Path):
    runner = make_runner(tmp_path, FakeDesktop(available=False))
    runner.start()
    task = runner.submit([{"action": "desktop_key", "key": "Return"}])
    done = await finish(runner, task["id"])
    await runner.stop()
    assert done["status"] == "failed" and "no tiene escritorio" in done["error"]
    assert done["failedStep"] == 0


def test_secret_desktop_text_is_not_stored(tmp_path: Path):
    step = S.STEPS.validate_python([{"action": "desktop_type", "text": "clave", "secret": True}])[0]
    assert public_step(step)["text"] == "***"


async def test_secret_desktop_task_is_not_requeued_after_restart(tmp_path: Path):
    first = make_runner(tmp_path, FakeDesktop())
    task = first.submit([{"action": "desktop_type", "text": "clave", "secret": True}])

    second = make_runner(tmp_path, FakeDesktop())
    assert second.recover() == {"interrupted": 1, "requeued": 0}
    assert second.journal.load(task["id"])["status"] == "interrupted"


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        S.STEPS.validate_python([{"action": "desktop_click", "x": 1, "y": 1, "cmd": "rm"}])


async def test_keys_cannot_inject_arguments(tmp_path: Path):
    desktop = Desktop(make_settings(tmp_path))
    for bad in ("--help", "a b", "Return;id", "", "+"):
        with pytest.raises(InvalidKey):
            await desktop.key(bad)


async def test_points_outside_the_screen_are_rejected(tmp_path: Path):
    desktop = Desktop(make_settings(tmp_path))
    for point in ((-1, 0), (1280, 0), (0, 800)):
        with pytest.raises(ValueError, match="fuera de la pantalla"):
            await desktop.click(*point)


def test_shell_sees_the_display_only_with_a_desktop(tmp_path: Path):
    assert "DISPLAY" in shell_env(make_settings(tmp_path, desktop=True))
    env = shell_env(make_settings(tmp_path, desktop=False))
    assert env.get("DISPLAY") != ":99"


def api(tmp_path: Path, desktop):
    app = create_app(make_settings(tmp_path), session=NoBrowser(), desktop=desktop)  # type: ignore[arg-type]
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://bot")


async def test_frame_requires_the_bot_token_and_is_a_jpeg(tmp_path: Path):
    async with api(tmp_path, FakeDesktop()) as client:
        assert (await client.get("/v1/desktop/frame")).status_code == 401
        response = await client.get("/v1/desktop/frame", headers=AUTH)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg" and response.content.startswith(b"\xff\xd8")


async def test_stream_requires_the_bot_token(tmp_path: Path):
    async with api(tmp_path, FakeDesktop()) as client:
        assert (await client.get("/v1/desktop/stream")).status_code == 401


async def test_without_a_screen_the_viewer_gets_a_conflict(tmp_path: Path):
    async with api(tmp_path, FakeDesktop(available=False)) as client:
        for path in ("/v1/desktop/frame", "/v1/desktop/stream"):
            response = await client.get(path, headers=AUTH)
            assert response.status_code == 409 and "sin pantalla" in response.text


async def test_status_reports_the_desktop(tmp_path: Path):
    async with api(tmp_path, FakeDesktop(available=False)) as client:
        body = (await client.get("/v1/status", headers=AUTH)).json()
    assert body["desktop"]["available"] is False and body["viewers"] == 0


async def mcp_call(tmp_path: Path, desktop, name: str, args: dict):
    runner = make_runner(tmp_path, desktop)
    return await build_mcp(runner).call_tool(name, args)


async def test_every_action_returns_the_resulting_screen(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("nexbot.tools.SETTLE_S", 0)
    desktop = FakeDesktop()
    content = await mcp_call(tmp_path, desktop, "desktop_click", {"x": 5, "y": 6})
    kinds = [item.type for item in content]
    assert kinds == ["text", "image"], content
    assert content[1].mimeType == "image/jpeg" and desktop.calls == [("click", 5, 6, 1, False)]


async def test_a_bot_without_a_screen_answers_with_an_error(tmp_path: Path):
    content = await mcp_call(tmp_path, FakeDesktop(available=False), "desktop_screenshot", {})
    assert [item.type for item in content] == ["text"] and "no tiene escritorio" in content[0].text


async def test_opening_a_file_url_is_refused(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("nexbot.tools.SETTLE_S", 0)
    class OpenBrowser(NoBrowser):
        async def page(self):
            return SimpleNamespace(goto=None)

    settings = make_settings(tmp_path)
    runner = TaskRunner(settings, OpenBrowser(), TaskJournal(settings.tasks_dir), FakeDesktop())  # type: ignore[arg-type]
    content = await build_mcp(runner).call_tool("desktop_open_url", {"url": "file:///etc/passwd"})
    assert "http(s)" in content[0].text and len(content) == 1


def test_the_window_manager_has_no_way_to_launch_programs():
    config = (DESKTOP_DIR / "rc.xml").read_text()
    assert "ShowMenu" not in config and "Execute" not in config and "<keyboard></keyboard>" in config
    # Una pulsación enlazada en «Frame» se come los clics dentro de la ventana.
    assert 'context name="Frame"' not in config


def test_chromium_cannot_open_local_files_or_internal_pages():
    policy = json.loads((DESKTOP_DIR / "chromium-policy.json").read_text())
    assert {"file://*", "chrome://*", "devtools://*"} <= set(policy["URLBlocklist"])
    # Sin esta excepción, el panel de la barra de direcciones se queda encima y se come los clics.
    assert policy["URLAllowlist"] == ["chrome://omnibox-popup.top-chrome"]
    # Con esta directiva activa, Playwright no puede abrir páginas.
    assert "DeveloperToolsAvailability" not in policy

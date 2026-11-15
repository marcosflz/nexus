from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from nexbot.app import create_app
from nexbot.settings import Settings

TOKEN = "tok"


class NoBrowser:
    started = False

    async def close(self):
        return None

    async def save_state(self):
        return None


@pytest.fixture
def client(tmp_path: Path):
    app = create_app(Settings(bot_id="b1", token=TOKEN, root=tmp_path), NoBrowser())  # type: ignore[arg-type]
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://bot",
        headers={"Authorization": f"Bearer {TOKEN}"},
    ), tmp_path


async def test_every_route_but_health_needs_the_token(client):
    http, _ = client
    assert (await http.get("/healthz", headers={"Authorization": ""})).status_code == 200
    for path in ("/v1/status", "/v1/tasks", "/v1/files", "/v1/logs", "/mcp"):
        assert (await http.get(path, headers={"Authorization": "Bearer otro"})).status_code == 401


async def test_files_cannot_escape_the_workspace(client):
    http, root = client
    (root / "workspace/a.txt").write_text("hola")
    assert (await http.get("/v1/files/content", params={"path": "a.txt"})).text == "hola"
    assert (await http.get("/v1/files/content", params={"path": "../state/x"})).status_code == 400
    assert (await http.get("/v1/files", params={"path": "../.."})).status_code == 400


async def test_invalid_steps_and_ids_are_rejected(client):
    http, _ = client
    bad = await http.post("/v1/tasks", json={"steps": [{"action": "nope"}]})
    assert bad.status_code == 422
    assert (await http.get("/v1/tasks/..%2F..%2Fetc")).status_code in (400, 404)

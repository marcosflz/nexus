from __future__ import annotations

import json
import time

import httpx
import pytest

from sandboxd.app import create_app
from sandboxd.docker import DockerClient, DockerError
from sandboxd.manager import (
    InvalidAgentId,
    SandboxConfig,
    SandboxManager,
    container_name,
    container_spec,
    volume_name,
)
from sandboxd.security import sign

AGENT = "11111111-2222-4333-8444-555555555555"
OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
SECRET = "s3cret"


class FakeDocker:
    """API de Docker mínima en memoria: contenedores con estado y volúmenes."""

    def __init__(self):
        self.containers: dict[str, dict] = {}
        self.volumes: set[str] = set()
        self.calls: list[tuple[str, str]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append((method, path))
        if method == "GET" and path.endswith("/json") and path.startswith("/containers/") and path != "/containers/json":
            name = path.split("/")[2]
            c = self.containers.get(name)
            return httpx.Response(200, json=c) if c else httpx.Response(404)
        if method == "POST" and path == "/containers/create":
            name = request.url.params["name"]
            spec = json.loads(request.content)
            self.containers[name] = {"Spec": spec, "State": {"Running": False}, "Labels": spec["Labels"]}
            return httpx.Response(201, json={"Id": name})
        if method == "POST" and path.endswith("/start"):
            self.containers[path.split("/")[2]]["State"]["Running"] = True
            return httpx.Response(204)
        if method == "POST" and path.endswith("/stop"):
            c = self.containers.get(path.split("/")[2])
            if c:
                c["State"]["Running"] = False
            return httpx.Response(204)
        if method == "DELETE" and path.startswith("/containers/"):
            self.containers.pop(path.split("/")[2], None)
            return httpx.Response(204)
        if method == "POST" and path == "/volumes/create":
            self.volumes.add(json.loads(request.content)["Name"])
            return httpx.Response(201, json={})
        if method == "DELETE" and path.startswith("/volumes/"):
            self.volumes.discard(path.split("/")[2])
            return httpx.Response(204)
        if method == "GET" and path == "/containers/json":
            running = [{"Id": n, "Labels": c["Labels"]} for n, c in self.containers.items() if c["State"]["Running"]]
            return httpx.Response(200, json=running)
        return httpx.Response(500, text=f"no soportado: {method} {path}")


def make_manager(config: SandboxConfig | None = None):
    fake = FakeDocker()
    docker = DockerClient("http://docker", httpx.AsyncClient(base_url="http://docker", transport=httpx.MockTransport(fake.handler)))
    return fake, SandboxManager(docker, config or SandboxConfig())


def test_names_only_accept_uuids():
    assert container_name(AGENT) == "nexus-sbx-11111111"
    assert volume_name(AGENT).endswith(AGENT)
    for bad in ["../etc/passwd", "a; rm -rf /", "x", "", AGENT + "x", "11111111-2222-4333-8444-55555555555G"]:
        with pytest.raises(InvalidAgentId):
            container_name(bad)


def test_container_spec_applies_least_privilege():
    spec = container_spec(AGENT, SandboxConfig())
    host = spec["HostConfig"]

    assert host["CapDrop"] == ["ALL"]
    assert "no-new-privileges:true" in host["SecurityOpt"]
    assert host["ReadonlyRootfs"] is True and host["Privileged"] is False
    assert host["PortBindings"] == {} and spec["ExposedPorts"] == {}  # nada publicado al host
    assert host["Memory"] > 0 and host["PidsLimit"] > 0 and host["NanoCpus"] > 0
    assert host["Binds"] == [f"{volume_name(AGENT)}:/data"]  # solo SU volumen
    assert not any("docker.sock" in bind for bind in host["Binds"])
    assert host["NetworkMode"] == "nexus-sandbox"
    cmd = " ".join(spec["Cmd"])
    assert "--blocked-origins" in cmd and "169.254" in cmd and "192.168" in cmd
    assert spec["Labels"]["nexus.agent"] == AGENT


async def test_ensure_creates_once_and_is_idempotent():
    fake, manager = make_manager()
    first = await manager.ensure(AGENT)
    again = await manager.ensure(AGENT)

    assert first.url == "http://nexus-sbx-11111111:8931/mcp" and first.status == "running"
    assert again.name == first.name
    assert sum(1 for m, p in fake.calls if (m, p) == ("POST", "/containers/create")) == 1
    assert volume_name(AGENT) in fake.volumes


async def test_ensure_restarts_a_stopped_container_without_recreating_it():
    fake, manager = make_manager()
    await manager.ensure(AGENT)
    await manager.stop(AGENT)
    assert (await manager.status(AGENT)).status == "stopped"

    await manager.ensure(AGENT)
    assert (await manager.status(AGENT)).status == "running"
    assert sum(1 for m, p in fake.calls if p == "/containers/create") == 1


async def test_each_agent_gets_its_own_container_and_volume():
    fake, manager = make_manager()
    await manager.ensure(AGENT)
    await manager.ensure(OTHER)

    assert len(fake.containers) == 2 and len(fake.volumes) == 2
    binds = [c["Spec"]["HostConfig"]["Binds"][0] for c in fake.containers.values()]
    assert len(set(binds)) == 2


async def test_destroy_keeps_the_volume_unless_purged():
    fake, manager = make_manager()
    await manager.ensure(AGENT)
    await manager.destroy(AGENT)
    assert not fake.containers and volume_name(AGENT) in fake.volumes  # cookies y ficheros se conservan
    await manager.destroy(AGENT, purge=True)
    assert volume_name(AGENT) not in fake.volumes


async def test_reaper_stops_only_idle_workspaces():
    _fake, manager = make_manager(SandboxConfig(idle_minutes=10))
    await manager.ensure(AGENT)
    await manager.ensure(OTHER)
    now = time.monotonic()
    manager._last_active[AGENT] = now - 11 * 60  # inactivo
    manager._last_active[OTHER] = now - 2 * 60  # reciente

    stopped = await manager.reap_idle(now)

    assert stopped == [AGENT]
    assert (await manager.status(AGENT)).status == "stopped"
    assert (await manager.status(OTHER)).status == "running"


async def test_docker_errors_surface_as_docker_error():
    docker = DockerClient("http://d", httpx.AsyncClient(base_url="http://d", transport=httpx.MockTransport(lambda r: httpx.Response(500, text="boom"))))
    with pytest.raises(DockerError):
        await docker.create("x", {})


def signed(body: bytes = b""):
    stamp = str(time.time())
    return {"Authorization": f"Bearer {SECRET}", "X-Nexus-Timestamp": stamp, "X-Nexus-Signature": sign(SECRET, stamp, body)}


async def test_http_api_requires_a_signed_request_and_validates_ids():
    _, manager = make_manager()
    app = create_app(manager, SECRET)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sbx") as client:
        assert (await client.get("/healthz")).status_code == 200
        assert (await client.post(f"/v1/workspaces/{AGENT}/ensure")).status_code == 401
        bad = {**signed(), "Authorization": "Bearer otro"}
        assert (await client.post(f"/v1/workspaces/{AGENT}/ensure", headers=bad)).status_code == 401

        ok = await client.post(f"/v1/workspaces/{AGENT}/ensure", headers=signed())
        assert ok.status_code == 200 and ok.json()["url"].endswith(":8931/mcp")
        invalid = await client.post("/v1/workspaces/..%2Fetc/ensure", headers=signed())
        assert invalid.status_code in (400, 404)
        assert (await client.post(f"/v1/workspaces/{AGENT}/stop", headers=signed())).json() == {"ok": True}

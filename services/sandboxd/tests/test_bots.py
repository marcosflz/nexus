from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest

from sandboxd.app import create_app
from sandboxd.bots import (
    MAX_RESPONSE_BYTES,
    PROXIED_PATHS,
    BotConfig,
    BotManager,
    BotOptions,
    BotResponseTooLarge,
    BotStartFailed,
    bot_spec,
    bot_token,
    container_name,
    network_name,
    volume_name,
)
from sandboxd.docker import DockerClient, DockerError, demux
from sandboxd.egress import Denied, EgressPolicy, handle, is_public, parse_target, rewrite_headers
from sandboxd.manager import InvalidAgentId, SandboxManager
from sandboxd.security import sign

BOT = "11111111-2222-4333-8444-555555555555"
OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
SECRET = "s3cret"


class FakeDocker:
    def __init__(self):
        self.containers: dict[str, dict] = {}
        self.networks: dict[str, dict] = {}
        self.volumes: set[str] = set()
        self.connected: list[tuple[str, str]] = []
        self.exit_on_start = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        parts = path.strip("/").split("/")
        if parts[0] == "networks":
            if method == "GET" and len(parts) == 1:
                return httpx.Response(200, json=list(self.networks.values()))
            if method == "POST" and path == "/networks/create":
                body = json.loads(request.content)
                self.networks[body["Name"]] = body
                return httpx.Response(201, json={})
            if method == "POST" and parts[2] == "connect":
                self.connected.append((parts[1], json.loads(request.content)["Container"]))
                return httpx.Response(200)
            if method == "POST" and parts[2] == "disconnect":
                return httpx.Response(200)
            if method == "GET":
                found = self.networks.get(parts[1])
                return httpx.Response(200, json=found) if found else httpx.Response(404)
            if method == "DELETE":
                self.networks.pop(parts[1], None)
                return httpx.Response(204)
        if parts[0] == "volumes":
            if method == "POST":
                self.volumes.add(json.loads(request.content)["Name"])
                return httpx.Response(201, json={})
            self.volumes.discard(parts[1])
            return httpx.Response(204)
        if parts[0] == "containers":
            if method == "GET" and path == "/containers/json":
                running = [
                    {"Labels": c["Config"]["Labels"]} for c in self.containers.values() if c["State"]["Running"]
                ]
                return httpx.Response(200, json=running)
            if method == "POST" and path == "/containers/create":
                name = request.url.params["name"]
                spec = json.loads(request.content)
                self.containers[name] = {
                    "Spec": spec, "Config": {"Labels": spec["Labels"]}, "State": {"Running": False, "Status": "created"},
                }
                return httpx.Response(201, json={"Id": name})
            name = parts[1]
            if method == "GET":
                found = self.containers.get(name)
                return httpx.Response(200, json=found) if found else httpx.Response(404)
            if method == "POST" and parts[2] == "start":
                if self.exit_on_start:
                    self.containers[name]["State"] = {"Running": False, "Status": "exited", "ExitCode": 3}
                else:
                    self.containers[name]["State"] = {"Running": True, "Status": "running"}
                return httpx.Response(204)
            if method == "POST" and parts[2] == "stop":
                if name in self.containers:
                    self.containers[name]["State"] = {"Running": False, "Status": "exited", "ExitCode": 0}
                return httpx.Response(204)
            if method == "DELETE":
                self.containers.pop(name, None)
                return httpx.Response(204)
        return httpx.Response(500, text=f"no soportado: {method} {path}")


def bot_http() -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/healthz":
            return httpx.Response(200, json={"status": "ok"})
        if request.url.path == "/v1/desktop/stream":
            return httpx.Response(
                200, headers={"content-type": "multipart/x-mixed-replace; boundary=f"}, content=b"--f\r\nframe"
            )
        return httpx.Response(
            200, json={"path": request.url.path, "auth": request.headers.get("authorization"), "host": request.url.host}
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def make(config: BotConfig | None = None):
    fake = FakeDocker()
    docker = DockerClient(
        "http://docker", httpx.AsyncClient(base_url="http://docker", transport=httpx.MockTransport(fake.handler))
    )
    return fake, BotManager(docker, config or BotConfig(secret=SECRET, start_timeout_s=1), bot_http())


def test_ids_are_validated_before_reaching_names():
    for bad in ("../x", "a;b", ""):
        with pytest.raises(InvalidAgentId):
            container_name(bad)


def test_spec_is_least_privilege_and_only_holds_its_own_token():
    config = BotConfig(secret=SECRET)
    spec = bot_spec(BOT, BotOptions(), config)
    host = spec["HostConfig"]

    assert host["CapDrop"] == ["ALL"] and "no-new-privileges:true" in host["SecurityOpt"]
    assert host["ReadonlyRootfs"] is True and host["Privileged"] is False
    assert host["PortBindings"] == {} and spec["ExposedPorts"] == {}
    assert host["Binds"] == [f"{volume_name(BOT)}:/bot"]
    assert not any("docker.sock" in bind for bind in host["Binds"])
    assert host["NetworkMode"] == network_name(BOT)
    assert host["Memory"] == host["MemorySwap"] > 0 and host["PidsLimit"] > 0 and host["NanoCpus"] > 0

    env = "\n".join(spec["Env"])
    assert bot_token(SECRET, BOT) in env and SECRET not in env.replace(bot_token(SECRET, BOT), "")
    assert bot_token(SECRET, OTHER) not in env


def test_tokens_differ_per_bot():
    assert bot_token(SECRET, BOT) != bot_token(SECRET, OTHER)


def test_network_none_gets_no_proxy():
    env = bot_spec(BOT, BotOptions(network="none"), BotConfig(secret=SECRET))["Env"]
    assert not any(e.startswith("NEXBOT_PROXY") for e in env)


def test_limits_are_enforced_by_the_service():
    for bad in ({"memoryMb": 99_999}, {"cpus": 64}, {"network": "host"}, {"privileged": True}):
        with pytest.raises(ValueError):
            BotOptions(**bad)


async def test_each_bot_gets_its_own_internal_network_and_volume():
    fake, manager = make()
    await manager.ensure(BOT, BotOptions())
    await manager.ensure(OTHER, BotOptions())

    assert len(fake.containers) == 2 and len(fake.volumes) == 2 and len(fake.networks) == 2
    assert all(n["Internal"] is True for n in fake.networks.values())
    assert all(n["Options"]["com.docker.network.bridge.inhibit_ipv4"] == "true" for n in fake.networks.values())
    subnets = {n["IPAM"]["Config"][0]["Subnet"] for n in fake.networks.values()}
    assert len(subnets) == 2
    # Ningún bot se conecta a la red de otro.
    joined = [c for _, c in fake.connected]
    assert container_name(BOT) not in joined and container_name(OTHER) not in joined


async def test_network_none_does_not_attach_the_egress_proxy():
    fake, manager = make()
    await manager.ensure(BOT, BotOptions(network="none"))
    assert ("nexus-bot-egress" not in [c for _, c in fake.connected])


async def test_ensure_is_idempotent_and_recreates_only_on_config_change():
    fake, manager = make()
    await manager.ensure(BOT, BotOptions())
    first = fake.containers[container_name(BOT)]
    await manager.ensure(BOT, BotOptions())
    assert fake.containers[container_name(BOT)] is first
    await manager.ensure(BOT, BotOptions(memoryMb=1024))
    assert fake.containers[container_name(BOT)] is not first
    assert volume_name(BOT) in fake.volumes


async def test_status_reports_the_options_the_container_was_created_with():
    _, manager = make()
    await manager.ensure(BOT, BotOptions(network="none", memoryMb=1024))
    report = await manager.status(BOT)
    assert report["options"]["network"] == "none"
    assert report["options"]["memoryMb"] == 1024


async def test_recreate_keeps_the_volume_and_destroy_needs_purge_to_delete_it():
    fake, manager = make()
    await manager.ensure(BOT, BotOptions())
    before = fake.containers[container_name(BOT)]
    await manager.recreate(BOT, BotOptions())
    assert fake.containers[container_name(BOT)] is not before and volume_name(BOT) in fake.volumes

    await manager.destroy(BOT)
    assert not fake.containers and not fake.networks and volume_name(BOT) in fake.volumes
    await manager.destroy(BOT, purge=True)
    assert volume_name(BOT) not in fake.volumes


async def test_reattach_restores_networks_and_respects_bots_without_egress():
    fake, manager = make()
    await manager.ensure(BOT, BotOptions())
    await manager.ensure(OTHER, BotOptions(network="none"))
    fake.connected.clear()

    await manager.reattach_all()

    assert (network_name(BOT), "nexus-sandboxd") in fake.connected
    assert (network_name(BOT), "nexus-bot-egress") in fake.connected
    assert (network_name(OTHER), "nexus-sandboxd") in fake.connected
    assert (network_name(OTHER), "nexus-bot-egress") not in fake.connected


async def test_a_huge_response_from_a_bot_is_cut_off():
    _, manager = make()
    await manager.ensure(BOT, BotOptions())
    manager.http = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)))
    )
    with pytest.raises(BotResponseTooLarge):
        await manager.forward(BOT, "GET", "tasks", {}, b"")


async def test_a_container_that_dies_on_start_is_reported():
    fake, manager = make()
    fake.exit_on_start = True
    with pytest.raises(BotStartFailed, match="código 3"):
        await manager.ensure(BOT, BotOptions())


def test_only_known_bot_routes_are_proxied():
    for good in ("status", "logs", "files", "files/content", "tasks", f"tasks/{BOT}", f"tasks/{BOT}/cancel"):
        assert PROXIED_PATHS.fullmatch(good)
    for bad in ("mcp", "healthz", "tasks/x/../../mcp", "tasks/abc", "../admin", ""):
        assert not PROXIED_PATHS.fullmatch(bad)


def signed(body: bytes = b""):
    stamp = str(time.time())
    return {"Authorization": f"Bearer {SECRET}", "X-Nexus-Timestamp": stamp, "X-Nexus-Signature": sign(SECRET, stamp, body)}


async def test_http_api_requires_signature_and_forwards_with_the_bots_own_token():
    _, manager = make()
    workspaces = SandboxManager(manager.docker)
    app = create_app(workspaces, SECRET, manager)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sbx") as client:
        assert (await client.post(f"/v1/bots/{BOT}/ensure", json={})).status_code == 401
        assert (await client.get(f"/v1/bots/{BOT}/status")).status_code == 401

        body = json.dumps({"options": {"network": "restricted"}}).encode()
        headers = {**signed(body), "Content-Type": "application/json"}
        created = await client.post(f"/v1/bots/{BOT}/ensure", content=body, headers=headers)
        assert created.status_code == 200 and created.json()["state"] == "running"

        forwarded = await client.get(f"/v1/bots/{BOT}/api/tasks", headers=signed())
        assert forwarded.json()["auth"] == f"Bearer {bot_token(SECRET, BOT)}"
        assert (await client.get(f"/v1/bots/{BOT}/api/mcp", headers=signed())).status_code == 404

        await client.post(f"/v1/bots/{BOT}/stop", headers=signed())
        assert (await client.get(f"/v1/bots/{BOT}/api/tasks", headers=signed())).status_code == 409


async def test_desktop_stream_is_signed_relayed_and_refused_when_stopped():
    _, manager = make()
    app = create_app(SandboxManager(manager.docker), SECRET, manager)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sbx") as client:
        assert (await client.get(f"/v1/bots/{BOT}/desktop/stream")).status_code == 401
        assert (await client.get(f"/v1/bots/{BOT}/desktop/stream?fps=99", headers=signed())).status_code == 422
        assert (await client.get(f"/v1/bots/{BOT}/desktop/stream", headers=signed())).status_code == 409

        body = json.dumps({"options": {}}).encode()
        await client.post(f"/v1/bots/{BOT}/ensure", content=body, headers={**signed(body), "Content-Type": "application/json"})
        response = await client.get(f"/v1/bots/{BOT}/desktop/stream?fps=2", headers=signed())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("multipart/x-mixed-replace")
    assert response.content == b"--f\r\nframe"


def test_only_the_frame_is_proxied_from_the_desktop_api():
    assert PROXIED_PATHS.fullmatch("desktop/frame")
    assert not PROXIED_PATHS.fullmatch("desktop/input")
    assert not PROXIED_PATHS.fullmatch("desktop/stream")


def test_desktop_is_part_of_the_container_config():
    config = BotConfig(secret=SECRET)
    assert "NEXBOT_DESKTOP=1" in bot_spec(BOT, BotOptions(), config)["Env"]
    assert "NEXBOT_DESKTOP=0" in bot_spec(BOT, BotOptions(desktop=False), config)["Env"]


def test_demux_strips_docker_stream_headers():
    frame = b"\x01\x00\x00\x00\x00\x00\x00\x05hola\n"
    assert demux(frame + frame) == "hola\nhola\n"
    assert demux(b"sin cabecera") == "sin cabecera"


# --- Proxy de salida ---------------------------------------------------------


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "::1",
     "fe80::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0", "224.0.0.1"],
)
def test_private_addresses_are_not_public(address):
    assert not is_public(address)


def test_public_addresses_are_public():
    assert is_public("93.184.216.34") and is_public("2606:2800:220:1:248:1893:25c8:1946")


def static(*addresses):
    async def resolver(_host, _port):
        return list(addresses)

    return resolver


async def test_policy_blocks_private_targets_after_resolving():
    with pytest.raises(Denied):
        await EgressPolicy(resolver=static("10.0.0.5")).check("parece-publico.example", 443)


async def test_policy_rejects_a_mix_of_public_and_private_answers():
    with pytest.raises(Denied):
        await EgressPolicy(resolver=static("93.184.216.34", "192.168.1.1")).check("rebind.example", 443)


async def test_policy_only_allows_web_ports():
    policy = EgressPolicy(resolver=static("93.184.216.34"))
    assert await policy.check("example.com", 443) == ["93.184.216.34"]
    with pytest.raises(Denied):
        await policy.check("example.com", 22)


async def test_allow_hosts_is_an_exact_exception():
    policy = EgressPolicy(allow_hosts=frozenset({"testsite"}), resolver=static("172.20.0.5"))
    assert await policy.check("TestSite.", 8080) == ["172.20.0.5"]
    with pytest.raises(Denied):
        await policy.check("testsite.evil", 8080)


def test_parse_target_handles_both_forms():
    assert parse_target("CONNECT", "example.com:443") == ("example.com", 443, "")
    assert parse_target("GET", "http://a.test:81/x?y=1") == ("a.test", 81, "/x?y=1")
    with pytest.raises(Denied):
        parse_target("GET", "/origen")
    with pytest.raises(Denied):
        parse_target("GET", "ftp://a/x")


def test_rewrite_drops_proxy_headers_and_forces_close():
    out = rewrite_headers([b"Host: a", b"Proxy-Authorization: x", b"Connection: keep-alive"])
    assert out == [b"Host: a", b"Connection: close"]


async def test_proxy_answers_403_for_a_private_destination():
    policy = EgressPolicy(resolver=static("10.0.0.5"))
    server = await asyncio.start_server(lambda r, w: handle(r, w, policy), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"CONNECT interno.test:443 HTTP/1.1\r\nHost: interno.test\r\n\r\n")
        await writer.drain()
        assert (await reader.readline()).startswith(b"HTTP/1.1 403")
        writer.close()


async def test_destroy_retries_while_docker_still_holds_the_network_and_volume():
    fake, manager = make(BotConfig(secret=SECRET, start_timeout_s=1, retry_delay_s=0))
    await manager.ensure(BOT, BotOptions())
    real_network, real_volume = manager.docker.remove_network, manager.docker.remove_volume
    failures = {"network": 2, "volume": 1}

    async def flaky_network(name):
        if failures["network"] > 0:
            failures["network"] -= 1
            raise DockerError("network has active endpoints")
        await real_network(name)

    async def flaky_volume(name):
        if failures["volume"] > 0:
            failures["volume"] -= 1
            raise DockerError("volume is in use")
        await real_volume(name)

    manager.docker.remove_network = flaky_network
    manager.docker.remove_volume = flaky_volume
    await manager.destroy(BOT, purge=True)
    assert failures == {"network": 0, "volume": 0}
    assert volume_name(BOT) not in fake.volumes


async def test_destroy_reports_a_network_that_never_frees():
    _, manager = make(BotConfig(secret=SECRET, start_timeout_s=1, retry_delay_s=0))
    await manager.ensure(BOT, BotOptions())

    async def stuck(_name):
        raise DockerError("network has active endpoints")

    manager.docker.remove_network = stuck
    with pytest.raises(DockerError):
        await manager.destroy(BOT, purge=True)


async def test_an_installation_only_touches_bots_with_its_own_label():
    fake, manager = make(BotConfig(secret=SECRET, start_timeout_s=1, label="nexus.e2e.bot"))
    await manager.ensure(BOT, BotOptions())
    labels = fake.containers[container_name(BOT)]["Config"]["Labels"]
    assert labels.get("nexus.e2e.bot") == "1" and "nexus.bot" not in labels


@pytest.mark.parametrize("status", [403, 500])
async def test_disconnecting_something_not_connected_is_not_an_error(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"message": "container x is not connected to network y"})

    docker = DockerClient("http://docker", httpx.AsyncClient(base_url="http://docker", transport=httpx.MockTransport(handler)))
    await docker.disconnect("y", "x")


async def test_a_real_disconnect_failure_is_reported():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "driver failed"})

    docker = DockerClient("http://docker", httpx.AsyncClient(base_url="http://docker", transport=httpx.MockTransport(handler)))
    with pytest.raises(DockerError):
        await docker.disconnect("y", "x")

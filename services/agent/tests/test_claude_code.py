from __future__ import annotations

import json
import time

import httpx
import pytest

from nexus_agent.app import create_app
from nexus_agent.claude_code import (
    EXPIRED,
    NOT_LINKED,
    ClaudeCodeLogins,
    ClaudeCodeStatus,
    LoginError,
    probe_claude_code,
)
from nexus_agent.security import sign

from .conftest import SECRET

HELP = (
    "--tools --disallowedTools --strict-mcp-config --restricted --safe-mode --disable-slash-commands "
    "--permission-mode --permission-prompts --no-session-persistence --system-prompt --json-schema "
    "--output-format --verbose"
)


def cli(auth: dict, auth_code: int = 0, version: str = "2.1.319 (Claude Code)"):
    async def run(argv, env):
        if argv[1] == "--version":
            return 0, version
        if argv[1] == "--help":
            return 0, HELP
        return auth_code, json.dumps(auth)

    return run


SUBSCRIPTION = {"loggedIn": True, "authMethod": "oauth_token", "apiProvider": "firstParty"}


async def probe(run, token="tok-user", environ=None, which=lambda _: "/usr/local/bin/claude"):
    return await probe_claude_code(token, run=run, which=which, environ=environ or {})


async def test_a_subscription_login_is_available():
    assert await probe(cli(SUBSCRIPTION)) == {"available": True, "reason": None, "cliReady": True}


async def test_the_users_token_goes_only_to_the_child():
    seen = []

    async def run(argv, env):
        seen.append(env.get("CLAUDE_CODE_OAUTH_TOKEN"))
        return await cli(SUBSCRIPTION)(argv, env)

    # El token del entorno del contenedor nunca se usa en lugar del del usuario.
    await probe(run, environ={"CLAUDE_CODE_OAUTH_TOKEN": "tok-env"})
    assert set(seen) == {"tok-user"}


async def test_without_a_token_only_the_cli_is_checked():
    calls = []

    async def run(argv, env):
        calls.append(argv[1])
        assert "CLAUDE_CODE_OAUTH_TOKEN" not in env
        return await cli(SUBSCRIPTION)(argv, env)

    status = await probe(run, token=None, environ={"CLAUDE_CODE_OAUTH_TOKEN": "tok-env"})
    assert status == {"available": False, "reason": NOT_LINKED, "cliReady": True}
    assert "auth" not in calls


async def test_a_missing_cli_or_expired_token_explains_what_to_do():
    status = await probe(cli(SUBSCRIPTION), which=lambda _: None)
    assert "instalado" in status["reason"] and status["cliReady"] is False
    status = await probe(cli({"loggedIn": False}, auth_code=1))
    assert status == {"available": False, "reason": EXPIRED, "cliReady": True}


async def test_a_non_subscription_credential_is_rejected():
    status = await probe(cli({"loggedIn": True, "authMethod": "api_key", "apiProvider": "firstParty"}))
    assert status["available"] is False and "suscripción" in status["reason"]


async def test_an_api_key_in_the_environment_is_rejected_before_billing():
    status = await probe(cli(SUBSCRIPTION), environ={"ANTHROPIC_API_KEY": "sk-ant"})
    assert status["available"] is False and "ANTHROPIC_" in status["reason"]


async def test_an_old_cli_is_reported():
    status = await probe(cli(SUBSCRIPTION, version="2.0.1 (Claude Code)"))
    assert status["available"] is False and "compatible" in status["reason"]


async def test_the_status_is_cached_per_account():
    seen = []

    async def fake(token):
        seen.append(token)
        return {"available": True, "reason": None, "cliReady": True}

    status = ClaudeCodeStatus(fake)
    await status.get("tok-1")
    await status.get("tok-1")
    await status.get("tok-2")
    await status.get("tok-1")
    assert seen == ["tok-1", "tok-2"]
    status.forget("tok-1")
    await status.get("tok-1")
    assert seen == ["tok-1", "tok-2", "tok-1"]


def headers(body: bytes):
    timestamp = str(time.time())
    return {
        "Authorization": f"Bearer {SECRET}",
        "X-Nexus-Timestamp": timestamp,
        "X-Nexus-Signature": sign(SECRET, timestamp, body),
    }


async def test_capabilities_needs_a_signed_request(settings):
    seen = []

    async def fake(token):
        seen.append(token)
        return {"available": False, "reason": "x", "cliReady": True}

    app = create_app(settings, claude_code=ClaudeCodeStatus(fake))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://sidecar") as client:
        assert (await client.post("/v1/capabilities", content=b"{}")).status_code == 401
        body = json.dumps({"claudeCodeToken": "tok-web"}).encode()
        response = await client.post("/v1/capabilities", content=body, headers=headers(body))
    assert response.json() == {"claudeCode": {"available": False, "reason": "x", "cliReady": True}}
    assert seen == ["tok-web"]


class FakeSession:
    def __init__(self, token="sk-ant-oat01-user", error=None):
        self.token = token
        self.error = error
        self.codes = []
        self.closed = 0

    async def start(self):
        return "https://claude.com/cai/oauth/authorize?x=1"

    async def submit(self, code):
        self.codes.append(code)
        if self.error:
            raise self.error
        return self.token

    async def close(self):
        self.closed += 1


def login_app(settings, sessions, status=None):
    async def fake(token):
        ok = status is None or status(token)
        return {"available": ok, "reason": None if ok else "caducado", "cliReady": True}

    checker = ClaudeCodeStatus(fake)
    logins = ClaudeCodeLogins(checker, factory=lambda: sessions.pop(0))
    app = create_app(settings, claude_code=checker, claude_code_logins=logins)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sidecar")


async def post(client, path, payload):
    body = json.dumps(payload).encode()
    return await client.post(path, content=body, headers=headers(body))


async def test_login_flow_returns_the_token_to_the_owner_only(settings):
    session = FakeSession()
    async with login_app(settings, [session]) as client:
        assert (await client.post("/v1/claude-code/login/start", content=b"{}")).status_code == 401
        started = (await post(client, "/v1/claude-code/login/start", {"owner": "u1"})).json()
        assert started["url"].startswith("https://claude.com/") and started["loginId"]

        # Otro usuario no puede terminar (ni descubrir) la vinculación ajena.
        other = await post(
            client, "/v1/claude-code/login/finish", {"owner": "u2", "loginId": started["loginId"], "code": "c"}
        )
        assert other.status_code == 404

        done = await post(
            client, "/v1/claude-code/login/finish", {"owner": "u1", "loginId": started["loginId"], "code": "c#s"}
        )
    assert done.status_code == 200 and done.json() == {"token": "sk-ant-oat01-user"}
    assert done.headers["cache-control"] == "no-store"
    assert session.codes == ["c#s"] and session.closed >= 1


async def test_login_is_single_use_and_rejected_codes_explain(settings):
    from nas.adk.models.errors import LlmAuthError

    async with login_app(settings, [FakeSession(error=LlmAuthError("nope"))]) as client:
        started = (await post(client, "/v1/claude-code/login/start", {"owner": "u1"})).json()
        payload = {"owner": "u1", "loginId": started["loginId"], "code": "bad"}
        first = await post(client, "/v1/claude-code/login/finish", payload)
        again = await post(client, "/v1/claude-code/login/finish", payload)
    assert first.status_code == 400 and "no ha aceptado" in first.json()["error"]
    assert again.status_code == 404


async def test_a_token_that_does_not_work_is_not_returned(settings):
    async with login_app(settings, [FakeSession()], status=lambda token: False) as client:
        started = (await post(client, "/v1/claude-code/login/start", {"owner": "u1"})).json()
        done = await post(
            client, "/v1/claude-code/login/finish", {"owner": "u1", "loginId": started["loginId"], "code": "c"}
        )
    assert done.status_code == 400 and "token" not in done.json()


async def test_a_new_login_replaces_the_previous_one_of_the_same_user(settings):
    first, second = FakeSession(), FakeSession()
    async with login_app(settings, [first, second]) as client:
        old = (await post(client, "/v1/claude-code/login/start", {"owner": "u1"})).json()
        await post(client, "/v1/claude-code/login/start", {"owner": "u1"})
        stale = await post(
            client, "/v1/claude-code/login/finish", {"owner": "u1", "loginId": old["loginId"], "code": "c"}
        )
    assert first.closed == 1 and stale.status_code == 404


async def test_expired_and_cancelled_logins_are_closed(settings):
    session = FakeSession()

    async def fake(token):
        return {"available": True, "reason": None, "cliReady": True}

    logins = ClaudeCodeLogins(ClaudeCodeStatus(fake), factory=lambda: session, ttl=0)
    login_id, _ = await logins.start("u1")
    with pytest.raises(LoginError) as info:
        await logins.finish(login_id, "u1", "c")
    assert info.value.status == 404 and session.closed == 1

    session = FakeSession()
    logins = ClaudeCodeLogins(ClaudeCodeStatus(fake), factory=lambda: session)
    login_id, _ = await logins.start("u1")
    await logins.cancel(login_id, "u2")
    assert session.closed == 0
    await logins.cancel(login_id, "u1")
    assert session.closed == 1


async def test_default_prompts_need_a_signed_request(settings):
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://sidecar") as client:
        assert (await client.post("/v1/prompts", content=b"{}")).status_code == 401
        response = await client.post("/v1/prompts", content=b"{}", headers=headers(b"{}"))
    data = response.json()
    assert set(data) == {"core", "ui", "followups"}
    assert "{name}" in data["core"] and "suggest_followups" in data["followups"]

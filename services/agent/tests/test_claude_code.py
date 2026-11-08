from __future__ import annotations

import json
import time

import httpx

from nexus_agent.app import create_app
from nexus_agent.claude_code import ClaudeCodeStatus, probe_claude_code
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


async def probe(run, environ=None, which=lambda _: "/usr/local/bin/claude"):
    return await probe_claude_code(run=run, which=which, environ=environ or {})


async def test_a_subscription_login_is_available():
    assert await probe(cli(SUBSCRIPTION)) == {"available": True, "reason": None}


async def test_a_missing_cli_or_login_explains_what_to_do():
    assert "instalado" in (await probe(cli(SUBSCRIPTION), which=lambda _: None))["reason"]
    status = await probe(cli({"loggedIn": False}, auth_code=1))
    assert status["available"] is False and "CLAUDE_CODE_OAUTH_TOKEN" in status["reason"]


async def test_an_api_key_in_the_environment_is_rejected_before_billing():
    status = await probe(cli(SUBSCRIPTION), environ={"ANTHROPIC_API_KEY": "sk-ant"})
    assert status["available"] is False and "ANTHROPIC_" in status["reason"]


async def test_an_old_cli_is_reported():
    status = await probe(cli(SUBSCRIPTION, version="2.0.1 (Claude Code)"))
    assert status["available"] is False and "compatible" in status["reason"]


async def test_the_status_is_cached():
    calls = 0

    async def fake():
        nonlocal calls
        calls += 1
        return {"available": True, "reason": None}

    status = ClaudeCodeStatus(fake)
    await status.get()
    await status.get()
    assert calls == 1


def headers():
    timestamp = str(time.time())
    return {
        "Authorization": f"Bearer {SECRET}",
        "X-Nexus-Timestamp": timestamp,
        "X-Nexus-Signature": sign(SECRET, timestamp, b""),
    }


async def test_capabilities_needs_a_signed_request(settings):
    async def fake():
        return {"available": False, "reason": "x"}

    app = create_app(settings, claude_code=ClaudeCodeStatus(fake))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://sidecar") as client:
        assert (await client.get("/v1/capabilities")).status_code == 401
        response = await client.get("/v1/capabilities", headers=headers())
    assert response.json() == {"claudeCode": {"available": False, "reason": "x"}}

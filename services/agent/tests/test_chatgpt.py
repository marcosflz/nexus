from __future__ import annotations

import json

import httpx
import pytest
from nas.adk.models.chatgpt.oauth import ChatGptCredentials, PendingLogin
from nas.adk.models.errors import LlmAuthError

from nexus_agent.app import create_app
from nexus_agent.chatgpt import ChatGptLogins, login_error_message
from nexus_agent.claude_code import ClaudeCodeModels, LoginError
from nexus_agent.contract import ModelSpec
from nexus_agent.models import UnsupportedProvider, build_model

from .test_claude_code import post


def creds() -> ChatGptCredentials:
    return ChatGptCredentials("issued-1", "at-1", "rt-1", 2_000_000_000.0, "ana@example.com")


async def test_chatgpt_login_flow_is_bound_to_its_owner(settings):
    seen: list[tuple[str, PendingLogin]] = []

    async def exchange(pasted, pending):
        seen.append((pasted, pending))
        return creds()

    app = create_app(settings, chatgpt_logins=ChatGptLogins(exchange))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sidecar") as client:
        assert (await client.post("/v1/chatgpt/login/start", content=b"{}")).status_code == 401
        started = (await post(client, "/v1/chatgpt/login/start", {"owner": "u1", "hostId": "urn:uuid:h"})).json()
        assert started["url"].startswith("https://auth.openai.com/api/accounts/authorize?")
        assert "ext_agent_host_id=urn%3Auuid%3Ah" in started["url"]

        other = await post(
            client, "/v1/chatgpt/login/finish", {"owner": "u2", "loginId": started["loginId"], "redirectUrl": "x"}
        )
        assert other.status_code == 404
        done = await post(
            client,
            "/v1/chatgpt/login/finish",
            {"owner": "u1", "loginId": started["loginId"], "redirectUrl": "http://127.0.0.1:1455/auth/callback?code=c"},
        )
    assert done.status_code == 200 and done.headers["cache-control"] == "no-store"
    assert done.json()["credentials"] == {
        "clientId": "issued-1",
        "accessToken": "at-1",
        "refreshToken": "rt-1",
        "expiresAt": 2_000_000_000.0,
        "account": "ana@example.com",
    }
    assert seen[0][0].endswith("code=c")


async def test_rejected_redirect_explains_what_to_paste():
    async def exchange(pasted, pending):
        raise LlmAuthError("That is not the address of the ChatGPT sign-in page (127.0.0.1:1455)")

    logins = ChatGptLogins(exchange)
    login_id, _ = await logins.start("u1", "h", None)
    with pytest.raises(LoginError) as info:
        await logins.finish(login_id, "u1", "bad")
    assert info.value.status == 400 and "127.0.0.1:1455" in info.value.message
    # Un solo uso.
    with pytest.raises(LoginError):
        await logins.finish(login_id, "u1", "bad")


async def test_refresh_returns_rotated_credentials_or_asks_to_relink(settings):
    def handler(request: httpx.Request) -> httpx.Response:
        form = request.content.decode()
        if "rt-dead" in form:
            return httpx.Response(400, json={"error": "refresh_token_reused"})
        return httpx.Response(200, json={"access_token": "at-2", "refresh_token": "rt-2", "expires_in": 3600})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app = create_app(settings, http=http)
    body = {"credentials": {"clientId": "c", "accessToken": "a", "refreshToken": "rt-1", "expiresAt": 1.0}}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sidecar") as client:
        ok = await post(client, "/v1/chatgpt/refresh", body)
        body["credentials"]["refreshToken"] = "rt-dead"
        dead = await post(client, "/v1/chatgpt/refresh", body)
    assert ok.json()["credentials"]["refreshToken"] == "rt-2"
    assert dead.status_code == 401 and dead.json() == {"error": "relink"}


async def test_claude_code_models_are_cached_per_account(settings):
    calls: list[str] = []

    async def fake(token):
        calls.append(token)
        return [{"id": "opus", "label": "Opus 5.5", "description": None, "efforts": []}]

    app = create_app(settings, claude_code_models=ClaudeCodeModels(fake))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sidecar") as client:
        first = await post(client, "/v1/claude-code/models", {"token": "tok-a"})
        await post(client, "/v1/claude-code/models", {"token": "tok-a"})
        await post(client, "/v1/claude-code/models", {"token": "tok-b"})
    assert first.json()["models"][0]["label"] == "Opus 5.5"
    assert calls == ["tok-a", "tok-b"]


def test_chatgpt_model_uses_the_users_token():
    model = build_model(ModelSpec(provider="chatgpt", model="gpt-6.1-sol", apiKey="at-user"))
    assert model.provider == "chatgpt" and model.api_key == "at-user" and model.model == "gpt-6.1-sol"
    with pytest.raises(UnsupportedProvider, match="ChatGPT"):
        build_model(ModelSpec(provider="chatgpt", model="m"))
    assert json.dumps(model.model_dump()).find("at-user") == -1


@pytest.mark.parametrize(("error", "expected"), [
    (LlmAuthError("The address is from another sign-in attempt; start again"), "otro intento"),
    (LlmAuthError("The ID token does not match this sign-in attempt"), "identidad"),
    (LlmAuthError("rejected", body="invalid_grant"), "invalid_grant"),
    (LlmAuthError("rejected", body="invalid_client"), "invalid_client"),
    (LlmAuthError("OpenAI did not return a refresh token"), "mantener la sesión"),
])
def test_login_errors_distinguish_callback_and_exchange_failures(error, expected):
    assert expected in login_error_message(error)


def test_login_error_does_not_expose_unknown_provider_details():
    message = login_error_message(LlmAuthError("secret-code", body="secret-token"))
    assert "secret" not in message

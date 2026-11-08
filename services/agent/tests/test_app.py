from __future__ import annotations

import json
import time

import httpx

from nexus_agent.app import create_app
from nexus_agent.security import sign

from .conftest import (
    SECRET,
    ScriptedLlm,
    factory,
    make_request,
    says,
    searx_and_bff,
    signed_headers,
)


def client_for(settings, llm=None):
    kwargs = {}
    if llm is not None:
        kwargs = {"model_factory": factory(llm), "http": searx_and_bff(), "bff_http": searx_and_bff()}
    app = create_app(settings, **kwargs)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sidecar")


def body_of(**overrides):
    return make_request(**overrides).model_dump_json().encode()


async def test_healthz_is_public(settings):
    async with client_for(settings) as client:
        response = await client.get("/healthz")
    assert response.status_code == 200 and response.json()["status"] == "ok"


async def test_runs_require_a_valid_signed_request(settings):
    body = body_of()
    async with client_for(settings) as client:
        assert (await client.post("/v1/runs", content=body)).status_code == 401
        bad = signed_headers(body) | {"Authorization": "Bearer otro"}
        assert (await client.post("/v1/runs", content=body, headers=bad)).status_code == 401
        old = signed_headers(body, ts=str(time.time() - 120))
        assert (await client.post("/v1/runs", content=body, headers=old)).status_code == 401
        tampered = signed_headers(body)
        assert (await client.post("/v1/runs", content=body + b" ", headers=tampered)).status_code == 401


async def test_a_signed_run_streams_sse_frames_ending_with_the_result(settings):
    llm = ScriptedLlm(script=[says("Hola desde el sidecar")], seen=[])
    body = body_of()
    async with client_for(settings, llm) as client:
        response = await client.post("/v1/runs", content=body, headers=signed_headers(body))

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = [json.loads(f[len("data: "):]) for f in response.text.split("\n\n") if f.startswith("data: ")]
    assert frames[-1]["name"] == "nexus.result"
    assert frames[-1]["value"]["finalText"] == "Hola desde el sidecar"
    assert any(f["type"] == "TEXT_MESSAGE_CONTENT" for f in frames)


async def test_invalid_bodies_get_a_422_that_never_echoes_the_api_key(settings):
    payload = json.dumps(
        {"runId": "r", "threadId": "t", "userId": "u",
         "model": {"provider": "openrouter", "model": "m", "apiKey": "sk-ultra-secret"},
         "limits": {"maxModelCalls": "no es un número"}}
    ).encode()
    async with client_for(settings) as client:
        response = await client.post("/v1/runs", content=payload, headers=signed_headers(payload))

    assert response.status_code == 422
    assert "sk-ultra-secret" not in response.text


async def test_the_sidecar_refuses_everything_when_no_secret_is_configured():
    from nexus_agent.settings import Settings

    body = body_of()
    async with client_for(Settings(secret="")) as client:
        headers = {"Authorization": "Bearer ", "X-Nexus-Timestamp": str(time.time()),
                   "X-Nexus-Signature": sign("", str(time.time()), body)}
        assert (await client.post("/v1/runs", content=body, headers=headers)).status_code == 401
    assert SECRET  # el secreto de test existe; solo este caso va sin configurar


async def test_complete_returns_one_model_answer_for_a_signed_request(settings):
    llm = ScriptedLlm(script=[says('{"name": "Borrador"}')], seen=[])
    payload = json.dumps(
        {"model": {"provider": "openrouter", "model": "m", "apiKey": "sk-x"},
         "system": "Eres un redactor.", "user": "Describe un agente."}
    ).encode()
    async with client_for(settings, llm) as client:
        response = await client.post("/v1/complete", content=payload, headers=signed_headers(payload))

    assert response.status_code == 200
    assert response.json()["text"] == '{"name": "Borrador"}'
    system, user = llm.seen[0][0], llm.seen[0][1]
    assert system["role"] == "system" and user["content"] == "Describe un agente."


async def test_complete_requires_a_valid_signature(settings):
    payload = json.dumps({"model": {"provider": "openrouter", "model": "m"}, "system": "s", "user": "u"}).encode()
    async with client_for(settings) as client:
        assert (await client.post("/v1/complete", content=payload)).status_code == 401


async def test_complete_reports_unsupported_providers(settings):
    payload = json.dumps({"model": {"provider": "inventado", "model": "m"}, "system": "s", "user": "u"}).encode()
    async with client_for(settings) as client:
        response = await client.post("/v1/complete", content=payload, headers=signed_headers(payload))
    assert response.status_code == 400 and "inventado" in response.json()["error"]

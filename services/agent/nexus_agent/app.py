"""API HTTP del sidecar: un único endpoint de runs por SSE."""

from __future__ import annotations

import contextlib
import json
from collections.abc import AsyncIterator
from typing import TypeVar

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from nas.adk.models.chatgpt import oauth as chatgpt_oauth
from nas.adk.models.errors import LlmAuthError, LlmError
from nas.adk.ui import FOLLOWUP_RULES, UI_RULES
from pydantic import BaseModel, ValidationError

from . import __version__
from .build import CORE_RULES
from .chatgpt import ChatGptLogins, credentials_json
from .chatgpt import refresh as chatgpt_refresh
from .claude_code import ClaudeCodeLogins, ClaudeCodeModels, ClaudeCodeStatus, LoginError
from .contract import (
    CapabilitiesRequest,
    ChatGptLoginCancel,
    ChatGptLoginFinish,
    ChatGptLoginStart,
    ChatGptModelsRequest,
    ChatGptRefreshRequest,
    ClaudeCodeLoginCancel,
    ClaudeCodeLoginFinish,
    ClaudeCodeLoginStart,
    ClaudeCodeModelsRequest,
    CompleteRequest,
    RunRequest,
    SearchTestRequest,
)
from .errors import describe_model_error
from .models import UnsupportedProvider, build_model
from .run import run_stream
from .search import Query, probe, with_default_searxng
from .security import AuthError, verify
from .settings import Settings

_M = TypeVar("_M", bound=BaseModel)


def create_app(
    settings: Settings | None = None,
    *,
    claude_code: ClaudeCodeStatus | None = None,
    claude_code_logins: ClaudeCodeLogins | None = None,
    claude_code_models: ClaudeCodeModels | None = None,
    chatgpt_logins: ChatGptLogins | None = None,
    **run_kwargs: object,
) -> FastAPI:
    config = settings or Settings()
    app = FastAPI(title="Nexus agent", version=__version__, docs_url=None, redoc_url=None)
    claude_code_status = claude_code or ClaudeCodeStatus()
    logins = claude_code_logins or ClaudeCodeLogins(claude_code_status)
    app.router.add_event_handler("shutdown", logins.close)

    async def signed(
        request: Request,
        authorization: str | None,
        timestamp: str | None,
        signature: str | None,
    ) -> bytes:
        body = await request.body()
        try:
            verify(config.secret, authorization, timestamp, signature, body)
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error
        return body

    def login_error(error: LoginError) -> JSONResponse:
        return JSONResponse(status_code=error.status, content={"error": error.message})

    cc_models = claude_code_models or ClaudeCodeModels()
    gpt_logins = chatgpt_logins or ChatGptLogins()
    http_client = run_kwargs.get("http")

    def parse(model: type[_M], body: bytes) -> _M | JSONResponse:
        try:
            return model.model_validate_json(body)
        except ValidationError:
            return JSONResponse(status_code=422, content={"error": "petición no válida"})

    @app.post("/v1/claude-code/models")
    async def claude_code_models_list(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Modelos de la suscripción del usuario, según el propio CLI (sin inferencia)."""
        payload = parse(ClaudeCodeModelsRequest, await signed(request, authorization, x_nexus_timestamp, x_nexus_signature))
        if isinstance(payload, JSONResponse):
            return payload
        try:
            models = await cc_models.get(payload.token.get_secret_value())
        except LoginError as error:
            return login_error(error)
        return JSONResponse(content={"models": models})

    @app.post("/v1/chatgpt/login/start")
    async def chatgpt_login_start(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """URL de «Sign in with ChatGPT» para que el usuario autorice su propio plan."""
        payload = parse(ChatGptLoginStart, await signed(request, authorization, x_nexus_timestamp, x_nexus_signature))
        if isinstance(payload, JSONResponse):
            return payload
        try:
            login_id, url = await gpt_logins.start(payload.owner, payload.hostId, payload.clientId)
        except LoginError as error:
            return login_error(error)
        return JSONResponse(content={"loginId": login_id, "url": url})

    @app.post("/v1/chatgpt/login/finish")
    async def chatgpt_login_finish(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Canjea la dirección pegada por las credenciales del usuario (solo para el BFF)."""
        payload = parse(ChatGptLoginFinish, await signed(request, authorization, x_nexus_timestamp, x_nexus_signature))
        if isinstance(payload, JSONResponse):
            return payload
        try:
            creds = await gpt_logins.finish(payload.loginId, payload.owner, payload.redirectUrl.get_secret_value())
        except LoginError as error:
            return login_error(error)
        return JSONResponse(content={"credentials": credentials_json(creds)}, headers={"Cache-Control": "no-store"})

    @app.post("/v1/chatgpt/login/cancel")
    async def chatgpt_login_cancel(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        payload = parse(ChatGptLoginCancel, await signed(request, authorization, x_nexus_timestamp, x_nexus_signature))
        if isinstance(payload, JSONResponse):
            return payload
        await gpt_logins.cancel(payload.loginId, payload.owner)
        return JSONResponse(content={"ok": True})

    @app.post("/v1/chatgpt/refresh")
    async def chatgpt_refresh_token(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Renueva el token de acceso. El de refresco rota: el BFF debe guardar el nuevo."""
        payload = parse(ChatGptRefreshRequest, await signed(request, authorization, x_nexus_timestamp, x_nexus_signature))
        if isinstance(payload, JSONResponse):
            return payload
        raw = payload.credentials.model_dump()
        raw["accessToken"] = payload.credentials.accessToken.get_secret_value()
        raw["refreshToken"] = payload.credentials.refreshToken.get_secret_value()
        try:
            creds = await chatgpt_refresh(raw, http_client)  # type: ignore[arg-type]
        except LlmAuthError:
            return JSONResponse(status_code=401, content={"error": "relink"})
        except LlmError:
            return JSONResponse(status_code=503, content={"error": "No se pudo contactar con OpenAI."})
        return JSONResponse(content={"credentials": credentials_json(creds)}, headers={"Cache-Control": "no-store"})

    @app.post("/v1/chatgpt/models")
    async def chatgpt_models(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        payload = parse(ChatGptModelsRequest, await signed(request, authorization, x_nexus_timestamp, x_nexus_signature))
        if isinstance(payload, JSONResponse):
            return payload
        try:
            models = await chatgpt_oauth.list_models(payload.accessToken.get_secret_value(), client=http_client)  # type: ignore[arg-type]
        except LlmAuthError:
            return JSONResponse(status_code=401, content={"error": "relink"})
        except LlmError:
            return JSONResponse(status_code=503, content={"error": "No se pudo consultar a OpenAI."})
        return JSONResponse(content={"models": models})

    @app.post("/v1/claude-code/login/start")
    async def claude_code_login_start(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Lanza ``claude setup-token`` para que un usuario vincule su propia cuenta."""
        body = await signed(request, authorization, x_nexus_timestamp, x_nexus_signature)
        try:
            payload = ClaudeCodeLoginStart.model_validate_json(body)
        except ValidationError:
            return JSONResponse(status_code=422, content={"error": "petición no válida"})
        try:
            login_id, url = await logins.start(payload.owner)
        except LoginError as error:
            return login_error(error)
        return JSONResponse(content={"loginId": login_id, "url": url})

    @app.post("/v1/claude-code/login/finish")
    async def claude_code_login_finish(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Pasa el código de autorización y devuelve el token al BFF (nunca al navegador)."""
        body = await signed(request, authorization, x_nexus_timestamp, x_nexus_signature)
        try:
            payload = ClaudeCodeLoginFinish.model_validate_json(body)
        except ValidationError:
            return JSONResponse(status_code=422, content={"error": "petición no válida"})
        try:
            token = await logins.finish(payload.loginId, payload.owner, payload.code.get_secret_value())
        except LoginError as error:
            return login_error(error)
        return JSONResponse(content={"token": token}, headers={"Cache-Control": "no-store"})

    @app.post("/v1/claude-code/login/cancel")
    async def claude_code_login_cancel(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        body = await signed(request, authorization, x_nexus_timestamp, x_nexus_signature)
        try:
            payload = ClaudeCodeLoginCancel.model_validate_json(body)
        except ValidationError:
            return JSONResponse(status_code=422, content={"error": "petición no válida"})
        await logins.cancel(payload.loginId, payload.owner)
        return JSONResponse(content={"ok": True})

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.post("/v1/capabilities")
    async def capabilities(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> dict[str, object]:
        """Qué proveedores dependen de este contenedor y si están listos."""
        body = await request.body()
        try:
            verify(config.secret, authorization, x_nexus_timestamp, x_nexus_signature, body)
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error
        try:
            payload = CapabilitiesRequest.model_validate_json(body or b"{}")
        except ValidationError as error:
            raise HTTPException(status_code=422, detail="petición no válida") from error
        token = payload.claudeCodeToken.get_secret_value() if payload.claudeCodeToken else None
        return {"claudeCode": await claude_code_status.get(token)}

    @app.post("/v1/prompts")
    async def prompts(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> dict[str, str]:
        """Textos por defecto del prompt del sistema, para editarlos desde Ajustes."""
        body = await request.body()
        try:
            verify(config.secret, authorization, x_nexus_timestamp, x_nexus_signature, body)
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error
        return {"core": CORE_RULES, "ui": UI_RULES, "followups": FOLLOWUP_RULES}

    @app.post("/v1/runs")
    async def create_run(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> StreamingResponse:
        body = await request.body()
        try:
            verify(config.secret, authorization, x_nexus_timestamp, x_nexus_signature, body)
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error

        try:
            run_request = RunRequest.model_validate_json(body)
        except ValidationError as error:
            # Sin `input` en el detalle: el cuerpo lleva la API key del usuario.
            detail = [{"loc": e["loc"], "msg": e["msg"]} for e in error.errors(include_input=False)]
            return JSONResponse(status_code=422, content={"detail": detail})  # type: ignore[return-value]

        async def frames() -> AsyncIterator[bytes]:
            async for event in run_stream(run_request, config, **run_kwargs):  # type: ignore[arg-type]
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()

        return StreamingResponse(
            frames(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    @app.post("/v1/search/test")
    async def search_test(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Una consulta real a un solo motor, para que un admin compruebe su configuración."""
        body = await request.body()
        try:
            verify(config.secret, authorization, x_nexus_timestamp, x_nexus_signature, body)
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error
        try:
            payload = SearchTestRequest.model_validate_json(body)
        except ValidationError:
            return JSONResponse(status_code=422, content={"error": "petición no válida"})
        client = run_kwargs.get("http")
        async with httpx.AsyncClient() if client is None else contextlib.nullcontext(client) as http:
            provider = with_default_searxng(payload.provider, config.searxng_url)
            attempt, hits = await probe(http, provider, Query(payload.query, max_results=3))  # type: ignore[arg-type]
        return JSONResponse(
            content={
                "ok": attempt.ok,
                "results": attempt.results,
                "ms": attempt.ms,
                "error": attempt.error,
                "degraded": attempt.degraded,
                "sample": [{"title": h.title, "url": h.url} for h in hits],
            }
        )

    @app.post("/v1/complete")
    async def complete(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        """Una sola llamada al modelo del usuario (p. ej. para redactar un borrador de agente)."""
        body = await request.body()
        try:
            verify(config.secret, authorization, x_nexus_timestamp, x_nexus_signature, body)
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error
        try:
            payload = CompleteRequest.model_validate_json(body)
        except ValidationError as error:
            detail = [{"loc": e["loc"], "msg": e["msg"]} for e in error.errors(include_input=False)]
            return JSONResponse(status_code=422, content={"detail": detail})

        factory = run_kwargs.get("model_factory", build_model)
        try:
            model = factory(payload.model)  # type: ignore[operator]
        except UnsupportedProvider as error:
            return JSONResponse(status_code=400, content={"error": str(error)})

        from nas.adk.models.base_llm import LlmRequest

        try:
            response = await model.generate_content_async(
                LlmRequest(
                    model=payload.model.model,
                    messages=[
                        {"role": "system", "content": payload.system},
                        {"role": "user", "content": payload.user},
                    ],
                    max_tokens=payload.maxTokens,
                    temperature=payload.temperature,
                )
            )
        except Exception as error:  # noqa: BLE001 - el motivo concreto se devuelve acotado
            message = describe_model_error(error) or f"{type(error).__name__}: {error}"[:300]
            return JSONResponse(status_code=502, content={"error": message})
        finally:
            await model.aclose()
        return JSONResponse(content={"text": response.content or "", "usage": response.usage})

    @app.post("/v1/skills")
    async def skills_operation(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> JSONResponse:
        from .skills import SkillOperation, skill_operation

        body = await signed(request, authorization, x_nexus_timestamp, x_nexus_signature)
        if len(body) > 16 * 1024 * 1024:
            return JSONResponse(status_code=413, content={"error": "El paquete supera 10 MB"})
        payload = parse(SkillOperation, body)
        if isinstance(payload, JSONResponse):
            return payload
        try:
            result = await skill_operation(payload)
        except (ValueError, KeyError, OSError, httpx.HTTPError) as error:
            return JSONResponse(status_code=400, content={"error": str(error)[:500]})
        return JSONResponse(content=result)

    return app


def app_factory() -> FastAPI:
    return create_app()

"""API HTTP del sidecar: un único endpoint de runs por SSE."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from . import __version__
from .contract import CompleteRequest, RunRequest
from .models import UnsupportedProvider, build_model
from .run import run_stream
from .security import AuthError, verify
from .settings import Settings


def create_app(settings: Settings | None = None, **run_kwargs: object) -> FastAPI:
    config = settings or Settings()
    app = FastAPI(title="Nexus agent", version=__version__, docs_url=None, redoc_url=None)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

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
            return JSONResponse(status_code=502, content={"error": f"{type(error).__name__}: {error}"[:300]})
        finally:
            await model.aclose()
        return JSONResponse(content={"text": response.content or "", "usage": response.usage})

    return app


def app_factory() -> FastAPI:
    return create_app()

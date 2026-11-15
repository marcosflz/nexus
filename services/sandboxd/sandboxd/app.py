"""API interna de sandboxd. Solo el BFF de Nexus debe poder llamarla."""

from __future__ import annotations

import asyncio
import contextlib
import os
from collections.abc import AsyncIterator

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .bots import (
    PROXIED_PATHS,
    BotConfig,
    BotDesktopRefused,
    BotManager,
    BotNotRunning,
    BotOptions,
    BotResponseTooLarge,
    BotStartFailed,
    NoSubnetAvailable,
)
from .docker import DockerClient, DockerError
from .manager import InvalidAgentId, SandboxConfig, SandboxManager
from .security import AuthError, verify


class EnsureBot(BaseModel):
    options: BotOptions = BotOptions()


def create_app(
    manager: SandboxManager | None = None,
    secret: str | None = None,
    bots: BotManager | None = None,
) -> FastAPI:
    shared = secret if secret is not None else os.getenv("NEXUS_AGENT_SECRET", "")

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owned = manager is None
        app.state.manager = manager or SandboxManager(
            DockerClient(os.getenv("DOCKER_HOST", "http://docker-proxy:2375")),
            SandboxConfig(
                image=os.getenv("SANDBOX_IMAGE", SandboxConfig.image),
                network=os.getenv("SANDBOX_NETWORK", SandboxConfig.network),
                idle_minutes=int(os.getenv("SANDBOX_IDLE_MINUTES", "20")),
            ),
        )
        app.state.bots = bots or BotManager(
            app.state.manager.docker, BotConfig.from_env(shared), http=httpx.AsyncClient(timeout=30.0)
        )

        async def reaper() -> None:
            while True:
                await asyncio.sleep(60)
                with contextlib.suppress(Exception):
                    await app.state.manager.reap_idle()
                with contextlib.suppress(Exception):
                    await app.state.bots.reattach_all()

        # Si este servicio se acaba de recrear, sin esto no alcanzaría a ningún bot.
        with contextlib.suppress(Exception):
            await app.state.bots.reattach_all()
        task = asyncio.create_task(reaper())
        try:
            yield
        finally:
            task.cancel()
            if owned:
                await app.state.manager.docker.aclose()

    app = FastAPI(title="Nexus sandboxd", docs_url=None, redoc_url=None, lifespan=lifespan)
    if manager is not None:
        app.state.manager = manager
    if bots is not None:
        app.state.bots = bots

    async def authorize(request: Request, authorization, timestamp, signature) -> None:
        try:
            verify(shared, authorization, timestamp, signature, await request.body())
        except AuthError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error

    def view(workspace) -> dict[str, str]:
        return {
            "agentId": workspace.agent_id,
            "container": workspace.name,
            "url": workspace.url,
            "status": workspace.status,
        }

    async def call(action):
        try:
            return await action
        except InvalidAgentId as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except DockerError as error:
            raise HTTPException(status_code=502, detail="Docker no respondió como se esperaba") from error

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/workspaces/{agent_id}/ensure")
    async def ensure(
        agent_id: str, request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ):
        await authorize(request, authorization, x_nexus_timestamp, x_nexus_signature)
        return view(await call(app.state.manager.ensure(agent_id)))

    @app.post("/v1/workspaces/{agent_id}/status")
    async def status(
        agent_id: str, request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ):
        await authorize(request, authorization, x_nexus_timestamp, x_nexus_signature)
        return view(await call(app.state.manager.status(agent_id)))

    @app.post("/v1/workspaces/{agent_id}/stop")
    async def stop(
        agent_id: str, request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ):
        await authorize(request, authorization, x_nexus_timestamp, x_nexus_signature)
        await call(app.state.manager.stop(agent_id))
        return {"ok": True}

    @app.post("/v1/workspaces/{agent_id}/destroy")
    async def destroy(
        agent_id: str, request: Request, purge: bool = False,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ):
        await authorize(request, authorization, x_nexus_timestamp, x_nexus_signature)
        await call(app.state.manager.destroy(agent_id, purge=purge))
        return {"ok": True}

    # --- NexBots -------------------------------------------------------------

    async def signed(
        request: Request,
        authorization: str | None = Header(default=None),
        x_nexus_timestamp: str | None = Header(default=None),
        x_nexus_signature: str | None = Header(default=None),
    ) -> None:
        await authorize(request, authorization, x_nexus_timestamp, x_nexus_signature)

    async def bot_call(action):
        try:
            return await action
        except InvalidAgentId as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except BotNotRunning as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except (BotStartFailed, BotResponseTooLarge, NoSubnetAvailable) as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        except DockerError as error:
            raise HTTPException(status_code=502, detail="Docker no respondió como se esperaba") from error
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="El bot no respondió") from error

    @app.post("/v1/bots/{bot_id}/ensure", dependencies=[Depends(signed)])
    async def bot_ensure(bot_id: str, body: EnsureBot):
        return await bot_call(app.state.bots.ensure(bot_id, body.options))

    @app.post("/v1/bots/{bot_id}/recreate", dependencies=[Depends(signed)])
    async def bot_recreate(bot_id: str, body: EnsureBot):
        return await bot_call(app.state.bots.recreate(bot_id, body.options))

    @app.post("/v1/bots/{bot_id}/stop", dependencies=[Depends(signed)])
    async def bot_stop(bot_id: str):
        await bot_call(app.state.bots.stop(bot_id))
        return {"ok": True}

    @app.post("/v1/bots/{bot_id}/destroy", dependencies=[Depends(signed)])
    async def bot_destroy(bot_id: str, purge: bool = False):
        await bot_call(app.state.bots.destroy(bot_id, purge=purge))
        return {"ok": True}

    @app.get("/v1/bots/{bot_id}/status", dependencies=[Depends(signed)])
    async def bot_status(bot_id: str):
        return await bot_call(app.state.bots.status(bot_id))

    @app.get("/v1/bots/{bot_id}/container-logs", dependencies=[Depends(signed)])
    async def bot_logs(bot_id: str, tail: int = 200):
        return {"logs": await bot_call(app.state.bots.logs(bot_id, max(1, min(tail, 2000))))}

    @app.get("/v1/bots/{bot_id}/mcp-link", dependencies=[Depends(signed)])
    async def bot_mcp_link(bot_id: str):
        return await bot_call(app.state.bots.mcp_link(bot_id))

    @app.get("/v1/bots/{bot_id}/desktop/stream", dependencies=[Depends(signed)])
    async def bot_desktop_stream(bot_id: str, fps: float = Query(default=2.0, ge=0.5, le=5.0)):
        try:
            media_type, body = await bot_call(app.state.bots.open_desktop_stream(bot_id, fps))
        except BotDesktopRefused as error:
            raise HTTPException(status_code=error.status, detail="El escritorio del bot no está disponible") from error
        return StreamingResponse(
            body, media_type=media_type, headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"}
        )

    @app.api_route("/v1/bots/{bot_id}/api/{path:path}", methods=["GET", "POST"], dependencies=[Depends(signed)])
    async def bot_api(bot_id: str, path: str, request: Request):
        if not PROXIED_PATHS.fullmatch(path):
            raise HTTPException(status_code=404, detail="ruta no permitida")
        upstream = await bot_call(
            app.state.bots.forward(bot_id, request.method, path, dict(request.query_params), await request.body())
        )
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type"),
        )

    return app


def app_factory() -> FastAPI:
    return create_app()

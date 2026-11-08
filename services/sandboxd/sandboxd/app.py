"""API interna de sandboxd. Solo el BFF de Nexus debe poder llamarla."""

from __future__ import annotations

import asyncio
import contextlib
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request

from .docker import DockerClient, DockerError
from .manager import InvalidAgentId, SandboxConfig, SandboxManager
from .security import AuthError, verify


def create_app(manager: SandboxManager | None = None, secret: str | None = None) -> FastAPI:
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

        async def reaper() -> None:
            while True:
                await asyncio.sleep(60)
                with contextlib.suppress(Exception):
                    await app.state.manager.reap_idle()

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

    return app


def app_factory() -> FastAPI:
    return create_app()

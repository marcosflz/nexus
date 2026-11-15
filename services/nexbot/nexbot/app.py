"""API interna del bot. Solo la alcanzan los servicios de control de su propia red."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import sys
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from starlette.types import ASGIApp, Receive, Scope, Send

from .browser import BrowserSession
from .desktop import Desktop, DesktopUnavailable
from .journal import InvalidTaskId, TaskJournal
from .runner import TaskConflict, TaskRunner
from .settings import PathEscape, Settings, safe_path
from .skills import SkillScript, execute_skill
from .tools import build_mcp

LOG_MAX_BYTES = 5 * 1024 * 1024
FILE_MAX_BYTES = 50 * 1024 * 1024
MAX_VIEWERS = 4
# Al caducar, el visor se reconecta y el BFF vuelve a comprobar el permiso.
STREAM_MAX_S = 30 * 60
STREAM_KEEPALIVE_S = 2.0
BOUNDARY = "nexbotframe"


class JsonLines(logging.Handler):
    """Log estructurado a stdout y al volumen. Nunca lleva valores escritos en páginas."""

    def __init__(self, settings: Settings) -> None:
        super().__init__()
        if settings.log_file.exists() and settings.log_file.stat().st_size > LOG_MAX_BYTES:
            settings.log_file.replace(settings.log_file.with_suffix(".old"))
        self._file = settings.log_file.open("a", buffering=1)

    def emit(self, record: logging.LogRecord) -> None:
        line = json.dumps(
            {
                "ts": time.time(),
                "level": record.levelname,
                "logger": record.name,
                "msg": record.getMessage(),
                "task": getattr(record, "task", None),
                "data": getattr(record, "data", None),
            },
            ensure_ascii=False,
        )
        self._file.write(line + "\n")
        print(line, file=sys.stdout, flush=True)


class BearerAuth:
    def __init__(self, app: ASGIApp, token: str) -> None:
        self._app = app
        self._expected = f"Bearer {token}".encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"] != "/healthz":
            sent = dict(scope["headers"]).get(b"authorization", b"")
            if not hmac.compare_digest(sent, self._expected):
                await send({"type": "http.response.start", "status": 401, "headers": []})
                await send({"type": "http.response.body", "body": b""})
                return
        await self._app(scope, receive, send)


class TaskRequest(BaseModel):
    id: str | None = None
    steps: list[dict[str, Any]] = Field(min_length=1, max_length=200)
    timeoutS: int | None = Field(default=None, ge=1, le=86_400)
    trace: bool = False


class Decision(BaseModel):
    approved: bool


def create_app(
    settings: Settings,
    session: BrowserSession | None = None,
    desktop: Desktop | None = None,
) -> FastAPI:
    settings.prepare()
    root_logger = logging.getLogger("nexbot")
    root_logger.setLevel(logging.INFO)
    root_logger.propagate = False
    root_logger.handlers = [JsonLines(settings)]
    log = logging.getLogger("nexbot.app")

    screen = desktop or Desktop(settings)
    browser = session or BrowserSession(settings, screen)
    runner = TaskRunner(settings, browser, TaskJournal(settings.tasks_dir), screen)
    viewers = {"count": 0}
    mcp = build_mcp(runner)
    mcp_app = mcp.streamable_http_app()

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await screen.start()
        recovered = runner.recover()
        log.info("arranque", extra={"data": {"botId": settings.bot_id, **recovered}})
        runner.start()
        async with mcp.session_manager.run():
            yield
        await runner.stop()
        await browser.close()
        await screen.stop()
        log.info("parada")

    app = FastAPI(title="NexBot", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.runner = runner
    app.add_middleware(BearerAuth, token=settings.token)
    app.router.routes.extend(mcp_app.routes)

    def task_or_404(task_id: str) -> dict[str, Any]:
        try:
            task = runner.journal.load(task_id)
        except InvalidTaskId as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if task is None:
            raise HTTPException(status_code=404, detail="tarea no encontrada")
        return task

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/status")
    async def status() -> dict[str, Any]:
        return {
            "botId": settings.bot_id,
            "currentTask": runner.current_id,
            "browserStarted": browser.started,
            "desktop": screen.status(),
            "viewers": viewers["count"],
            "persistBrowser": settings.persist_browser,
            "diskBytes": settings.disk_usage(),
            "diskQuotaBytes": settings.disk_quota_bytes,
        }

    @app.get("/v1/desktop/frame")
    async def desktop_frame() -> Response:
        try:
            data = await screen.frame()
        except DesktopUnavailable as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/v1/desktop/stream")
    async def desktop_stream(fps: float = Query(default=2.0, ge=0.5, le=5.0)) -> StreamingResponse:
        """Solo emite fotogramas: el visor no tiene ningún canal para actuar sobre el bot."""
        if not screen.available:
            raise HTTPException(status_code=409, detail=screen.error or "este bot no tiene escritorio")
        if viewers["count"] >= MAX_VIEWERS:
            raise HTTPException(status_code=429, detail="demasiados espectadores conectados")

        async def frames() -> AsyncIterator[bytes]:
            loop = asyncio.get_running_loop()
            started = loop.time()
            last_digest: bytes | None = None
            last_sent = 0.0
            viewers["count"] += 1
            try:
                while loop.time() - started < STREAM_MAX_S:
                    data = await screen.frame()
                    digest = hashlib.sha256(data).digest()
                    now = loop.time()
                    if digest != last_digest or now - last_sent >= STREAM_KEEPALIVE_S:
                        last_digest, last_sent = digest, now
                        yield (
                            f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                            f"Content-Length: {len(data)}\r\n\r\n"
                        ).encode() + data + b"\r\n"
                    await asyncio.sleep(1 / fps)
            except DesktopUnavailable:
                log.warning("el escritorio dejó de estar disponible durante una emisión")
            finally:
                viewers["count"] -= 1

        return StreamingResponse(
            frames(),
            media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"},
        )

    @app.post("/v1/tasks", status_code=202)
    async def create_task(request: TaskRequest) -> dict[str, Any]:
        try:
            return runner.submit(request.steps, request.id, request.timeoutS, request.trace)
        except (ValidationError, InvalidTaskId) as error:
            raise HTTPException(status_code=422, detail=str(error)[:1000]) from error

    @app.get("/v1/tasks")
    async def list_tasks(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
        return {"tasks": runner.journal.all()[:limit]}

    @app.get("/v1/tasks/{task_id}")
    async def get_task(task_id: str) -> dict[str, Any]:
        return {**task_or_404(task_id), "events": runner.journal.events(task_id)}

    @app.post("/v1/tasks/{task_id}/cancel")
    async def cancel_task(task_id: str) -> dict[str, Any]:
        task_or_404(task_id)
        return runner.cancel(task_id) or {}

    @app.post("/v1/tasks/{task_id}/decision")
    async def decide_task(task_id: str, decision: Decision) -> dict[str, Any]:
        task_or_404(task_id)
        try:
            return runner.decide(task_id, decision.approved) or {}
        except TaskConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/v1/files")
    async def list_files(path: str = "") -> dict[str, Any]:
        try:
            base = safe_path(settings.workspace, path) if path else settings.workspace
        except PathEscape as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not base.is_dir():
            raise HTTPException(status_code=404, detail="directorio no encontrado")
        return {
            "path": path,
            "entries": [
                {"name": e.name, "dir": e.is_dir(), "size": e.stat().st_size, "modified": e.stat().st_mtime}
                for e in sorted(base.iterdir())
            ],
        }

    @app.get("/v1/files/content")
    async def read_file(path: str) -> FileResponse:
        try:
            target = safe_path(settings.workspace, path)
        except PathEscape as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not target.is_file():
            raise HTTPException(status_code=404, detail="fichero no encontrado")
        if target.stat().st_size > FILE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="fichero demasiado grande")
        return FileResponse(target, media_type="application/octet-stream")

    @app.get("/v1/logs")
    async def logs(limit: int = Query(default=200, ge=1, le=2000)) -> dict[str, Any]:
        lines = settings.log_file.read_text().splitlines()[-limit:]
        return {"lines": [json.loads(line) for line in lines if line.startswith("{")]}

    script_tasks: dict[str, asyncio.Task[dict[str, Any]]] = {}

    @app.post("/v1/skills/run")
    async def run_skill(payload: SkillScript) -> dict[str, Any]:
        if runner.browser_lock.locked() or payload.runId in script_tasks:
            raise HTTPException(status_code=409, detail="El entorno está ocupado")
        async with runner.browser_lock:
            task = asyncio.create_task(execute_skill(payload, settings))
            script_tasks[payload.runId] = task
            try:
                return await task
            except (TimeoutError, ValueError, OSError) as error:
                raise HTTPException(status_code=400, detail=str(error) or "El script agotó su tiempo") from error
            finally:
                script_tasks.pop(payload.runId, None)

    @app.post("/v1/skills/cancel")
    async def cancel_skill(payload: dict[str, str]) -> dict[str, bool]:
        task = script_tasks.get(payload.get("runId", ""))
        if task:
            task.cancel()
        return {"cancelled": task is not None}

    return app


def app_factory() -> FastAPI:
    return create_app(Settings.from_env())

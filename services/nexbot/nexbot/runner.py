"""Ejecución de tareas: una cola por bot y una tarea a la vez.

Un solo trabajador porque el navegador y el workspace son un recurso compartido
dentro del bot: dos tareas simultáneas se pisarían la pestaña. La concurrencia
real se consigue con varios bots.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from typing import Any

from pydantic import BaseModel

from . import steps as S
from .browser import BrowserSession, check_url
from .desktop import Desktop
from .journal import TaskJournal, check_id
from .settings import Settings, safe_path
from .shell import run_shell

log = logging.getLogger("nexbot.runner")

ACTIVE = ("queued", "running", "awaiting_approval")
ERROR_LIMIT = 1000
_VARIABLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


class StepError(Exception):
    pass


class QuotaExceeded(StepError):
    pass


class ApprovalDenied(Exception):
    pass


class TaskConflict(Exception):
    pass


def render(template: str, variables: dict[str, Any]) -> str:
    return _VARIABLE.sub(lambda m: str(variables.get(m.group(1), m.group(0))), template)


def describe(step: BaseModel) -> dict[str, Any]:
    """Lo que se puede dejar en los eventos: nunca valores escritos ni URLs con parámetros."""
    detail: dict[str, Any] = {"action": step.action}  # type: ignore[attr-defined]
    for field in ("selector", "path", "key", "x", "y"):
        if getattr(step, field, None) is not None:
            detail[field] = getattr(step, field)
    if isinstance(step, S.Goto):
        detail["url"] = step.url.split("?", 1)[0]
    return detail


class TaskRunner:
    def __init__(
        self,
        settings: Settings,
        session: BrowserSession,
        journal: TaskJournal,
        desktop: Desktop | None = None,
    ) -> None:
        self.settings = settings
        self.session = session
        self.journal = journal
        self.desktop = desktop
        # Tareas y herramientas MCP comparten navegador: se turnan con este cerrojo.
        self.browser_lock = asyncio.Lock()
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._live_steps: dict[str, list[BaseModel]] = {}
        self._worker: asyncio.Task[None] | None = None
        self._current: asyncio.Task[None] | None = None
        self._current_id: str | None = None
        self._cancel_reason: str | None = None
        self._approvals: dict[str, asyncio.Future[bool]] = {}

    @property
    def current_id(self) -> str | None:
        return self._current_id

    # --- Ciclo de vida ------------------------------------------------------

    def recover(self) -> dict[str, int]:
        """Estado tras un arranque. Lo que estaba en marcha NO se reanuda: se marca."""
        interrupted = requeued = 0
        for task in sorted(self.journal.all(), key=lambda t: t.get("createdAt", 0)):
            status = task.get("status")
            has_secret = any("***" in (s.get("value"), s.get("text")) for s in task.get("steps", []))
            if status in ("running", "awaiting_approval") or (status == "queued" and has_secret):
                self._finish(task, "interrupted", error="El bot se reinició antes de terminar la tarea")
                interrupted += 1
            elif status == "queued":
                self._live_steps[task["id"]] = S.STEPS.validate_python(task["steps"])
                self._queue.put_nowait(task["id"])
                requeued += 1
        return {"interrupted": interrupted, "requeued": requeued}

    def start(self) -> None:
        self._worker = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._current is not None and not self._current.done():
            self._cancel_reason = "interrupted"
            self._current.cancel()
            await asyncio.wait({self._current}, timeout=10)
        if self._worker is not None:
            self._worker.cancel()
            await asyncio.wait({self._worker}, timeout=2)

    # --- API ----------------------------------------------------------------

    def submit(
        self,
        raw_steps: list[dict[str, Any]],
        task_id: str | None = None,
        timeout_s: int | None = None,
        trace: bool = False,
    ) -> dict[str, Any]:
        steps = S.STEPS.validate_python(raw_steps)
        identifier = check_id(task_id) if task_id else str(uuid.uuid4())
        existing = self.journal.load(identifier)
        if existing is not None:
            return existing  # idempotente: reenviar la misma tarea no la repite
        limit = min(timeout_s or self.settings.task_timeout_s, self.settings.task_timeout_s)
        task = {
            "id": identifier,
            "botId": self.settings.bot_id,
            "status": "queued",
            "steps": [S.public_step(step) for step in steps],
            "timeoutS": limit,
            "trace": trace,
            "createdAt": time.time(),
            "startedAt": None,
            "finishedAt": None,
            "error": None,
            "failedStep": None,
            "result": None,
            "artifacts": [],
            "approval": None,
        }
        self.journal.save(task)
        self.journal.append_event(identifier, {"type": "queued"})
        self._live_steps[identifier] = steps
        self._queue.put_nowait(identifier)
        return task

    def cancel(self, task_id: str) -> dict[str, Any] | None:
        task = self.journal.load(task_id)
        if task is None:
            return None
        if task_id == self._current_id and self._current is not None:
            self._cancel_reason = "cancelled"
            self._current.cancel()
        elif task["status"] == "queued":
            self._finish(task, "cancelled", error="Cancelada antes de empezar")
        return self.journal.load(task_id)

    def decide(self, task_id: str, approved: bool) -> dict[str, Any] | None:
        future = self._approvals.get(task_id)
        if future is None or future.done():
            raise TaskConflict("la tarea no está esperando una aprobación")
        future.set_result(approved)
        return self.journal.load(task_id)

    # --- Bucle --------------------------------------------------------------

    async def _loop(self) -> None:
        while True:
            task_id = await self._queue.get()
            task = self.journal.load(task_id)
            if task is None or task["status"] != "queued":
                continue
            self._cancel_reason = None
            self._current_id = task_id
            self._current = asyncio.create_task(self._run(task))
            # asyncio.wait no propaga la cancelación de la tarea al trabajador.
            await asyncio.wait({self._current})
            self._current, self._current_id = None, None

    def _event(self, task: dict[str, Any], kind: str, **data: Any) -> None:
        self.journal.append_event(task["id"], {"type": kind, **data})
        log.info(kind, extra={"task": task["id"], "data": data})

    def _finish(self, task: dict[str, Any], status: str, error: str | None = None) -> None:
        task.update(status=status, finishedAt=time.time(), error=error[:ERROR_LIMIT] if error else None)
        self.journal.save(task)
        self.journal.append_event(task["id"], {"type": status, "error": task["error"]})
        log.info(status, extra={"task": task["id"], "data": {"error": task["error"]}})
        self._live_steps.pop(task["id"], None)

    def check_quota(self) -> None:
        if self.settings.disk_usage() > self.settings.disk_quota_bytes:
            raise QuotaExceeded("El bot ha superado su cuota de disco")

    async def _run(self, task: dict[str, Any]) -> None:
        loop = asyncio.get_running_loop()
        steps = self._live_steps[task["id"]]
        uses_browser = any(
            not isinstance(s, (S.Shell, S.WriteFile, S.Approve, *S.DESKTOP_STEPS)) for s in steps
        )
        variables: dict[str, Any] = {}
        current = -1
        tracing = False
        try:
            async with self.browser_lock:
                task.update(status="running", startedAt=time.time())
                self.journal.save(task)
                self._event(task, "running")
                self.check_quota()
                if uses_browser:
                    await self.session.fresh_page()
                    if task["trace"]:
                        await self.session.start_trace()
                        tracing = True
                deadline = loop.time() + task["timeoutS"]
                for current, step in enumerate(steps):
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise TimeoutError
                    self._event(task, "step_started", index=current, **describe(step))
                    if isinstance(step, S.Approve):
                        paused_at = loop.time()
                        await self._await_approval(task, step)
                        deadline += loop.time() - paused_at  # esperar a una persona no consume el límite
                    else:
                        async with asyncio.timeout(remaining):
                            await self._execute(task, step, variables)
                    self._event(task, "step_done", index=current)
                task["result"] = {"variables": variables}
                self._finish(task, "succeeded")
        except TimeoutError:
            task["failedStep"] = current
            await self._capture_failure(task)
            self._finish(task, "timeout", error=f"La tarea superó su límite de {task['timeoutS']} s")
        except asyncio.CancelledError:
            task["failedStep"] = current
            reason = self._cancel_reason or "interrupted"
            self._finish(task, reason, error="Cancelada" if reason == "cancelled" else "El bot se detuvo")
        except ApprovalDenied as error:
            task["failedStep"] = current
            self._finish(task, "denied", error=str(error))
        except Exception as error:  # noqa: BLE001 - el fallo de una tarea no debe tumbar al trabajador
            task["failedStep"] = current
            await self._capture_failure(task)
            self._finish(task, "failed", error=f"{type(error).__name__}: {error}")
        finally:
            await self._cleanup(task, tracing)

    async def _cleanup(self, task: dict[str, Any], tracing: bool) -> None:
        try:
            if tracing:
                await self.session.stop_trace(str(self.journal.artifact(task["id"], ".trace.zip")))
            await self.session.save_state()
        except Exception:
            log.warning("limpieza de la tarea con error", exc_info=True)

    async def _capture_failure(self, task: dict[str, Any]) -> None:
        target = self.journal.artifact(task["id"], ".failure.png")
        try:
            # La pantalla completa enseña también lo que hay fuera de la página.
            if self.desktop is not None and self.desktop.available:
                await self.desktop.save_png(target)
            elif self.session.started:
                page = await self.session.page()
                await page.screenshot(path=str(target), timeout=5000)
        except Exception:
            log.debug("sin captura de fallo", exc_info=True)

    async def _await_approval(self, task: dict[str, Any], step: S.Approve) -> None:
        future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self._approvals[task["id"]] = future
        task.update(status="awaiting_approval", approval={"message": step.message})
        self.journal.save(task)
        self._event(task, "awaiting_approval")
        try:
            async with asyncio.timeout(self.settings.approval_timeout_s):
                approved = await future
        except TimeoutError:
            raise ApprovalDenied("Nadie aprobó la acción a tiempo") from None
        finally:
            self._approvals.pop(task["id"], None)
        if not approved:
            raise ApprovalDenied("Una persona denegó la acción")
        task.update(status="running", approval=None)
        self.journal.save(task)
        self._event(task, "approved")

    def _workspace_path(self, task: dict[str, Any], relative: str, record: bool = True):
        path = safe_path(self.settings.workspace, relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        if record:
            name = str(path.relative_to(self.settings.workspace.resolve()))
            if name not in task["artifacts"]:
                task["artifacts"].append(name)
        return path

    async def _execute(self, task: dict[str, Any], step: BaseModel, variables: dict[str, Any]) -> None:
        if isinstance(step, S.WriteFile):
            path = self._workspace_path(task, render(step.path, variables))
            path.write_text(render(step.content, variables))
            self.check_quota()
            return
        if isinstance(step, S.Shell):
            result = await run_shell(render(step.command, variables), step.timeout_s, self.settings)
            variables["shell"] = result
            self._event(task, "shell_exit", exitCode=result["exitCode"])
            if result["exitCode"] != 0 and not step.allow_failure:
                raise StepError(f"el comando terminó con código {result['exitCode']}: {result['stderr'][-300:]}")
            return

        if isinstance(step, S.DESKTOP_STEPS):
            await self._execute_desktop(task, step, variables)
            return

        page = await self.session.page()
        if isinstance(step, S.Goto):
            await page.goto(check_url(render(step.url, variables)), wait_until="domcontentloaded")
        elif isinstance(step, S.Fill):
            await page.locator(step.selector).fill(render(step.value, variables))
        elif isinstance(step, S.Click):
            await page.locator(step.selector).click()
        elif isinstance(step, S.Press):
            if step.selector:
                await page.locator(step.selector).press(step.key)
            else:
                await page.keyboard.press(step.key)
        elif isinstance(step, S.Scroll):
            await page.mouse.wheel(0, step.dy)
        elif isinstance(step, S.WaitFor):
            await page.locator(step.selector).wait_for(timeout=step.timeout_ms)
        elif isinstance(step, S.Extract):
            locator = page.locator(step.selector)
            variables[step.save_as] = (
                await locator.get_attribute(step.attribute)
                if step.attribute
                else await locator.inner_text()
            )
        elif isinstance(step, S.Screenshot):
            path = self._workspace_path(task, render(step.path, variables))
            await page.screenshot(path=str(path), full_page=step.full_page)
        elif isinstance(step, S.Download):
            path = self._workspace_path(task, render(step.path, variables))
            async with page.expect_download() as info:
                await page.locator(step.selector).click()
            await (await info.value).save_as(str(path))
            self.check_quota()
        elif isinstance(step, S.Upload):
            source = safe_path(self.settings.workspace, render(step.path, variables))
            if not source.is_file():
                raise StepError("el fichero a subir no existe en el workspace")
            await page.locator(step.selector).set_input_files(str(source))
        else:
            raise StepError(f"paso no soportado: {type(step).__name__}")
        self.journal.save(task)

    async def _execute_desktop(self, task: dict[str, Any], step: BaseModel, variables: dict[str, Any]) -> None:
        if self.desktop is None or not self.desktop.available:
            raise StepError("este bot no tiene escritorio")
        if isinstance(step, S.DesktopClick):
            await self.desktop.click(step.x, step.y, step.button, step.double)
        elif isinstance(step, S.DesktopType):
            await self.desktop.type_text(render(step.text, variables))
        elif isinstance(step, S.DesktopKey):
            await self.desktop.key(step.key)
        elif isinstance(step, S.DesktopScroll):
            await self.desktop.scroll(step.dy)
        elif isinstance(step, S.DesktopScreenshot):
            await self.desktop.save_png(self._workspace_path(task, render(step.path, variables)))
        self.journal.save(task)




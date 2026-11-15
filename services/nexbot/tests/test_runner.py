from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from nexbot.browser import BlockedScheme, check_url
from nexbot.journal import InvalidTaskId, TaskJournal
from nexbot.runner import TaskConflict, TaskRunner, render
from nexbot.settings import PathEscape, Settings, safe_path
from nexbot.shell import shell_env


class NoBrowser:
    """Estas pruebas no abren el navegador: lo cubre el e2e con Chromium real."""

    started = False

    async def fresh_page(self):
        raise AssertionError("no debería abrir el navegador")

    async def page(self):
        raise AssertionError("no debería abrir el navegador")

    async def save_state(self):
        return None


def make_runner(tmp_path: Path, **overrides) -> TaskRunner:
    settings = Settings(bot_id="b1", token="t", root=tmp_path, **overrides)
    settings.prepare()
    return TaskRunner(settings, NoBrowser(), TaskJournal(settings.tasks_dir))  # type: ignore[arg-type]


async def wait_for(runner: TaskRunner, task_id: str, *statuses: str, timeout: float = 5) -> dict:
    async with asyncio.timeout(timeout):
        while True:
            task = runner.journal.load(task_id)
            if task and task["status"] in statuses:
                return task
            await asyncio.sleep(0.01)


def test_safe_path_stays_inside_workspace(tmp_path: Path):
    assert safe_path(tmp_path, "a/b.txt") == (tmp_path / "a/b.txt").resolve()
    for bad in ("/etc/passwd", "../fuera", "a/../../fuera", "", "~/x", "a\x00b", "."):
        with pytest.raises(PathEscape):
            safe_path(tmp_path, bad)


def test_safe_path_rejects_symlinks_that_leave_the_workspace(tmp_path: Path):
    workspace = tmp_path / "w"
    workspace.mkdir()
    (workspace / "salida").symlink_to(tmp_path)
    with pytest.raises(PathEscape):
        safe_path(workspace, "salida/secreto")


def test_only_http_urls_can_be_opened():
    assert check_url("https://example.com/a") == "https://example.com/a"
    for bad in ("file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "about:blank"):
        with pytest.raises(BlockedScheme):
            check_url(bad)


def test_render_leaves_unknown_variables_alone():
    assert render("{{a}}-{{ b }}", {"a": 1}) == "1-{{ b }}"


def test_unknown_step_fields_are_rejected(tmp_path: Path):
    runner = make_runner(tmp_path)
    with pytest.raises(ValidationError):
        runner.submit([{"action": "goto", "url": "http://x", "extra": 1}])
    with pytest.raises(ValidationError):
        runner.submit([{"action": "formatear_disco"}])


def test_task_ids_cannot_traverse(tmp_path: Path):
    journal = TaskJournal(tmp_path)
    with pytest.raises(InvalidTaskId):
        journal.load("../../etc/passwd")


def test_shell_env_hides_the_bot_token_and_keeps_deps_in_the_volume(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("NEXBOT_TOKEN", "secreto")
    env = shell_env(Settings(bot_id="b", token="secreto", root=tmp_path, proxy="http://p:1"))
    assert "NEXBOT_TOKEN" not in env
    assert env["PYTHONUSERBASE"].startswith(str(tmp_path))
    assert env["HTTPS_PROXY"] == "http://p:1"


async def test_task_writes_artifact_and_records_result(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    task = runner.submit(
        [
            {"action": "shell", "command": "echo hola"},
            {"action": "write_file", "path": "artifacts/r.txt", "content": "{{shell}}"},
        ]
    )
    done = await wait_for(runner, task["id"], "succeeded", "failed")
    await runner.stop()

    assert done["status"] == "succeeded", done["error"]
    assert done["artifacts"] == ["artifacts/r.txt"]
    assert "hola" in (runner.settings.workspace / "artifacts/r.txt").read_text()
    kinds = [event["type"] for event in runner.journal.events(task["id"])]
    assert kinds[0] == "queued" and kinds[-1] == "succeeded" and "step_done" in kinds


async def test_failure_is_recorded_with_the_failing_step(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    task = runner.submit(
        [{"action": "write_file", "path": "a.txt", "content": "x"}, {"action": "shell", "command": "exit 7"}]
    )
    done = await wait_for(runner, task["id"], "succeeded", "failed")
    await runner.stop()

    assert done["status"] == "failed" and done["failedStep"] == 1
    assert "código 7" in done["error"]
    assert runner.journal.events(task["id"])[-1]["type"] == "failed"


async def test_workspace_escape_fails_the_task_without_writing(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    task = runner.submit([{"action": "write_file", "path": "../state/x", "content": "x"}])
    done = await wait_for(runner, task["id"], "failed")
    await runner.stop()
    assert "PathEscape" in done["error"] and not (tmp_path / "state/x").exists()


async def test_timeout_kills_the_command_and_marks_the_task(tmp_path: Path):
    runner = make_runner(tmp_path, task_timeout_s=1)
    runner.start()
    task = runner.submit([{"action": "shell", "command": "sleep 30"}])
    done = await wait_for(runner, task["id"], "timeout", "failed")
    await runner.stop()
    assert done["status"] == "timeout"


async def test_tasks_run_one_at_a_time_in_order(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    first = runner.submit([{"action": "shell", "command": "sleep 0.2; echo a >> o.txt"}])
    second = runner.submit([{"action": "shell", "command": "echo b >> o.txt"}])
    await wait_for(runner, second["id"], "succeeded")
    await runner.stop()
    assert runner.journal.load(first["id"])["status"] == "succeeded"
    assert (runner.settings.workspace / "o.txt").read_text().split() == ["a", "b"]


async def test_cancel_stops_a_running_task(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    task = runner.submit([{"action": "shell", "command": "sleep 30"}])
    await wait_for(runner, task["id"], "running")
    await asyncio.sleep(0.05)
    runner.cancel(task["id"])
    done = await wait_for(runner, task["id"], "cancelled")
    await runner.stop()
    assert done["error"] == "Cancelada"


async def test_approval_blocks_until_approved(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    task = runner.submit(
        [{"action": "approve", "message": "¿Enviar?"}, {"action": "write_file", "path": "ok.txt", "content": "x"}]
    )
    paused = await wait_for(runner, task["id"], "awaiting_approval")
    assert paused["approval"] == {"message": "¿Enviar?"}
    assert not (runner.settings.workspace / "ok.txt").exists()

    runner.decide(task["id"], True)
    await wait_for(runner, task["id"], "succeeded")
    await runner.stop()
    assert (runner.settings.workspace / "ok.txt").exists()


async def test_denied_approval_stops_the_task(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    task = runner.submit(
        [{"action": "approve", "message": "?"}, {"action": "write_file", "path": "no.txt", "content": "x"}]
    )
    await wait_for(runner, task["id"], "awaiting_approval")
    runner.decide(task["id"], False)
    done = await wait_for(runner, task["id"], "denied")
    await runner.stop()
    assert not (runner.settings.workspace / "no.txt").exists() and "denegó" in done["error"]
    with pytest.raises(TaskConflict):
        runner.decide(task["id"], True)


async def test_resubmitting_the_same_id_does_not_run_twice(tmp_path: Path):
    runner = make_runner(tmp_path)
    runner.start()
    identifier = str(uuid.uuid4())
    steps = [{"action": "shell", "command": "echo x >> veces.txt"}]
    runner.submit(steps, task_id=identifier)
    await wait_for(runner, identifier, "succeeded")
    assert runner.submit(steps, task_id=identifier)["status"] == "succeeded"
    await asyncio.sleep(0.1)
    await runner.stop()
    assert (runner.settings.workspace / "veces.txt").read_text().count("x") == 1


def test_secret_values_never_reach_the_journal(tmp_path: Path):
    runner = make_runner(tmp_path)
    task = runner.submit([{"action": "fill", "selector": "#p", "value": "hunter2", "secret": True}])
    assert "hunter2" not in json.dumps(runner.journal.load(task["id"]))
    assert "hunter2" not in "".join(p.read_text() for p in runner.settings.tasks_dir.iterdir())


def test_recover_marks_interrupted_and_does_not_resume(tmp_path: Path):
    runner = make_runner(tmp_path)
    for status in ("running", "awaiting_approval"):
        runner.journal.save({"id": str(uuid.uuid4()), "status": status, "steps": [], "createdAt": 1})
    queued = str(uuid.uuid4())
    runner.journal.save(
        {"id": queued, "status": "queued", "createdAt": 2,
         "steps": [{"action": "shell", "command": "true", "timeout_s": 5, "allow_failure": False}]}
    )
    secret = str(uuid.uuid4())
    runner.journal.save(
        {"id": secret, "status": "queued", "createdAt": 3,
         "steps": [{"action": "fill", "selector": "#a", "value": "***", "secret": True}]}
    )

    assert runner.recover() == {"interrupted": 3, "requeued": 1}
    assert runner.journal.load(queued)["status"] == "queued"
    assert runner.journal.load(secret)["status"] == "interrupted"  # su secreto ya no existe


async def test_quota_refuses_new_work(tmp_path: Path):
    runner = make_runner(tmp_path, disk_quota_bytes=10)
    (runner.settings.workspace / "grande.bin").write_bytes(b"x" * 100)
    runner.start()
    task = runner.submit([{"action": "write_file", "path": "a.txt", "content": "x"}])
    done = await wait_for(runner, task["id"], "failed")
    await runner.stop()
    assert "cuota" in done["error"]

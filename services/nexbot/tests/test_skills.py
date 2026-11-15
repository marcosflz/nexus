from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from pathlib import Path

import pytest

from nexbot.settings import Settings
from nexbot.skills import SkillScript, execute_skill


def script(source: bytes, **extra: bytes) -> SkillScript:
    files = {path: base64.b64encode(content).decode() for path, content in {"scripts/main.py": source, **extra}.items()}
    digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return SkillScript(runId="a" * 36, package={"files": files, "digest": digest}, path="scripts/main.py")


def settings(root: Path) -> Settings:
    value = Settings(bot_id="a" * 36, token="not-for-scripts", root=root)
    value.prepare()
    return value


async def test_script_uses_package_resources_and_literal_arguments(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("NEXBOT_TOKEN", "must-not-leak")
    request = script(b"import os,sys,pathlib\nassert 'NEXBOT_TOKEN' not in os.environ\nprint((pathlib.Path(os.environ['SKILL_ROOT'])/'assets/data.txt').read_text())\nprint(sys.argv[1])\n(pathlib.Path(os.environ['NEXUS_WORKSPACE'])/'artifacts/result.txt').write_text('done')", **{"assets/data.txt": b"RESOURCE"})
    request.args = ["$(touch SHOULD_NOT_EXIST)"]
    result = await execute_skill(request, settings(tmp_path))
    assert result["exitCode"] == 0 and "RESOURCE" in result["stdout"]
    assert "$(touch SHOULD_NOT_EXIST)" in result["stdout"]
    assert not (tmp_path / "workspace/SHOULD_NOT_EXIST").exists()
    assert (tmp_path / "workspace/artifacts/result.txt").read_text() == "done"


async def test_refuses_tampered_packages_and_path_escape(tmp_path: Path) -> None:
    request = script(b"print('ok')")
    request.package["files"]["scripts/main.py"] = base64.b64encode(b"print('tampered')").decode()
    with pytest.raises(ValueError, match="digest"):
        await execute_skill(request, settings(tmp_path))
    request = script(b"print('ok')", **{"../escape": b"bad"})
    with pytest.raises(ValueError, match="path"):
        await execute_skill(request, settings(tmp_path))


async def test_timeout_and_bounded_output(tmp_path: Path) -> None:
    request = script(b"print('x'*1000000)")
    result = await execute_skill(request, settings(tmp_path))
    assert result["exitCode"] == 0 and len(result["stdout"]) <= 64000
    request = script(b"import time\ntime.sleep(30)")
    request.timeoutS = 1
    with pytest.raises(asyncio.TimeoutError):
        await execute_skill(request, settings(tmp_path))


async def test_cancellation_stops_script(tmp_path: Path) -> None:
    request = script(b"import os,time,pathlib\npathlib.Path(os.environ['NEXUS_WORKSPACE']+'/started').touch()\ntime.sleep(30)\npathlib.Path(os.environ['NEXUS_WORKSPACE']+'/finished').touch()")
    config = settings(tmp_path)
    task = asyncio.create_task(execute_skill(request, config))
    for _ in range(100):
        if (config.workspace / "started").exists():
            break
        await asyncio.sleep(.01)
    assert (config.workspace / "started").exists()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not (config.workspace / "finished").exists()

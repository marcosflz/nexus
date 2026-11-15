"""Execute pinned packages inside this bot only. No model credentials are present."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import signal
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

from pydantic import BaseModel, Field

from .settings import Settings
from .shell import shell_env


class SkillScript(BaseModel):
    runId: str = Field(pattern=r"^[0-9a-f-]{36}$")
    package: dict[str, Any]
    path: str = Field(max_length=512)
    args: list[str] = Field(default_factory=list, max_length=100)
    timeoutS: int = Field(default=20, ge=1, le=20)


async def execute_skill(payload: SkillScript, settings: Settings) -> dict[str, Any]:
    files = payload.package.get("files", {})
    if not isinstance(files, dict) or not 1 <= len(files) <= 256:
        raise ValueError("Invalid skill file manifest")
    digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    if digest != payload.package.get("digest"):
        raise ValueError("Skill package digest mismatch")
    if payload.path not in files or not payload.path.startswith("scripts/"):
        raise ValueError("Only bundled scripts may be executed")
    interpreter = {".py": sys.executable, ".sh": "bash", ".js": "node", ".mjs": "node"}.get(Path(payload.path).suffix)
    if interpreter is None:
        raise ValueError("Supported scripts: Python, Bash and JavaScript")
    if sum(map(len, payload.args)) > 16_000 or any("\x00" in arg for arg in payload.args):
        raise ValueError("Invalid script arguments")
    if settings.disk_usage() >= settings.disk_quota_bytes:
        raise ValueError("El workspace ha superado su cuota de disco")
    with tempfile.TemporaryDirectory(prefix="nexus-skill-") as temporary:
        root = Path(temporary)
        size = 0
        for relative, encoded in files.items():
            path = PurePosixPath(relative)
            if (path.is_absolute() or "\\" in relative or ":" in relative or "\x00" in relative
                    or any(part in {"", ".", ".."} for part in relative.split("/"))):
                raise ValueError("Invalid skill resource path")
            data = base64.b64decode(encoded, validate=True)
            size += len(data)
            if size > 10 * 1024 * 1024:
                raise ValueError("Skill package exceeds 10 MB")
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o400)
        env = shell_env(settings)
        env.update(SKILL_ROOT=str(root), NEXUS_WORKSPACE=str(settings.workspace))
        proc = await asyncio.create_subprocess_exec(
            interpreter, str(root / payload.path), *payload.args,
            cwd=settings.workspace, env=env, start_new_session=True,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )

        async def read(stream: asyncio.StreamReader | None) -> str:
            output = bytearray()
            if stream is not None:
                while chunk := await stream.read(8192):
                    output.extend(chunk[:max(0, 64000 - len(output))])
            return output.decode(errors="replace")

        readers = [asyncio.create_task(read(proc.stdout)), asyncio.create_task(read(proc.stderr))]
        try:
            stdout, stderr, _ = await asyncio.wait_for(asyncio.gather(*readers, proc.wait()), payload.timeoutS)
            return {"exitCode": proc.returncode, "stdout": stdout, "stderr": stderr}
        except (TimeoutError, asyncio.CancelledError):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await proc.wait()
            raise
        finally:
            for task in readers:
                task.cancel()
            await asyncio.gather(*readers, return_exceptions=True)

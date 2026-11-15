"""Nexus adapters; the package format and runtime live in nas.adk.skills."""

from __future__ import annotations

import base64
import json
from typing import Any, Literal

import httpx
from nas.adk.agents.context import Context
from nas.adk.services.eval.eval_runner import EvalRunner
from nas.adk.skills import (
    SkillPackage,
    SkillRef,
    export_zip,
    import_github,
    import_zip,
    package_from_files,
    safe_skill_path,
)
from nas.adk.skills.creator import SkillDraftBackend
from pydantic import BaseModel, Field

from .bff import BffClient
from .netguard import check_url


class SkillOperation(BaseModel):
    op: Literal["inspect", "validate", "export", "github", "evaluate"]
    observations: list[dict[str, str]] = Field(default_factory=list, max_length=100)
    files: dict[str, str] | None = None
    archive: str | None = None
    url: str | None = None
    package: SkillPackage | None = None


async def skill_operation(payload: SkillOperation) -> dict[str, Any]:
    if payload.op == "evaluate":
        return {"reports": [EvalRunner.assess_observation(item.get("output", ""), item.get("expected", ""), item.get("status", "error")) for item in payload.observations]}
    if payload.op == "export":
        if payload.package is None:
            raise ValueError("Missing package")
        return {"archive": base64.b64encode(export_zip(payload.package)).decode()}
    if payload.op == "github":
        async def fetch(url: str, limit: int) -> bytes:
            await check_url(url)
            async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client, client.stream("GET", url) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > limit:
                        raise ValueError("Archive exceeds 10 MB")
                return bytes(data)
        packages = await import_github(payload.url or "", fetch)
    elif payload.archive is not None:
        packages = import_zip(base64.b64decode(payload.archive, validate=True))
    elif payload.files is not None:
        packages = [package_from_files({path: base64.b64decode(data, validate=True)
                                       for path, data in payload.files.items()})]
    elif payload.package is not None:
        packages = [payload.package]
    else:
        raise ValueError("Provide files or a ZIP archive")
    return {"packages": [package.model_dump() for package in packages]}


class BffSkillStore:
    def __init__(self, bff: BffClient, refs: list[SkillRef]) -> None:
        self.bff, self.refs = bff, refs

    async def list(self) -> list[SkillRef]:
        return self.refs

    async def load(self, id: str) -> SkillPackage:
        result = await self.bff.skills("load", id=id)
        return SkillPackage.model_validate(result["package"])


class BffSkillExecutor:
    def __init__(self, bff: BffClient) -> None:
        self.bff = bff

    async def execute(self, ref: SkillRef, path: str, args: list[str], ctx: Context) -> Any:
        return await self.bff.skills("execute", id=ref.id, path=path, args=args)


class BffSkillDraft(SkillDraftBackend):
    def __init__(self, bff: BffClient) -> None:
        self.bff = bff

    async def read_draft(self) -> str:
        result = await self.bff.skills("read_draft")
        files = result.get("files", {})
        summary = [{"path": path, "bytes": len(base64.b64decode(content, validate=True))}
                   for path, content in files.items()]
        main = base64.b64decode(files.get("SKILL.md", ""), validate=True).decode("utf-8", errors="replace")
        return json.dumps({"files": summary, "SKILL.md": main[:12000], "revision": result.get("revision")}, ensure_ascii=False)

    async def read_draft_file(self, path: str, offset: int = 0, limit: int = 12000) -> str:
        safe_skill_path(path)
        if offset < 0 or not 1 <= limit <= 12000:
            raise ValueError("Invalid pagination bounds")
        result = await self.bff.skills("read_draft")
        data = base64.b64decode(result["files"][path], validate=True)
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return json.dumps({"path": path, "binary": True, "bytes": len(data)})
        return json.dumps({"path": path, "text": text[offset:offset + limit], "nextOffset": offset + limit if offset + limit < len(text) else None}, ensure_ascii=False)

    async def write_draft_file(self, path: str, content: str) -> str:
        safe_skill_path(path)
        if len(content.encode()) > 1_000_000:
            raise ValueError("Draft file exceeds 1 MB")
        return json.dumps(await self.bff.skills("write_draft_file", path=path, content=content))

    async def delete_draft_file(self, path: str) -> str:
        return json.dumps(await self.bff.skills("delete_draft_file", path=safe_skill_path(path)))

    async def validate_draft(self) -> str:
        result = await self.bff.skills("read_draft")
        package = package_from_files({path: base64.b64decode(content, validate=True)
                                      for path, content in result["files"].items()})
        return json.dumps({"valid": True, "manifest": package.manifest.model_dump()})

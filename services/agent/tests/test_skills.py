from __future__ import annotations

import json

import httpx
from nas.adk.skills import package_from_files

from nexus_agent.app import create_app
from nexus_agent.run import run_stream
from nexus_agent.skills import SkillOperation, skill_operation

from .conftest import ScriptedLlm, asks, factory, make_request, says, signed_headers, tool_call


def package():
    return package_from_files({"SKILL.md": b"---\nname: weekly-report\ndescription: Prepare weekly reports\n---\nUse references/format.md for the report.", "references/format.md": b"Report includes RISKS and ACTIONS."})


async def test_import_validate_export_and_bad_yaml(settings) -> None:
    transport = httpx.ASGITransport(app=create_app(settings))
    async with httpx.AsyncClient(transport=transport, base_url="http://sidecar") as client:
        data = {"op": "validate", "files": package().files}
        body = json.dumps(data)
        response = await client.post("/v1/skills", content=body, headers=signed_headers(body.encode()))
        assert response.status_code == 200
        pack = response.json()["packages"][0]
        assert pack["manifest"]["name"] == "weekly-report"
        exported = await skill_operation(SkillOperation(op="export", package=pack))
        assert (await skill_operation(SkillOperation(op="inspect", archive=exported["archive"])))["packages"][0] == pack


async def test_loading_is_progressive_and_checkpoint_contains_active_state(settings) -> None:
    pack = package()
    ref = pack.reference("version-1")
    model = ScriptedLlm(script=[asks(tool_call("activate", "activate_skill", skill="weekly-report")), asks(tool_call("read", "read_skill_file", skill="weekly-report", path="references/format.md")), says("RISKS and ACTIONS")])
    def bff(request):
        if request.url.path.endswith("/policy"):
            return httpx.Response(200, json={"effect": "allow"})
        return httpx.Response(200, json={"package": pack.model_dump()})
    async with httpx.AsyncClient(transport=httpx.MockTransport(bff)) as http:
        events = [event async for event in run_stream(make_request(skills=[ref.model_dump()]), settings, model_factory=factory(model), bff_http=http)]
    assert "Use references/format.md" not in str(model.seen[0])
    assert "Use references/format.md" in str(model.seen[1])
    assert "RISKS and ACTIONS" in str(model.seen[2])
    assert any(event.get("name") == "nexus.skill" for event in events)
    assert events[-1]["value"]["outcome"] == "success"


async def test_script_interrupt_restores_skill_state(settings) -> None:
    pack = package_from_files({"SKILL.md": package().read("SKILL.md"), "scripts/report.py": b"print('ok')"})
    ref = pack.reference("version-1")
    calls = []
    def bff(request):
        body = json.loads(request.content)
        if request.url.path.endswith("/policy"):
            return httpx.Response(200, json={"effect": "ask", "approvalId": "approval"} if body["tool"] == "run_skill_script" else {"effect": "allow"})
        calls.append(body["op"])
        return httpx.Response(200, json={"package": pack.model_dump()} if body["op"] == "load" else {"stdout": "ok", "exitCode": 0})
    model = ScriptedLlm(script=[asks(tool_call("script", "run_skill_script", skill="weekly-report", path="scripts/report.py", args=[]))])
    async with httpx.AsyncClient(transport=httpx.MockTransport(bff)) as http:
        events = [event async for event in run_stream(make_request(skills=[ref.model_dump()], explicitSkills=[ref.id], skillScripts=True), settings, model_factory=factory(model), bff_http=http)]
        result = events[-1]["value"]
        assert result["outcome"] == "interrupt"
        assert result["checkpoint"]["state"]["nas.skills"]["active"] == [ref.id]
        resumed = ScriptedLlm(script=[says("done")])
        output = [event async for event in run_stream(make_request(skills=[ref.model_dump()], explicitSkills=[ref.id], skillScripts=True, checkpoint=result["checkpoint"], userText=None, resume=[{"callId": "script", "status": "approved"}]), settings, model_factory=factory(resumed), bff_http=http)]
        assert output[-1]["value"]["outcome"] == "success"
        assert "execute" in calls


async def test_evaluation_keeps_pending_cases_pending() -> None:
    result = await skill_operation(SkillOperation(op="evaluate", observations=[{"output": "Expected", "expected": "Expected", "status": "awaiting_input"}, {"output": "Expected output", "expected": "Expected", "status": "completed"}]))
    assert result["reports"][0]["passed"] is False
    assert result["reports"][1]["passed"] is True

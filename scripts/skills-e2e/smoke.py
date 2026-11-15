"""Exercise the real BFF, ADK sidecar, PostgreSQL, Docker and Nexbot runtime.

Run with services/agent/.venv/bin/python after starting compose.yml.
All accounts, credentials and packages here are disposable fixtures.
"""
from __future__ import annotations

import base64
import io
import json
import os
import time
import zipfile

import httpx

BASE = os.environ.get("SKILLS_TEST_URL", "http://127.0.0.1:3303")


def api(client, method, path, body=None, status=(200, 201, 202)):
    response = client.request(method, path, json=body)
    assert response.status_code in status, (method, path, response.status_code, response.text[:1000])
    return response.json()


def wait_for(fn, description, timeout=90):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = fn()
        if value:
            return value
        time.sleep(.3)
    raise AssertionError("Timed out: " + description)


def archive(name, files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as bundle:
        for path, content in files.items():
            bundle.writestr(f"{name}/{path}", content)
    return base64.b64encode(output.getvalue()).decode()


def import_draft(client, name, files, skill_id=None):
    preview = api(client, "POST", "/api/skills/import", {"archive": archive(name, files)})
    assert preview["packages"][0]["manifest"]["name"] == name
    draft = api(client, "POST", "/api/skills/import", {"package": preview["packages"][0], "install": True, **({"skillId": skill_id} if skill_id else {}), "source": {"kind": "e2e"}})["draft"]
    return draft


def publish(client, draft):
    return api(client, "POST", f"/api/skill-drafts/{draft['id']}/publish", {"revision": draft["revision"]})


def chat(client, text, bot_id=None, explicit=None):
    thread = api(client, "POST", "/api/threads", {})["thread"]
    response = client.post("/api/chat", json={"threadId": thread["id"], "text": text, "botId": bot_id, "explicitSkills": explicit or []})
    assert response.status_code == 200, response.text
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert any(event["type"] == "RUN_FINISHED" for event in events), response.text[-1500:]
    assert not any(event["type"] == "RUN_ERROR" for event in events), response.text[-1500:]
    detail = api(client, "GET", f"/api/threads/{thread['id']}")
    return detail, events


def main():
    with httpx.Client(base_url=BASE, timeout=120) as owner, httpx.Client(base_url=BASE, timeout=120) as other:
        wait_for(lambda: owner.get("/login").status_code == 200, "web application")
        registered = owner.post("/api/auth/register", json={"email": "skills-owner@example.test", "password": "skills-test-password"})
        if registered.status_code == 403:
            api(owner, "POST", "/api/auth/login", {"email": "skills-owner@example.test", "password": "skills-test-password"})
        else:
            assert registered.status_code == 201, registered.text
        for old in api(owner, "GET", "/api/bots")["bots"]:
            assert owner.delete(f"/api/bots/{old['id']}?purge=1").status_code == 200
        for old in api(owner, "GET", "/api/skills")["skills"]:
            assert owner.delete(f"/api/skills/{old['id']}").status_code == 200
        api(owner, "PUT", "/api/settings", {"provider": "lmstudio", "baseUrl": "http://model:8080/v1", "enabled": True, "model": "skills-test", "models": [{"id": "skills-test", "label": "Deterministic fixture"}]})
        assert owner.get("/api/agents").status_code == 410
        assert owner.get("/skills").status_code == 200
        assert owner.post("/api/skills/import", json={"url": "http://127.0.0.1/secret"}).status_code == 400
        assert owner.post("/api/skills/import", json={"archive": archive("../escape", {"SKILL.md": "bad"})}).status_code == 400
        files = {"SKILL.md": "---\nname: weekly-report\ndescription: Prepare weekly reports with risks and actions\nlicense: MIT\n---\nRead references/format.md and use its exact format.", "references/format.md": "FORMAT-V1: RISKS and ACTIONS", "assets/sample.csv": "name,value\na,1\n"}
        draft = import_draft(owner, "weekly-report", files)
        assert api(owner, "GET", "/api/skills")["skills"] == [], "Import must not publish"
        published = publish(owner, draft)
        skill = published["skill"]
        exported = owner.get(f"/api/skills/{skill['id']}/export")
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as bundle:
            assert bundle.read("weekly-report/assets/sample.csv").decode() == files["assets/sample.csv"]
        bot = api(owner, "POST", "/api/bots", {"name": "Skills analyst", "role": "Analyst", "instructions": "IDENTITY-V1", "skillIds": [skill["id"]]})["bot"]
        assert bot["environmentEnabled"] is False and bot["currentVersionId"]
        details, events = chat(owner, "Prepare a weekly report", bot["id"])
        assert "FORMAT-V1" in str(details)
        assert any(event.get("name") == "nexus.skill" for event in events)
        details, events = chat(owner, "Prepare the report explicitly", explicit=["weekly-report"])
        assert "FORMAT-V1" in str(details)
        api(owner, "PATCH", f"/api/skills/{skill['id']}", {"enabledInChat": False})
        details, _ = chat(owner, "Hello")
        assert "RESPUESTA-SIN-SKILLS" in str(details)
        details, _ = chat(owner, "Prepare the assigned report", bot["id"])
        assert "FORMAT-V1" in str(details)
        api(owner, "PATCH", f"/api/bots/{bot['id']}", {"execution": {"memory": {"enabled": True, "scope": "bot"}, "knowledge": {"enabled": True}}})
        details, _ = chat(owner, "MEMORY-CHECK", bot["id"])
        assert "MEMORY-SAVED" in str(details)
        memories = api(owner, "GET", f"/api/bots/{bot['id']}/memory")["memories"]
        assert any(item["value"] == "BOT-LOCAL-MEMORY" for item in memories)
        uploaded = owner.post(f"/api/bots/{bot['id']}/knowledge", files={"files": ("notes.txt", b"e2eknowledge FACT-FROM-DOCUMENT", "text/plain")})
        assert uploaded.status_code == 200 and uploaded.json()["results"][0]["ok"], uploaded.text
        details, _ = chat(owner, "KNOWLEDGE-CHECK", bot["id"])
        assert "FACT-FROM-DOCUMENT" in str(details)
        trigger = api(owner, "POST", f"/api/bots/{bot['id']}/triggers", {"kind": "cron", "config": {"expr": "0 9 * * 1-5", "tz": "Europe/Madrid"}, "prompt": "Prepare the report"})["trigger"]
        api(owner, "PATCH", f"/api/bots/{bot['id']}/triggers/{trigger['id']}", {"enabled": False})
        webhook = api(owner, "POST", f"/api/bots/{bot['id']}/triggers", {"kind": "webhook", "config": {}})
        assert owner.post(webhook["webhookUrl"], content="fixture-event").status_code == 202
        room = api(owner, "POST", "/api/rooms", {"name": "Lightweight skills room", "botIds": [bot["id"]]})["room"]
        topic = api(owner, "POST", f"/api/rooms/{room['id']}/topics", {"title": "Report", "text": "Prepare the report", "assigneeBotId": bot["id"]})["topic"]
        room_detail = wait_for(lambda: (lambda data: data if "FORMAT-V1" in str(data.get("messages", [])) else None)(api(owner, "GET", f"/api/rooms/{room['id']}/topics/{topic['id']}")), "lightweight bot room turn")
        assert room_detail
        response = owner.post("/api/admin/users", json={"email": "skills-other@example.test", "password": "skills-other-password"})
        user2 = response.json()["user"] if response.status_code == 201 else next(user for user in api(owner, "GET", "/api/admin/users")["users"] if user["email"] == "skills-other@example.test")
        api(other, "POST", "/api/auth/login", {"email": user2["email"], "password": "skills-other-password"})
        for old in api(other, "GET", "/api/bots")["bots"]:
            assert other.delete(f"/api/bots/{old['id']}?purge=1").status_code == 200
        for old in api(other, "GET", "/api/skills")["skills"]:
            assert other.delete(f"/api/skills/{old['id']}").status_code == 200
        assert other.get(f"/api/skills/{skill['id']}").status_code == 404
        assert other.patch(f"/api/bots/{bot['id']}", json={"name": "stolen"}).status_code == 404
        foreign = api(other, "POST", "/api/bots", {"name": "Other analyst"})["bot"]
        assert other.patch(f"/api/bots/{foreign['id']}", json={"skillIds": [skill['id']]}).status_code == 400
        api(owner, "PATCH", f"/api/skills/{skill['id']}", {"shared": True})
        copied = api(other, "POST", f"/api/skills/{skill['id']}/copy", {})["skill"]
        assert copied["ownerId"] == user2["id"] and copied["galleryVersionId"] is None
        # Creator: its tool calls must actually persist files, not just return prose.
        created = api(owner, "POST", "/api/skill-drafts", {})["draft"]
        api(owner, "POST", f"/api/skill-drafts/{created['id']}/chat", {"text": "Crea una skill de informes semanales"})
        detail = wait_for(lambda: (lambda data: data if data["conversation"] and not data["activeRuns"] else None)(api(owner, "GET", f"/api/skill-drafts/{created['id']}")), "creator completion")
        assert "references/format.md" in detail["draft"]["files"], detail
        assert "RISKS" in base64.b64decode(detail["draft"]["files"]["SKILL.md"]).decode()
        assert len(api(owner, "GET", "/api/skills")["skills"]) == 1, "Creator must not publish automatically"
        api(owner, "POST", f"/api/skill-drafts/{created['id']}/tests", {"input": "Prepare a report", "expected": "RISKS"})
        detail = wait_for(lambda: (lambda data: data if data["tests"] and data["tests"][0]["status"] == "completed" else None)(api(owner, "GET", f"/api/skill-drafts/{created['id']}")), "draft test")
        assert detail["tests"][0]["report"]["passed"], detail["tests"][0]
        publish(owner, detail["draft"])
        print("PASS: library, ZIP, scopes, automatic/manual activation, lightweight Nexbot, gallery, creator and evaluation", flush=True)
        # A real script runs in a real isolated Nexbot; approval pins the old package.
        script_files = {"SKILL.md": "---\nname: script-report\ndescription: Run the bundled report script\n---\nRun scripts/report.py with literal-argument and report stdout.", "scripts/report.py": "import os,pathlib,sys\nassert 'NEXBOT_TOKEN' not in os.environ\ntext='SCRIPT-V1 '+sys.argv[1]\n(pathlib.Path(os.environ['NEXUS_WORKSPACE'])/'artifacts/skill-result.txt').write_text(text)\nprint(text)"}
        script_draft = import_draft(owner, "script-report", script_files)
        script_skill = publish(owner, script_draft)["skill"]
        runtime = api(owner, "POST", "/api/bots", {"name": "Skills runner", "environmentEnabled": True, "config": {"desktop": False, "network": "none", "memoryMb": 512}, "skillIds": [script_skill["id"]]})["bot"]
        try:
            api(owner, "POST", f"/api/bots/{runtime['id']}/lifecycle", {"action": "start"})
            script_test = api(owner, "POST", f"/api/skill-drafts/{script_draft['id']}/tests", {"input": "Run the script", "expected": "SCRIPT-V1", "botId": runtime["id"]})
            detail = wait_for(lambda: (lambda data: data if data["tests"] and data["tests"][0]["status"] == "awaiting_input" else None)(api(owner, "GET", f"/api/skill-drafts/{script_draft['id']}")), "script approval")
            assert detail["tests"][0]["report"]["passed"] is False
            assert owner.get(f"/api/bots/{runtime['id']}/files?path=artifacts/skill-result.txt&download=1").status_code == 404
            approval = next(item for item in api(owner, "GET", "/api/approvals/pending")["approvals"] if item["runId"] == script_test["runId"])
            assert approval["tool"] == "run_skill_script"
            newer_files = dict(script_files, **{"scripts/report.py": "print('UNEXPECTED-V2')"})
            newer = import_draft(owner, "script-report", newer_files, script_skill["id"])
            publish(owner, newer)
            api(owner, "POST", f"/api/approvals/{approval['id']}", {"decision": "approve"})
            detail = wait_for(lambda: (lambda data: data if data["tests"][0]["status"] == "completed" else None)(api(owner, "GET", f"/api/skill-drafts/{script_draft['id']}")), "script completion")
            assert "SCRIPT-V1" in detail["tests"][0]["output"] and "UNEXPECTED-V2" not in detail["tests"][0]["output"], detail["tests"][0]
            artifact = owner.get(f"/api/bots/{runtime['id']}/files?path=artifacts/skill-result.txt&download=1")
            assert artifact.text == "SCRIPT-V1 literal-argument", artifact.text
            # This time pause a regular chat on a published version, then update that skill.
            normal, normal_events = chat(owner, "Run the published script", runtime["id"])
            normal_run = next(event["runId"] for event in normal_events if event["type"] == "RUN_STARTED")
            approval2 = next(item for item in api(owner, "GET", "/api/approvals/pending")["approvals"] if item["runId"] == normal_run)
            third = import_draft(owner, "script-report", dict(script_files, **{"scripts/report.py": "print('UNEXPECTED-V3')"}), script_skill["id"])
            publish(owner, third)
            api(owner, "POST", f"/api/approvals/{approval2['id']}", {"decision": "approve"})
            normal_thread = normal["thread"]["id"]
            resumed = wait_for(lambda: (lambda data: data if "UNEXPECTED-V2" in str(data["messages"]) else None)(api(owner, "GET", f"/api/threads/{normal_thread}")), "pinned published skill resume")
            assert "UNEXPECTED-V3" not in str(resumed["messages"])
            print("PASS: real Docker script, explicit approval, pinned checkpoint/version and workspace artifact", flush=True)
        finally:
            response = owner.delete(f"/api/bots/{runtime['id']}?purge=1")
            assert response.status_code == 200, response.text


if __name__ == "__main__":
    main()

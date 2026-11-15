"""Deterministic OpenAI-compatible fixture. This is not a real model evaluation."""
from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4


def call(name: str, **args):
    return {"id": str(uuid4()), "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def decide(body):
    messages = body["messages"]
    last_user = max((i for i, message in enumerate(messages) if message["role"] == "user" and not message.get("name")), default=0)
    recent = messages[last_user:]
    results = [message for message in recent if message["role"] == "tool"]
    call_names = {tool["id"]: tool["function"]["name"] for message in recent for tool in message.get("tool_calls", [])}
    results = [dict(message, name=message.get("name") or call_names.get(message.get("tool_call_id"))) for message in results]
    system = str(messages[0].get("content", ""))
    if "You help the user create or improve a portable Agent Skill" in system:
        step = len(results)
        if step == 0:
            return {"tool_calls": [call("read_draft")]}
        if step == 1:
            return {"tool_calls": [call("write_draft_file", path="SKILL.md", content="---\nname: creator-report\ndescription: Prepare a weekly report with risks and actions\n---\nRead references/format.md and write a report with RISKS and ACTIONS.")]}
        if step == 2:
            return {"tool_calls": [call("write_draft_file", path="references/format.md", content="Include RISKS and ACTIONS and cite the supplied input.")]}
        if step == 3:
            return {"tool_calls": [call("validate_draft")]}
        return {"content": "Borrador preparado con referencias. Pruébalo antes de publicar."}
    tools = {tool["function"]["name"] for tool in body.get("tools", [])}
    prompt = str(messages[last_user].get("content", ""))
    if "MEMORY-CHECK" in prompt and "remember" in tools:
        if not results:
            return {"tool_calls": [call("remember", key="e2e_memory", value="BOT-LOCAL-MEMORY")]}
        return {"content": "MEMORY-SAVED " + str(results[-1]["content"])}
    if "KNOWLEDGE-CHECK" in prompt and "knowledge_search" in tools:
        if not results:
            return {"tool_calls": [call("knowledge_search", query="e2eknowledge")]}
        return {"content": "KNOWLEDGE-RESULT " + str(results[-1]["content"])}
    if "activate_skill" not in tools:
        return {"content": "RESPUESTA-SIN-SKILLS"}
    catalog_text = next((str(message["content"]) for message in messages if message.get("name") == "nas_skills_catalog"), "")
    names = re.findall(r'"name":\s*"([a-z0-9-]+)"', catalog_text)
    name = names[0] if names else "weekly-report"
    active = next((str(message["content"]) for message in messages if message.get("name") == "nas_skills_active"), "")
    if f'"skill": "{name}"' not in active:
        return {"tool_calls": [call("activate_skill", skill=name)]}
    if name == "script-report":
        ran = next((message for message in results if message.get("name") == "run_skill_script"), None)
        if ran is None:
            return {"tool_calls": [call("run_skill_script", skill=name, path="scripts/report.py", args=["literal-argument"])]}
        return {"content": "SCRIPT-OK " + str(ran["content"])}
    read = next((message for message in results if message.get("name") == "read_skill_file"), None)
    if read is None:
        return {"tool_calls": [call("read_skill_file", skill=name, path="references/format.md")]}
    return {"content": "RISKS y ACTIONS: " + str(read["content"])}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        data = json.dumps({"data": [{"id": "skills-test"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
        response = decide(body)
        reason = "tool_calls" if response.get("tool_calls") else "stop"
        self.send_response(200)
        if body.get("stream"):
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            delta = dict(response)
            if "tool_calls" in delta:
                delta["tool_calls"] = [dict(tool, index=index) for index, tool in enumerate(delta["tool_calls"])]
            chunk = {"id": "fixture", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
            terminal = {"id": "fixture", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": reason}], "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30}}
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: " + json.dumps(terminal) + "\n\ndata: [DONE]\n\n").encode())
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"id": "fixture", "object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", **response}, "finish_reason": reason}], "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30}}).encode())


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()

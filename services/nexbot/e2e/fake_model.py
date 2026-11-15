"""Simulador de modelo para el e2e. NO es un LLM ni mide la calidad de un modelo.

Habla la API de Chat Completions y decide con reglas, pero leyendo de verdad los
píxeles de las capturas: el botón aparece en un sitio distinto cada vez, así que
solo acierta si las imágenes llegan bien y las coordenadas coinciden con la pantalla.
"""

import base64
import io
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image


def fresh() -> dict:
    return {"requests": 0, "images": 0, "sizes": [], "tools": [], "base64InText": False, "toolResults": [], "room": {}}


state = fresh()


def call(name: str, **args) -> dict:
    return {"id": f"call_{state['requests']}_{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def latest_image(messages: list[dict]) -> Image.Image | None:
    for message in reversed(messages):
        if message["role"] == "user" and isinstance(message["content"], list):
            for part in reversed(message["content"]):
                if part.get("type") == "image_url":
                    data = part["image_url"]["url"].split(",", 1)[1]
                    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")
    return None


def matches(pixel, target) -> bool:
    return all(abs(a - b) < 40 for a, b in zip(pixel, target, strict=True))


def find(image: Image.Image, target) -> tuple[int, int] | None:
    points = [(x, y) for y in range(0, image.height, 4) for x in range(0, image.width, 4) if matches(image.getpixel((x, y)), target)]
    if len(points) < 20:
        return None
    return sum(p[0] for p in points) // len(points), sum(p[1] for p in points) // len(points)


ROOM_MARK = "un NexBot. Participas en la sala"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def room_turn(messages: list[dict], results: list[dict]) -> tuple[dict | None, str]:
    """Guion de un bot en una sala. Devuelve la respuesta, o None y el texto del operador para seguir con el guion de escritorio."""
    system = next(m["content"] for m in messages if m["role"] == "system")
    handle = re.search(r"\(@([a-z0-9-]+)\)", system).group(1)
    other = "leo" if handle == "ana" else "ana"
    texts = [m["content"] for m in messages if m["role"] == "user" and isinstance(m["content"], str)]
    everything = "\n".join(texts)
    turn = texts[-1]
    operator = everything.rsplit("[Operador]\n", 1)[-1].split("[Mensaje del bot", 1)[0] if "[Operador]" in everything else ""
    seen = state["room"].setdefault(handle, {"requests": 0, "tools": [], "untrusted": False, "toolResults": [], "system": ""})
    seen["requests"] += 1
    seen["tools"] = state["tools"]
    seen["untrusted"] = seen["untrusted"] or "[Mensaje del bot @" in everything
    seen["system"] = system[:400]
    step = len(results)

    if "las subtareas de esta tarea han terminado" in turn:
        return {"content": "todo cerrado"}, operator
    if "lo que bloqueaba esta tarea ya está resuelto" in turn:
        return {"content": "desbloqueada, sigo"}, operator
    if not operator:
        return {"content": "subtarea hecha" if "SUBTAREA" in everything else "ok"}, operator
    if "BUCLE-SALA" in operator:
        return {"content": f"sigo, @{other} te toca"}, operator
    if "PIDE" in operator:
        if handle == "ana":
            return {"content": "Voy. @leo, pásame los datos. Ejemplo que no cuenta: `@leo`"}, operator
        return {"content": "Aquí están: 42"}, operator
    if "FUGA-SALA" in operator:
        if results:
            seen["toolResults"] = [m["content"][:200] for m in results]
            return {"content": "intento terminado"}, operator
        url = re.search(r"https?://\S+", operator).group(0)
        return {
            "tool_calls": [
                call("web_fetch", url=url),
                call("nexbot__shell_exec", command="touch /bot/workspace/fuga-sala"),
                call("nexbot__browser_navigate", url=url),
                call("remember", key="a", value="b"),
            ]
        }, operator
    if "OTRASALA" in operator:
        if results:
            return {"content": "OTRASALA: " + results[-1]["content"][:300]}, operator
        return {"tool_calls": [call("board_set_status", status="blocked", topic=re.search(UUID, operator).group(0))]}, operator
    if "TABLERO" in operator:
        if step == 0:
            return {"tool_calls": [call("board_create_subtask", title="Reunir cifras", description="SUBTAREA: reúne las cifras", assignee="leo")]}, operator
        if step == 1:
            return {"tool_calls": [call("board_set_status", status="in_review")]}, operator
        if step == 2:
            return {"tool_calls": [call("board_set_status", status="done")]}, operator
        return {"content": "TABLERO: " + results[-1]["content"][:300]}, operator
    if "ESCRITORIO" in operator:
        return None, operator
    return {"content": "ok, recibido"}, operator


def decide(body: dict) -> dict:
    messages = body["messages"]
    state["requests"] += 1
    state["tools"] = sorted(t["function"]["name"] for t in body.get("tools") or [])
    results = [m for m in messages if m["role"] == "tool"]
    if ROOM_MARK in str(messages[0].get("content")):
        scripted, prompt = room_turn(messages, results)
        if scripted is not None:
            return scripted
    else:
        prompt = next(m["content"] for m in messages if m["role"] == "user" and isinstance(m["content"], str))
    state["base64InText"] = state["base64InText"] or any("/9j/" in (m.get("content") or "") for m in results)
    state["images"] = sum(1 for m in messages if m["role"] == "user" and isinstance(m["content"], list))
    image = latest_image(messages)
    if image is not None:
        state["sizes"].append(f"{image.width}x{image.height}")

    if "ESCAPE" in prompt:
        if results:
            state["toolResults"] = [m["content"][:200] for m in results]
            return {"content": "intento terminado"}
        url = prompt.split()[-1]
        return {
            "tool_calls": [
                call("web_fetch", url=url),
                call("nexbot__shell_exec", command="touch /bot/workspace/fuga"),
                call("nexbot__browser_navigate", url=url),
                call("remember", key="a", value="b"),
            ]
        }
    if "BUCLE" in prompt:
        return {"tool_calls": [call("nexbot__desktop_wait", seconds=1)]}

    step = len(results)
    if step == 0:
        return {"tool_calls": [call("nexbot__desktop_open_url", url=re.search(r"https?://\S+", prompt).group(0))]}
    if step == 1:
        target = find(image, (0, 0, 255)) if image else None
        if target is None:
            return {"content": "no veo el botón"}
        return {"tool_calls": [call("nexbot__desktop_click", x=target[0], y=target[1])]}
    if step == 2:
        if image is None or find(image, (0, 255, 0)) is None:
            return {"content": "el clic no cambió la pantalla"}
        return {"tool_calls": [call("nexbot__workspace_write", path="artifacts/resultado-modelo.txt", content="verde visto")]}
    return {"content": "HECHO: verde visto"}


class Handler(BaseHTTPRequestHandler):
    def _json(self, value) -> None:
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._json(state)

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/reset":
            state.clear()
            state.update(fresh())
            self._json({})
            return
        request = json.loads(body)
        message = {"role": "assistant", "content": None, **decide(request)}
        finish = "tool_calls" if message.get("tool_calls") else "stop"
        usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        if not request.get("stream"):
            self._json({"id": "x", "model": request["model"], "choices": [{"index": 0, "message": message, "finish_reason": finish}], "usage": usage})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        delta = dict(message)
        if delta.get("tool_calls"):
            delta["tool_calls"] = [{**c, "index": i} for i, c in enumerate(delta["tool_calls"])]
        chunks = [
            # Como hacen varios servidores compatibles: el razonamiento llega en su propio campo.
            *(
                [{"id": "x", "model": request["model"], "choices": [{"index": 0, "delta": {"reasoning_content": "pienso en el hilo antes de contestar"}, "finish_reason": None}]}]
                if ROOM_MARK in str(request["messages"][0].get("content"))
                else []
            ),
            {"id": "x", "model": request["model"], "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
            {"id": "x", "model": request["model"], "choices": [{"index": 0, "delta": {}, "finish_reason": finish}], "usage": usage},
        ]
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *_args) -> None:
        return


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()

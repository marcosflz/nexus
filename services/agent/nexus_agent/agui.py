"""Traducción de eventos de nas-adk a eventos AG-UI.

``AgUiMapper`` es una máquina de estados pura: recibe ``Event`` de nas-adk y
devuelve diccionarios AG-UI listos para serializar. El BFF añade el ciclo de
vida del run (RUN_STARTED / RUN_FINISHED); aquí solo va el contenido.

Detalle importante de nas-adk: cuando se hace streaming, el evento
``type="message"`` consolidado **repite** el texto que ya llegó en deltas. Si
hubo deltas se ignora su contenido; si no (modelo sin streaming), se emite
completo una sola vez.
"""

from __future__ import annotations

import json
from typing import Any

from nas.adk.core.events.event import Event

MAX_TOOL_RESULT_CHARS = 2000
NEXUS_REASONING = "nexus.reasoning"
# El razonamiento llega en fragmentos muy pequeños: se agrupa para no llenar el log del run.
REASONING_FLUSH_CHARS = 240
MAX_REASONING_CHARS = 24_000


class AgUiMapper:
    def __init__(self, message_prefix: str) -> None:
        self._prefix = message_prefix
        self._index = 0
        self._open = False
        self._streamed = False
        self._reasoning = ""
        self._reasoning_sent = 0

    # --- razonamiento --------------------------------------------------------

    def _flush_reasoning(self) -> list[dict[str, Any]]:
        text, self._reasoning = self._reasoning, ""
        text = text[: max(0, MAX_REASONING_CHARS - self._reasoning_sent)]
        if not text:
            return []
        self._reasoning_sent += len(text)
        return [{"type": "CUSTOM", "name": NEXUS_REASONING, "value": {"delta": text}}]

    # --- texto -------------------------------------------------------------

    def _message_id(self) -> str:
        return f"{self._prefix}-{self._index}"

    def _open_text(self) -> list[dict[str, Any]]:
        if self._open:
            return []
        self._open = True
        return [{"type": "TEXT_MESSAGE_START", "messageId": self._message_id(), "role": "assistant"}]

    def _close_text(self) -> list[dict[str, Any]]:
        if not self._open:
            return []
        event = {"type": "TEXT_MESSAGE_END", "messageId": self._message_id()}
        self._open = False
        self._index += 1
        return [event]

    def _delta(self, text: str) -> list[dict[str, Any]]:
        out = self._open_text()
        out.append(
            {"type": "TEXT_MESSAGE_CONTENT", "messageId": self._message_id(), "delta": text}
        )
        return out

    # --- API ---------------------------------------------------------------

    def feed(self, event: Event) -> list[dict[str, Any]]:
        if event.type == "skill":
            return [{"type": "CUSTOM", "name": "nexus.skill", "value": {"id": event.content, "name": event.metrics.get("name"), "status": event.status}}]
        if event.type == "reasoning":
            self._reasoning += event.content or ""
            return self._flush_reasoning() if len(self._reasoning) >= REASONING_FLUSH_CHARS else []
        # Lo pensado va antes que lo que viene después (texto, herramienta o resultado).
        pending = self._flush_reasoning()
        return pending + self._feed(event)

    def _feed(self, event: Event) -> list[dict[str, Any]]:
        if event.type == "stream":
            if not event.content:
                return []
            self._streamed = True
            return self._delta(event.content)

        if event.type != "message":
            return []

        if event.role == "assistant":
            out: list[dict[str, Any]] = []
            if event.content and not self._streamed:
                out.extend(self._delta(event.content))
            out.extend(self._close_text())
            self._streamed = False
            for call in event.tool_calls:
                function = call.get("function", {})
                out.extend(
                    [
                        {
                            "type": "TOOL_CALL_START",
                            "toolCallId": call["id"],
                            "toolCallName": function.get("name", ""),
                        },
                        {
                            "type": "TOOL_CALL_ARGS",
                            "toolCallId": call["id"],
                            "delta": function.get("arguments") or "{}",
                        },
                        {"type": "TOOL_CALL_END", "toolCallId": call["id"]},
                    ]
                )
            return out

        if event.role == "tool":
            content = event.content or ""
            return [
                {
                    "type": "TOOL_CALL_RESULT",
                    "messageId": f"{event.tool_call_id}-result",
                    "toolCallId": event.tool_call_id,
                    "content": content[:MAX_TOOL_RESULT_CHARS],
                    "role": "tool",
                    "metadata": {
                        "isError": _is_error(content),
                        "durationMs": round(event.metrics.get("tool_seconds", 0) * 1000),
                    },
                }
            ]
        return []

    def finish(self) -> list[dict[str, Any]]:
        """Cierra el tramo de texto que haya quedado abierto."""
        return self._flush_reasoning() + self._close_text()


def _is_error(content: str) -> bool:
    if not content.startswith("{"):
        return False
    try:
        data = json.loads(content)
    except ValueError:
        return False
    return isinstance(data, dict) and set(data) == {"error"}

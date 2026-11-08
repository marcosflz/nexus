"""Callback de política: cada herramienta pasa por el motor del BFF antes de ejecutarse."""

from __future__ import annotations

from typing import Any

from nas.adk.core.callbacks import BaseCallback
from nas.adk.core.interrupts import ToolDecision

from .bff import BffClient, BffError

# Herramientas propias de la app, sin efectos fuera de la conversación.
LOCAL_SAFE_TOOLS = frozenset(
    {"present_openui", "prompt_openui", "openui_spec", "suggest_followups"}
)


class PolicyCallback(BaseCallback):
    """Falla cerrado: si el BFF no responde, la herramienta no se ejecuta."""

    def __init__(self, bff: BffClient | None) -> None:
        self._bff = bff

    async def before_tool_call(  # type: ignore[override]
        self,
        tool_name: str,
        args: dict[str, Any],
        tool_call_id: str = "",
        ctx: Any = None,
        agent_name: str = "",
    ) -> ToolDecision | None:
        if tool_name in LOCAL_SAFE_TOOLS:
            return None
        if self._bff is None:
            return ToolDecision.deny("política no disponible: sin enlace con el BFF")
        try:
            verdict = await self._bff.policy(tool_name, args, tool_call_id)
        except BffError as error:
            return ToolDecision.deny(f"no se pudo evaluar la política ({error})")

        effect = verdict.get("effect")
        reason = str(verdict.get("reason") or verdict.get("rule") or "")
        if effect == "allow":
            return None
        if effect == "ask":
            return ToolDecision.interrupt(
                "approval",
                {
                    "approvalId": verdict.get("approvalId"),
                    "tool": tool_name,
                    "args": args,
                    "rule": verdict.get("rule"),
                    "reason": reason,
                },
            )
        return ToolDecision.deny(reason or "denegado por la política")

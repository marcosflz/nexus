from __future__ import annotations

import json
import re

from nas.adk.core.interrupts import ToolInterrupt

from ..bff import BffClient, BffError
from ..state import RunState

PROFILES = ("minimal", "data", "forms", "lists", "full")

_FENCE = re.compile(r"^\s*```[ \t]*(?:openui|oui)?[ \t]*\n(.*?)(?:\n[ \t]*```)?\s*$", re.S | re.I)


def unwrap(ui: str) -> str:
    """Quita el bloque cercado con el que algunos modelos envuelven el programa."""
    match = _FENCE.match(ui or "")
    return (match.group(1) if match else ui or "").strip()


class UiTools:
    """Intelligent UI: el modelo entrega interfaces como llamadas a herramienta."""

    def __init__(self, state: RunState, bff: BffClient | None) -> None:
        self._state = state
        self._bff = bff

    async def _validate(self, ui: str) -> str | None:
        """Devuelve el error de validación, o None si el programa es válido."""
        ui = unwrap(ui)
        if not ui:
            return "el programa está vacío"
        if self._bff is None:
            return None
        try:
            verdict = await self._bff.validate_openui(ui)
        except BffError:
            return None  # sin validador no se bloquea: el cliente vuelve a validar al pintar
        return None if verdict.get("ok") else str(verdict.get("error") or "programa no válido")

    async def present_openui(self, ui: str) -> str:
        """Muestra una interfaz (tarjetas, tablas, gráficos…) escrita en OpenUI Lang.

        Empieza por `root = ...` y define todo lo que usa. Si devuelve un error, corrígelo
        y vuelve a llamar una vez.
        """
        error = await self._validate(ui)
        if error:
            return json.dumps({"error": f"programa OpenUI no válido: {error}"})
        return json.dumps({"displayed": True})

    async def prompt_openui(self, ui: str) -> str:
        """Muestra un formulario o una elección y ESPERA a que la persona lo envíe.

        Usa esto cuando necesites datos del usuario antes de seguir (preferencias, fechas…).
        """
        error = await self._validate(ui)
        if error:
            return json.dumps({"error": f"programa OpenUI no válido: {error}"})
        raise ToolInterrupt("openui_form", {})

    async def openui_spec(self, profile: str = "minimal") -> str:
        """Devuelve la especificación de componentes de OpenUI para un perfil.

        Perfiles: minimal (tarjetas y texto), data (tablas y gráficos), forms, lists, full.
        Llámala una vez antes de escribir una interfaz si no la conoces ya.
        """
        if profile not in PROFILES:
            return json.dumps({"error": f"perfil desconocido; usa uno de {list(PROFILES)}"})
        if self._bff is None:
            return json.dumps({"error": "especificación no disponible"})
        try:
            return await self._bff.openui_spec(profile)
        except BffError as error:
            return json.dumps({"error": str(error)})


class FollowupTools:
    def __init__(self, state: RunState) -> None:
        self._state = state

    async def suggest_followups(self, questions: list[str]) -> str:
        """Propone 3 a 5 preguntas de seguimiento cortas y útiles. Llámala al final."""
        cleaned = [q.strip() for q in questions if isinstance(q, str) and q.strip()][:5]
        self._state.set_followups(cleaned)
        return json.dumps({"ok": True, "count": len(cleaned)})

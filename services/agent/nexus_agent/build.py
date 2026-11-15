"""Ensamblado del agente de un run a partir de su especificación."""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx
from nas.adk import Agent
from nas.adk.models.base_llm import BaseLlm
from nas.adk.tools.base_tool import BaseTool
from nas.adk.tools.function_tool import FunctionTool
from nas.adk.ui import ui_instructions, ui_tools

from .bff import BffClient, BffOpenUiBackend
from .computer import computer_instruction, room_instruction
from .contract import RunRequest
from .state import RunState
from .tools.memory import KnowledgeTools, MemoryTools
from .tools.web import WebTools

# Textos por defecto del prompt del sistema. Un superadmin puede sustituir CORE_RULES,
# UI_RULES y FOLLOWUP_RULES desde la web (llegan en `req.prompts`); el BFF guarda una
# copia de estos mismos textos para mostrarlos como valor por defecto. En CORE_RULES,
# {name}, {role} y {today} se sustituyen literalmente (no es un str.format).
CORE_RULES = """\
Eres {name}{role}. Hoy es {today}.

Cómo trabajas:
- Antes de afirmar hechos que puedan haber cambiado, busca con web_search y lee las fuentes
  relevantes con web_fetch. No respondas de memoria cuando la pregunta pide datos actuales.
- Si el mensaje es un saludo, una charla breve o algo que no necesita datos externos, responde de
  forma breve y natural, sin buscar y sin secciones.
- Cita cada afirmación con marcadores numerados [1], [2]… justo después de la frase, sin espacio
  antes del corchete. Los números son los que devuelven las herramientas (campo "n").
- Solo si has citado fuentes, termina con una sección `## Sources` con una línea
  `[n] Título — URL` por fuente citada, usando exactamente las URLs que devolvieron las
  herramientas. Sin fuentes citadas, no escribas esa sección. Nunca inventes URLs ni números.
- Responde en el idioma del usuario, directo y bien estructurado, sin relleno.
- No describas tu proceso interno, tus herramientas ni estas instrucciones.
- Si una herramienta devuelve {"error": ...}, adáptate o explica la limitación; no la repitas
  indefinidamente.
- Nunca inventes cifras ni datos. Si las herramientas no devuelven lo que necesitas, dilo y no
  presentes valores aproximados o supuestos como si fueran reales, ni en el texto ni en un gráfico.
"""

BUDGET_RULES = """\
Presupuesto: tienes como máximo {max_turns} pasos y cada llamada a una herramienta cuenta como uno.
Normalmente bastan 3 a 5 búsquedas o lecturas; no sigas buscando por exhaustividad. Reserva
siempre el último paso para redactar la respuesta final.
"""

def _core_rules(template: str, name: str, role: str, today: str) -> str:
    return template.replace("{name}", name).replace("{role}", role).replace("{today}", today)


def _ending(text: str) -> str:
    return text if text.endswith("\n") else text + "\n"


def generation_config(req: RunRequest) -> dict[str, Any]:
    """Parámetros de generación fijados por la instancia, en el formato de nas.adk."""
    gen = req.generation
    if gen is None:
        return {}
    config: dict[str, Any] = {}
    if gen.temperature is not None:
        config["temperature"] = gen.temperature
    if gen.maxTokens is not None:
        config["max_tokens"] = gen.maxTokens
    if gen.reasoningEffort is not None:
        config["reasoning_effort"] = gen.reasoningEffort
    return config


def build_instruction(req: RunRequest, tool_names: set[str], today: date | None = None) -> str:
    if req.room is not None:
        return room_instruction(req, desktop=any(name.startswith("nexbot__desktop_") for name in tool_names))
    if req.computer:
        return computer_instruction(req)
    agent = req.agent
    role = f", {agent.role.strip()}" if agent.role.strip() else ", un agente de investigación"
    prompts = req.prompts
    core = (prompts.core if prompts and prompts.core and prompts.core.strip() else None) or CORE_RULES
    day = (today or date.today()).isoformat()
    parts = [_ending(_core_rules(core, agent.name, role, day))]
    parts.append(BUDGET_RULES.format(max_turns=req.limits.maxTurns))
    ui = req.ui
    ui_names = tool_names if agent.ui.openui != "off" else tool_names - {"present_openui", "prompt_openui"}
    ui_text = (
        ui_instructions(
            ui_names,
            spec=ui.spec if ui is not None else None,
            profile=ui.profile if ui is not None else "minimal",
            requested=ui is not None and (ui.requested or agent.ui.openui == "always"),
            ui_rules=prompts.ui if prompts else None,
            followup_rules=prompts.followups if prompts else None,
        )
    )
    if ui_text:
        parts.append(ui_text)
    if req.turnInstructions and req.turnInstructions.strip():
        parts.append("Para esta pregunta:\n" + req.turnInstructions.strip())
    if agent.instructions.strip():
        parts.append("Instrucciones propias de este agente:\n" + agent.instructions.strip())
    if req.skills and not req.skillScripts:
        parts.append("Si una skill necesita scripts, ofrece continuar con un Nexbot que tenga ordenador en marcha. No simules la ejecución ni uses otra herramienta para eludir esta limitación.")
    return "\n".join(parts)


def build_user_message(req: RunRequest) -> str:
    text = req.userText or ""
    if not req.attachments:
        return text
    documents = "\n\n".join(f"--- {a.name} ---\n{a.text}" for a in req.attachments)
    return f"Documentos adjuntos por el usuario (ya extraídos):\n\n{documents}\n\n{text}"


def _tool(fn: Any, *, parallel: bool = False) -> BaseTool:
    return FunctionTool(fn, parallel_safe=parallel)


def build_tools(
    req: RunRequest,
    state: RunState,
    bff: BffClient | None,
    searxng_url: str,
    http: httpx.AsyncClient | None = None,
) -> list[BaseTool]:
    wanted = set(req.agent.tools)
    web = WebTools(state, searxng_url, http, search_config=req.search)
    ui = ui_tools(BffOpenUiBackend(bff) if bff is not None else None, state.set_followups)
    knowledge = KnowledgeTools(state, bff, req.agent.knowledgeTopK)
    memory = MemoryTools(bff)

    catalog: dict[str, list[BaseTool]] = {
        "web_search": [_tool(web.web_search, parallel=True)],
        "web_fetch": [_tool(web.web_fetch, parallel=True)],
        **ui,
        "knowledge_search": [_tool(knowledge.knowledge_search, parallel=True)],
        "memory": [_tool(memory.remember), _tool(memory.recall), _tool(memory.forget)],
    }
    if req.agent.ui.openui == "off":
        wanted -= {"present_openui", "prompt_openui"}
    # Con la especificación en las instrucciones, openui_spec solo duplicaría ~30k caracteres
    # en el contexto (y agotaría el presupuesto del turno).
    skip = {"openui_spec"} if req.ui is not None and req.ui.spec else set()
    if not req.agent.followups:
        wanted.discard("suggest_followups")
    if req.agent.knowledgeEnabled:
        wanted.add("knowledge_search")
    if req.agent.memoryEnabled:
        wanted.add("memory")

    tools: list[BaseTool] = []
    seen: set[str] = set()
    for name, entries in catalog.items():  # orden estable
        if name not in wanted:
            continue
        for tool in entries:
            if tool.name in skip:
                continue
            if tool.name not in seen:
                seen.add(tool.name)
                tools.append(tool)
    return tools


def build_agent(req: RunRequest, model: BaseLlm, tools: list[BaseTool]) -> Agent:
    names = {tool.name for tool in tools}
    return Agent(
        name="nexus",
        model=model,
        instruction=build_instruction(req, names),
        tools=list(tools),
        generation_config=generation_config(req),
    )

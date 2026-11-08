"""Contrato HTTP entre el BFF de Nexus y el sidecar.

El sidecar no tiene estado propio: en cada petición recibe el agente, la
credencial del usuario, el historial y (si reanuda un run en pausa) el
checkpoint de la sesión. Postgres sigue siendo la única fuente de verdad.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ModelSpec(_Strict):
    provider: str
    model: str
    # SecretStr: no se imprime en repr ni en logs por accidente.
    apiKey: SecretStr | None = None
    baseUrl: str | None = None


class UiSpec(_Strict):
    """Cómo debe usar el agente la UI generativa (Intelligent UI)."""

    openui: Literal["off", "auto", "always"] = "auto"
    profiles: list[str] = Field(default_factory=lambda: ["minimal"])


class AgentSpecIn(_Strict):
    name: str = "Nexus"
    role: str = ""
    instructions: str = ""
    tools: list[str] = Field(
        default_factory=lambda: [
            "web_search",
            "web_fetch",
            "present_openui",
            "prompt_openui",
            "suggest_followups",
        ]
    )
    ui: UiSpec = Field(default_factory=UiSpec)
    followups: bool = True
    knowledgeEnabled: bool = False
    knowledgeTopK: int = 6
    memoryEnabled: bool = False


class HistoryMessage(_Strict):
    role: Literal["user", "assistant"]
    content: str


class Attachment(_Strict):
    name: str
    text: str


class ConnectorSpec(_Strict):
    id: str
    name: str
    url: str
    transport: Literal["streamable-http", "sse"] = "streamable-http"
    headers: dict[str, str] = Field(default_factory=dict)
    allowTools: list[str] | None = None


class Limits(_Strict):
    maxModelCalls: int = 20
    maxTurns: int = 10
    timeoutS: float = 600
    maxTotalTokens: int | None = None
    maxToolResultChars: int = 16000
    # Contexto máximo por llamada al modelo (tokens estimados a 4 caracteres/token).
    # El valor por defecto de nas.adk (16k) no cabe ni con dos páginas leídas.
    maxContextTokens: int = Field(default=64000, ge=8000, le=1_000_000)


class BffLink(_Strict):
    baseUrl: str
    runToken: SecretStr


class ResumeItem(_Strict):
    callId: str
    status: Literal["resolved", "approved", "denied"] = "resolved"
    payload: Any = None
    reason: str = ""


class UiRequest(_Strict):
    """UI generativa para este turno, decidida por el BFF (foco, modo o interruptor «UI»)."""

    requested: bool = False
    profile: str = "minimal"
    # Especificación OpenUI del perfil; así el modelo no depende de llamar a openui_spec.
    spec: str | None = Field(default=None, max_length=120_000)


class RunRequest(_Strict):
    runId: str
    threadId: str
    userId: str
    initiator: Literal["user", "routine", "trigger"] = "user"
    agent: AgentSpecIn = Field(default_factory=AgentSpecIn)
    model: ModelSpec
    history: list[HistoryMessage] = Field(default_factory=list)
    userText: str | None = None
    attachments: list[Attachment] = Field(default_factory=list)
    focus: str | None = None
    mode: Literal["search", "research"] | None = None
    # Instrucciones del foco y del modo Research, ya redactadas por el BFF.
    turnInstructions: str | None = Field(default=None, max_length=8000)
    # Para reanudar un run en pausa: sesión serializada + respuestas de la persona.
    checkpoint: list[dict[str, Any]] | None = None
    resume: list[ResumeItem] | None = None
    connectors: list[ConnectorSpec] = Field(default_factory=list)
    ui: UiRequest | None = None
    limits: Limits = Field(default_factory=Limits)
    bff: BffLink | None = None


class CompleteRequest(_Strict):
    """Una llamada de texto al modelo del usuario, sin herramientas ni sesión."""

    model: ModelSpec
    system: str = Field(max_length=20000)
    user: str = Field(max_length=20000)
    maxTokens: int = Field(default=2000, ge=1, le=8000)
    temperature: float = Field(default=0.4, ge=0, le=1.5)

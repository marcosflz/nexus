"""Contrato HTTP entre el BFF de Nexus y el sidecar.

El sidecar no tiene estado propio: en cada petición recibe el agente, la
credencial del usuario, el historial y (si reanuda un run en pausa) el
checkpoint de la sesión. Postgres sigue siendo la única fuente de verdad.
"""

from __future__ import annotations

from typing import Any, Literal

from nas.adk.sessions.checkpoint import SessionCheckpoint
from nas.adk.skills import SkillRef
from pydantic import BaseModel, ConfigDict, Field, SecretStr


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ModelSpec(_Strict):
    provider: str
    model: str
    # SecretStr: no se imprime en repr ni en logs por accidente.
    apiKey: SecretStr | None = None
    baseUrl: str | None = None
    # Ajustes de Claude Code fijados desde la web; sin ellos, los del entorno.
    timeoutS: float | None = Field(default=None, gt=0, le=3600)
    maxConcurrency: int | None = Field(default=None, ge=1, le=20)


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


class SearchProviderSpec(_Strict):
    id: Literal["searxng", "langsearch", "brave"]
    apiKey: SecretStr | None = None
    baseUrl: str | None = None


class SearchConfig(_Strict):
    """Motores activos, en orden de preferencia. Lo fija un admin desde la web."""

    providers: list[SearchProviderSpec] = Field(default_factory=list, max_length=10)
    # Con menos resultados que estos se prueba también el siguiente motor.
    minResults: int = Field(default=3, ge=1, le=20)


class SearchTestRequest(_Strict):
    provider: SearchProviderSpec
    query: str = Field(default="noticias de tecnología", min_length=1, max_length=200)


class RoomMember(_Strict):
    handle: str = Field(max_length=60)
    name: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=400)


class RoomSpec(_Strict):
    """Turno de un NexBot en una sala: quién es, dónde habla y con quién."""

    handle: str = Field(max_length=60)
    botName: str = Field(max_length=120)
    botInstructions: str = Field(default="", max_length=8000)
    roomName: str = Field(default="", max_length=120)
    topicId: str = Field(default="", max_length=60)
    topicTitle: str = Field(default="", max_length=200)
    members: list[RoomMember] = Field(default_factory=list, max_length=20)
    # False: el bot habla en un chat normal, sin sala ni tablero.
    board: bool = True
    environment: bool = True


class PromptOverrides(_Strict):
    """Textos del prompt del sistema que un superadmin ha editado desde la web.

    None = el texto por defecto del sidecar. `core` admite {name}, {role} y {today}.
    """

    core: str | None = Field(default=None, max_length=20000)
    ui: str | None = Field(default=None, max_length=20000)
    followups: str | None = Field(default=None, max_length=4000)


class GenerationSpec(_Strict):
    """Parámetros de generación de la instancia. None = lo que decida el proveedor."""

    temperature: float | None = Field(default=None, ge=0, le=2)
    maxTokens: int | None = Field(default=None, gt=0, le=128000)
    reasoningEffort: Literal["low", "medium", "high"] | None = None


class RunRequest(_Strict):
    runId: str
    threadId: str
    userId: str
    initiator: Literal["user", "routine", "trigger", "room"] = "user"
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
    checkpoint: SessionCheckpoint | list[dict[str, Any]] | None = None
    skills: list[SkillRef] = Field(default_factory=list)
    explicitSkills: list[str] = Field(default_factory=list)
    skillScripts: bool = False
    skillCreator: bool = False
    resume: list[ResumeItem] | None = None
    connectors: list[ConnectorSpec] = Field(default_factory=list)
    # Sin ella, solo el SearXNG del entorno.
    search: SearchConfig | None = None
    # Computer use: el run solo tendrá las herramientas del escritorio de su bot.
    computer: bool = False
    # Turno de sala: igual de confinado al bot, más el tablero de la sala.
    room: RoomSpec | None = None
    ui: UiRequest | None = None
    prompts: PromptOverrides | None = None
    generation: GenerationSpec | None = None
    limits: Limits = Field(default_factory=Limits)
    bff: BffLink | None = None


class CapabilitiesRequest(_Strict):
    # Token de la cuenta de Anthropic vinculada por el usuario. Sin él solo se comprueba el CLI.
    claudeCodeToken: SecretStr | None = None


class ClaudeCodeLoginStart(_Strict):
    # Usuario de Nexus que vincula su cuenta: la vinculación solo la puede terminar él.
    owner: str = Field(min_length=1, max_length=200)


class ClaudeCodeLoginFinish(_Strict):
    owner: str = Field(min_length=1, max_length=200)
    loginId: str = Field(min_length=1, max_length=200)
    code: SecretStr = Field(min_length=1, max_length=512)


class ClaudeCodeLoginCancel(_Strict):
    owner: str = Field(min_length=1, max_length=200)
    loginId: str = Field(min_length=1, max_length=200)


class CompleteRequest(_Strict):
    """Una llamada de texto al modelo del usuario, sin herramientas ni sesión."""

    model: ModelSpec
    system: str = Field(max_length=20000)
    user: str = Field(max_length=20000)
    maxTokens: int = Field(default=2000, ge=1, le=8000)
    temperature: float = Field(default=0.4, ge=0, le=1.5)


class ClaudeCodeModelsRequest(_Strict):
    token: SecretStr = Field(min_length=1, max_length=2000)


class ChatGptLoginStart(_Strict):
    owner: str = Field(min_length=1, max_length=200)
    # Identificador opaco de esta instalación (uno por instancia, nunca por persona).
    hostId: str = Field(min_length=1, max_length=300)
    # client_id que OpenAI emitió antes a este usuario, para no registrarlo de nuevo.
    clientId: str | None = Field(default=None, max_length=300)


class ChatGptLoginFinish(_Strict):
    owner: str = Field(min_length=1, max_length=200)
    loginId: str = Field(min_length=1, max_length=200)
    redirectUrl: SecretStr = Field(min_length=1, max_length=8000)


class ChatGptLoginCancel(_Strict):
    owner: str = Field(min_length=1, max_length=200)
    loginId: str = Field(min_length=1, max_length=200)


class ChatGptCredentialsIn(_Strict):
    clientId: str = Field(min_length=1, max_length=300)
    accessToken: SecretStr
    refreshToken: SecretStr
    expiresAt: float
    account: str | None = None


class ChatGptRefreshRequest(_Strict):
    credentials: ChatGptCredentialsIn


class ChatGptModelsRequest(_Strict):
    accessToken: SecretStr

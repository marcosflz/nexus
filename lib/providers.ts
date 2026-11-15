export interface ProviderInfo {
  id: string;
  label: string;
  needsKey: boolean;
  defaultModel: string;
  placeholder?: string;
  /**
   * Endpoint OpenAI-compatible de listado (`GET` con `Authorization: Bearer`).
   * Es una constante nuestra, nunca algo que venga del usuario: la ruta que lo
   * consume no debe poder apuntar a un host arbitrario.
   */
  modelsUrl?: string;
  /** Cómo se envía la clave al listar modelos. Por defecto `Authorization: Bearer`. */
  modelsAuth?: "bearer" | "anthropic";
  /** Modelos fijos que se ofrecen en un desplegable, sin consultar a nadie. */
  modelOptions?: string[];
  /**
   * Suscripción personal que cada usuario vincula con su cuenta (nunca compartida). Requiere el
   * permiso de suscripciones que concede un admin.
   */
  requires?: "claudeCode" | "chatgpt";
  /** `api`: servicios con clave de API. `subscription`: planes personales (Claude, ChatGPT…). */
  kind: "api" | "subscription";
  /** Cómo se conecta: con una clave, o vinculando la cuenta (Claude Code / ChatGPT). */
  linkFlow: "key" | "claude" | "chatgpt";
  /** Breve explicación para la tarjeta del proveedor. */
  hint?: string;
}

export const CLAUDE_CODE_PROVIDER = "claude-code";
export const CHATGPT_PROVIDER = "chatgpt";

/** Proveedores de suscripción personal (necesitan el permiso de un admin). */
export function isPersonalSubscription(id: string): boolean {
  return Boolean(getProvider(id)?.requires);
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openrouter",
    kind: "api",
    linkFlow: "key",
    label: "OpenRouter",
    needsKey: true,
    defaultModel: "anthropic/claude-sonnet-4.6",
    placeholder: "sk-or-v1-...",
    modelsUrl: "https://openrouter.ai/api/v1/models",
  },
  {
    id: "openai-api",
    kind: "api",
    linkFlow: "key",
    label: "OpenAI",
    needsKey: true,
    defaultModel: "gpt-5.5",
    placeholder: "sk-...",
    modelsUrl: "https://api.openai.com/v1/models",
  },
  {
    id: "anthropic",
    kind: "api",
    linkFlow: "key",
    label: "Anthropic (API)",
    needsKey: true,
    defaultModel: "claude-sonnet-5-5",
    placeholder: "sk-ant-...",
    modelsUrl: "https://api.anthropic.com/v1/models?limit=100",
    modelsAuth: "anthropic",
  },
  {
    id: "gemini",
    kind: "api",
    linkFlow: "key",
    label: "Google Gemini",
    needsKey: true,
    defaultModel: "gemini-3-flash",
    placeholder: "AIza...",
  },
  {
    id: "deepseek",
    kind: "api",
    linkFlow: "key",
    label: "DeepSeek",
    needsKey: true,
    defaultModel: "deepseek-chat",
    placeholder: "sk-...",
  },
  {
    id: "lmstudio",
    kind: "api",
    linkFlow: "key",
    label: "LM Studio / OpenAI-compatible local",
    needsKey: false,
    defaultModel: "local-model",
    placeholder: "opcional",
  },
  {
    // Suscripción OpenCode Go: el sidecar usa el proveedor `opencode` de nas-adk.
    id: "opencode-go",
    kind: "subscription",
    linkFlow: "key",
    hint: "Tu suscripción de OpenCode Go, con la clave de opencode.ai/console/go.",
    label: "OpenCode Go",
    needsKey: true,
    defaultModel: "claude-haiku-5-5",
    placeholder: "clave de opencode.ai/console/go",
    modelsUrl: "https://opencode.ai/zen/go/v1/models",
  },
  {
    // Usa la suscripción de Anthropic que cada usuario vincula a su propia cuenta (nunca una
    // común). Los alias los resuelve el CLI; `default` deja que elija él.
    id: CLAUDE_CODE_PROVIDER,
    kind: "subscription",
    linkFlow: "claude",
    hint: "Tu suscripción de Claude (Pro o Max), a través de Claude Code.",
    label: "Claude",
    needsKey: false,
    defaultModel: "default",
    requires: "claudeCode",
  },
  {
    // «Sign in with ChatGPT»: cada usuario autoriza su propio plan; el token se refresca solo.
    id: CHATGPT_PROVIDER,
    kind: "subscription",
    linkFlow: "chatgpt",
    hint: "Tu plan de ChatGPT (Plus, Pro…), con «Sign in with ChatGPT».",
    label: "ChatGPT",
    needsKey: false,
    defaultModel: "",
    requires: "chatgpt",
  },
];

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

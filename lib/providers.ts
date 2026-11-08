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
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    defaultModel: "anthropic/claude-sonnet-4.6",
    placeholder: "sk-or-v1-...",
    modelsUrl: "https://openrouter.ai/api/v1/models",
  },
  {
    id: "openai-api",
    label: "OpenAI",
    needsKey: true,
    defaultModel: "gpt-5.5",
    placeholder: "sk-...",
    modelsUrl: "https://api.openai.com/v1/models",
  },
  {
    id: "anthropic",
    label: "Anthropic (API)",
    needsKey: true,
    defaultModel: "claude-sonnet-5-5",
    placeholder: "sk-ant-...",
    modelsUrl: "https://api.anthropic.com/v1/models?limit=100",
    modelsAuth: "anthropic",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    defaultModel: "gemini-3-flash",
    placeholder: "AIza...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    needsKey: true,
    defaultModel: "deepseek-chat",
    placeholder: "sk-...",
  },
  {
    id: "lmstudio",
    label: "LM Studio / OpenAI-compatible local",
    needsKey: false,
    defaultModel: "local-model",
    placeholder: "opcional",
  },
  {
    // Suscripción OpenCode Go: el sidecar usa el proveedor `opencode` de nas-adk.
    id: "opencode-go",
    label: "OpenCode Go",
    needsKey: true,
    defaultModel: "claude-haiku-5-5",
    placeholder: "clave de opencode.ai/console/go",
    modelsUrl: "https://opencode.ai/zen/go/v1/models",
  },
];

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface ProviderInfo {
  id: string;
  label: string;
  envVar?: string;
  needsKey: boolean;
  defaultModel: string;
  placeholder?: string;
  /**
   * Endpoint OpenAI-compatible de listado (`GET` con `Authorization: Bearer`).
   * Es una constante nuestra, nunca algo que venga del usuario: la ruta que lo
   * consume no debe poder apuntar a un host arbitrario.
   */
  modelsUrl?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    needsKey: true,
    defaultModel: "anthropic/claude-sonnet-4.6",
    placeholder: "sk-or-v1-...",
    modelsUrl: "https://openrouter.ai/api/v1/models",
  },
  {
    id: "openai-api",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    needsKey: true,
    defaultModel: "gpt-5.5",
    placeholder: "sk-...",
    modelsUrl: "https://api.openai.com/v1/models",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    needsKey: true,
    defaultModel: "claude-sonnet-4.6",
    placeholder: "sk-ant-...",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    needsKey: true,
    defaultModel: "gemini-3-flash",
    placeholder: "AIza...",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
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
    // Hermes trae este proveedor de serie (plugin `opencode-zen`), con endpoint
    // propio. Ojo: la variable NO es OPENCODE_API_KEY (la genérica de models.dev)
    // sino OPENCODE_GO_API_KEY; si se usa la otra, la petición sale sin clave.
    id: "opencode-go",
    label: "OpenCode Go",
    envVar: "OPENCODE_GO_API_KEY",
    needsKey: true,
    defaultModel: "claude-haiku-5-5",
    placeholder: "clave de opencode.ai/console/go",
    modelsUrl: "https://opencode.ai/zen/go/v1/models",
  },
];

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

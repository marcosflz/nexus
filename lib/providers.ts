export interface ProviderInfo {
  id: string;
  label: string;
  envVar?: string;
  needsKey: boolean;
  defaultModel: string;
  placeholder?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    needsKey: true,
    defaultModel: "anthropic/claude-sonnet-4.6",
    placeholder: "sk-or-v1-...",
  },
  {
    id: "openai-api",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    needsKey: true,
    defaultModel: "gpt-5.5",
    placeholder: "sk-...",
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
];

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

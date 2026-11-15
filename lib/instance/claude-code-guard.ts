import { mayUseClaudeCode, providerAllowed } from "@/lib/access";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { claudeCodeRuntime } from "@/lib/instance/claude-code";
import { CLAUDE_CODE_PROVIDER, getProvider } from "@/lib/providers";

/** Usuario que puede vincular y usar SU propia suscripción de `provider` (nunca compartida). */
export async function requireSubscriptionUser(
  provider: string,
): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "No autenticado" }, { status: 401 }) };
  const label = getProvider(provider)?.label ?? provider;
  if (!mayUseClaudeCode(user) || !providerAllowed(user, provider)) {
    return {
      response: Response.json({ error: `Un administrador debe darte permiso para usar ${label}` }, { status: 403 }),
    };
  }
  if (provider === CLAUDE_CODE_PROVIDER && !(await claudeCodeRuntime()).enabled) {
    return { response: Response.json({ error: "Un superadmin ha desactivado Claude Code." }, { status: 503 }) };
  }
  return { user };
}

/** Usuario que puede vincular y usar SU cuenta de Anthropic con Claude Code. */
export function requireClaudeCodeUser() {
  return requireSubscriptionUser(CLAUDE_CODE_PROVIDER);
}

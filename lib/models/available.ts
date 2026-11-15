import { mayUseClaudeCode, modelAllowed, providerAllowed, type AccessSubject } from "@/lib/access";
import { enabledModels, listCredentials, type CredentialRow, type ModelEntry } from "@/lib/credentials";
import { chatgptAccount } from "@/lib/instance/chatgpt";
import { claudeCodeStatusFor } from "@/lib/instance/claude-code";
import { PROVIDERS, type ProviderInfo } from "@/lib/providers";

export interface ModelUser extends AccessSubject {
  id: string;
  canUseClaudeCode: boolean;
}

/** Proveedores que esta cuenta puede usar (las suscripciones personales requieren permiso). */
export function visibleProviders(user: ModelUser): ProviderInfo[] {
  const subscriptions = mayUseClaudeCode(user);
  return PROVIDERS.filter((p) => providerAllowed(user, p.id) && (subscriptions || !p.requires));
}

export interface AccountState {
  linked: boolean;
  ready: boolean;
  reason: string | null;
  account?: string | null;
}

export interface ProviderView {
  id: string;
  label: string;
  kind: ProviderInfo["kind"];
  linkFlow: ProviderInfo["linkFlow"];
  hint: string | null;
  needsKey: boolean;
  placeholder: string | null;
  /** Se pueden consultar sus modelos (catálogo). */
  canList: boolean;
  /** Lista cerrada impuesta por un admin, si la hay. */
  allowedModels: string[] | null;
  defaultModel: string;
  /** Problema de la instancia (desactivado, CLI ausente…). */
  unavailable: string | null;
  account: AccountState | null;
  /** Configuración del usuario, o null si aún no lo ha añadido. */
  config: {
    enabled: boolean;
    hasKey: boolean;
    baseUrl: string | null;
    model: string;
    models: ModelEntry[];
    isDefault: boolean;
  } | null;
}

async function accountFor(user: ModelUser, info: ProviderInfo): Promise<{ unavailable: string | null; account: AccountState | null }> {
  if (info.linkFlow === "claude") {
    const status = await claudeCodeStatusFor(user.id);
    return {
      unavailable: status.cliReady ? null : (status.reason ?? "No disponible"),
      account: { linked: status.linked, ready: status.available, reason: status.reason },
    };
  }
  if (info.linkFlow === "chatgpt") {
    const state = await chatgptAccount(user.id);
    return {
      unavailable: null,
      account: {
        linked: state.state === "linked",
        ready: state.state === "linked",
        reason:
          state.state === "unreadable"
            ? "No se puede leer tu sesión guardada (¿cambió APP_ENCRYPTION_KEY?). Vuelve a vincular la cuenta."
            : state.state === "missing"
              ? "Vincula tu cuenta de ChatGPT para usar tu plan."
              : null,
        account: state.state === "linked" ? state.account : null,
      },
    };
  }
  return { unavailable: null, account: null };
}

function allowedModels(user: ModelUser, providerId: string): string[] | null {
  if (user.role === "superadmin" || user.access.modelAccess === null) return null;
  const rule = user.access.modelAccess[providerId];
  return Array.isArray(rule) ? rule : null;
}

export async function providerViews(user: ModelUser): Promise<ProviderView[]> {
  const rows = new Map((await listCredentials(user.id)).map((row) => [row.provider, row]));
  return Promise.all(
    visibleProviders(user).map(async (info) => {
      const row = rows.get(info.id);
      const { unavailable, account } = await accountFor(user, info);
      const closed = allowedModels(user, info.id);
      return {
        id: info.id,
        label: info.label,
        kind: info.kind,
        linkFlow: info.linkFlow,
        hint: info.hint ?? null,
        needsKey: info.needsKey,
        placeholder: info.placeholder ?? null,
        canList: info.linkFlow !== "key" || Boolean(info.modelsUrl),
        allowedModels: closed,
        defaultModel: closed?.[0] ?? info.defaultModel,
        unavailable,
        account,
        config: row
          ? {
              enabled: row.enabled,
              hasKey: Boolean(row.apiKeyEnc),
              baseUrl: row.baseUrl,
              model: row.model,
              models: enabledModels(row).filter((m) => modelAllowed(user, info.id, m.id)),
              isDefault: row.isDefault,
            }
          : null,
      } satisfies ProviderView;
    }),
  );
}

export interface ModelGroup {
  provider: string;
  label: string;
  kind: ProviderInfo["kind"];
  models: ModelEntry[];
}

/** Un proveedor está listo para usarse: activo, con credencial y (si aplica) cuenta vinculada. */
function usable(info: ProviderInfo, row: CredentialRow): boolean {
  if (!row.enabled) return false;
  if (info.linkFlow !== "key" || info.needsKey) return Boolean(row.apiKeyEnc);
  return true;
}

/** Modelos activos de todos los proveedores listos, agrupados, para el selector del chat. */
export async function activeModelGroups(user: ModelUser): Promise<{ groups: ModelGroup[]; default: { provider: string; model: string } | null }> {
  const rows = await listCredentials(user.id);
  const byId = new Map(rows.map((row) => [row.provider, row]));
  const groups: ModelGroup[] = [];
  for (const info of visibleProviders(user)) {
    const row = byId.get(info.id);
    if (!row || !usable(info, row)) continue;
    const models = enabledModels(row).filter((m) => modelAllowed(user, info.id, m.id));
    if (models.length > 0) groups.push({ provider: info.id, label: info.label, kind: info.kind, models });
  }
  const preferred = rows.find((row) => row.isDefault && groups.some((g) => g.provider === row.provider));
  const group = groups.find((g) => g.provider === preferred?.provider) ?? groups[0];
  const model = group?.models.find((m) => m.id === preferred?.model)?.id ?? group?.models[0]?.id;
  return { groups, default: group && model ? { provider: group.provider, model } : null };
}

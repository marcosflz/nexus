import { eq } from "drizzle-orm";
import { z } from "zod";
import type { SidecarSearchConfig } from "@/lib/agents/backends/nas-adk";
import { nasAdkConfig } from "@/lib/agents/backends/nas-adk";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { instanceSettings } from "@/lib/db/schema";
import { signSidecarRequest } from "@/lib/internal/token";
import {
  completeOrder,
  SEARCH_PROVIDER_IDS,
  searchProvider,
  type SearchProviderId,
  type SearchSettingsView,
} from "@/lib/search/providers";

const KEY = "search";

const storedSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.enum(SEARCH_PROVIDER_IDS),
        enabled: z.boolean().default(false),
        apiKeyEnc: z.string().nullable().default(null),
        baseUrl: z.string().nullable().default(null),
      }),
    )
    .default([]),
  minResults: z.number().int().min(1).max(20).default(3),
});
type Stored = z.infer<typeof storedSchema>;
type StoredProvider = Stored["providers"][number];

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), "Solo URLs http(s)");

export const searchUpdateSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.enum(SEARCH_PROVIDER_IDS),
        enabled: z.boolean(),
        /** Clave nueva. Sin ella se conserva la guardada. */
        apiKey: z.string().trim().min(1).max(500).optional(),
        clearKey: z.boolean().optional(),
        baseUrl: httpUrl.nullable().optional(),
      }),
    )
    .min(1)
    .max(SEARCH_PROVIDER_IDS.length),
  minResults: z.number().int().min(1).max(20),
});

export const searchTestSchema = z.object({
  id: z.enum(SEARCH_PROVIDER_IDS),
  /** Para probar una clave antes de guardarla. */
  apiKey: z.string().trim().min(1).max(500).optional(),
  baseUrl: httpUrl.nullable().optional(),
});

function defaultProvider(id: SearchProviderId): StoredProvider {
  return { id, enabled: id === "searxng", apiKeyEnc: null, baseUrl: null };
}

async function loadStored(): Promise<{ stored: Stored; exists: boolean }> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, KEY)).limit(1);
  const parsed = storedSchema.safeParse(row?.value ?? {});
  const stored = parsed.success ? parsed.data : storedSchema.parse({});
  return { stored: { ...stored, providers: completeOrder(stored.providers, defaultProvider) }, exists: Boolean(row) };
}

function decryptKey(provider: StoredProvider): string | null {
  if (!provider.apiKeyEnc) return null;
  try {
    return decryptSecret(provider.apiKeyEnc);
  } catch {
    return null;
  }
}

/** Lo que ve un admin: nunca las claves. */
export async function getSearchSettings(): Promise<SearchSettingsView> {
  const { stored } = await loadStored();
  return {
    minResults: stored.minResults,
    providers: stored.providers.map((provider) => ({
      id: provider.id,
      enabled: provider.enabled,
      hasKey: Boolean(provider.apiKeyEnc),
      keyUnreadable: Boolean(provider.apiKeyEnc) && decryptKey(provider) === null,
      baseUrl: provider.baseUrl,
    })),
  };
}

export type SearchUpdate = z.infer<typeof searchUpdateSchema>;

/** Devuelve el motivo si no se puede guardar. */
export async function saveSearchSettings(update: SearchUpdate, actorId: string): Promise<string | null> {
  const { stored } = await loadStored();
  const previous = new Map(stored.providers.map((provider) => [provider.id, provider]));

  const merged = update.providers.map((incoming): StoredProvider => {
    const current = previous.get(incoming.id) ?? defaultProvider(incoming.id);
    const apiKeyEnc = incoming.clearKey ? null : incoming.apiKey ? encryptSecret(incoming.apiKey) : current.apiKeyEnc;
    return {
      id: incoming.id,
      enabled: incoming.enabled,
      apiKeyEnc,
      baseUrl: incoming.baseUrl === undefined ? current.baseUrl : incoming.baseUrl,
    };
  });
  const providers = completeOrder(merged, (id) => previous.get(id) ?? defaultProvider(id));

  for (const provider of providers) {
    const { label, needsKey } = searchProvider(provider.id);
    if (provider.enabled && needsKey && (!provider.apiKeyEnc || decryptKey(provider) === null)) {
      return `${label} necesita una clave de API para activarse`;
    }
  }

  const value: Stored = { providers, minResults: update.minResults };
  await db
    .insert(instanceSettings)
    .values({ key: KEY, value, updatedBy: actorId })
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });
  return null;
}

/**
 * Motores para un run, con las claves en claro. Sin configuración guardada, o si no
 * se puede leer, `null`: el sidecar usa su SearXNG. Una búsqueda degradada no debe
 * impedir que el run empiece.
 */
export async function searchRuntime(): Promise<SidecarSearchConfig | null> {
  try {
    const { stored, exists } = await loadStored();
    if (!exists) return null;
    return {
      minResults: stored.minResults,
      providers: stored.providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({ id: provider.id, apiKey: decryptKey(provider), baseUrl: provider.baseUrl })),
    };
  } catch {
    return null;
  }
}

export interface SearchTestResult {
  ok: boolean;
  results: number;
  ms: number;
  error: string | null;
  /** Motores internos de SearXNG que no respondieron (bloqueos, CAPTCHA…). */
  degraded?: string[];
  sample: { title: string | null; url: string }[];
}

/** Una consulta real a un solo motor, desde el sidecar (desde donde saldrán las búsquedas). */
export async function testSearchProvider(input: z.infer<typeof searchTestSchema>): Promise<SearchTestResult> {
  const failed = (error: string): SearchTestResult => ({ ok: false, results: 0, ms: 0, error, sample: [] });
  const config = nasAdkConfig();
  if (!config) return failed("El motor de agentes no está configurado");

  const { stored } = await loadStored();
  const current = stored.providers.find((provider) => provider.id === input.id);
  const body = JSON.stringify({
    provider: {
      id: input.id,
      apiKey: input.apiKey ?? (current ? decryptKey(current) : null),
      baseUrl: input.baseUrl === undefined ? (current?.baseUrl ?? null) : input.baseUrl,
    },
  });
  try {
    const response = await fetch(`${config.url}/v1/search/test`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...signSidecarRequest(body) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) return failed(`El motor de agentes respondió ${response.status}`);
    return (await response.json()) as SearchTestResult;
  } catch {
    return failed("El motor de agentes no responde");
  }
}

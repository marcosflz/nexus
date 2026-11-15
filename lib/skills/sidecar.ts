import { nasAdkConfig } from "@/lib/agents/backends/nas-adk";
import { signSidecarRequest } from "@/lib/internal/token";
import type { SkillPackage } from "./contracts.generated";

export async function skillOperation(input: Record<string, unknown>): Promise<{ packages?: SkillPackage[]; archive?: string; reports?: { passed: boolean; score: number; status: string; details: string }[] }> {
  const config = nasAdkConfig();
  if (!config) throw new Error("El motor nas-adk no está configurado");
  const body = JSON.stringify(input);
  const response = await fetch(`${config.url}/v1/skills`, {
    method: "POST", body,
    headers: { "Content-Type": "application/json", ...signSidecarRequest(body) },
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json() as { packages?: SkillPackage[]; archive?: string; reports?: { passed: boolean; score: number; status: string; details: string }[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? "No se pudo procesar la skill");
  return data;
}

export async function validateSkillFiles(files: Record<string, string>): Promise<SkillPackage> {
  const result = await skillOperation({ op: "validate", files });
  if (!result.packages?.[0]) throw new Error("El motor no devolvió una skill válida");
  return result.packages[0];
}

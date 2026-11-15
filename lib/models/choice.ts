export interface ModelChoice {
  provider: string;
  model: string;
}

/**
 * Proveedor y modelo de un turno. Si el agente fija modelo (proveedor o modelo), manda el del
 * agente; si no, el elegido en el selector del chat; y si tampoco, el predeterminado de la cuenta.
 */
export function resolveTurnModel(
  agentModel: { provider?: string; model?: string },
  chosen: ModelChoice | null | undefined,
): { provider?: string; model?: string; fixedByAgent: boolean } {
  if (agentModel.provider || agentModel.model) {
    return { provider: agentModel.provider, model: agentModel.model, fixedByAgent: true };
  }
  if (chosen) return { provider: chosen.provider, model: chosen.model, fixedByAgent: false };
  return { fixedByAgent: false };
}

import { DEFAULT_RULES, isComputerTool } from "./defaults";
import type { ActionRequest, PolicyDecision, PolicyRule } from "./types";

/**
 * Decide si una acción puede ejecutarse.
 *
 * Garantías:
 *  - `deny` gana siempre sobre `ask` y `allow`, sin importar el orden.
 *  - Una regla que lanza excepción deniega (fail-closed).
 *  - Si ninguna regla casa, deniega.
 */
export async function decideAction(req: ActionRequest): Promise<PolicyDecision> {
  return decideWithRules(DEFAULT_RULES, req);
}

/**
 * Núcleo del motor, separado para poder probarlo con reglas propias
 * (incluida una que lanza excepción) sin tocar la política de producción.
 */
export function decideWithRules(rules: PolicyRule[], req: ActionRequest): PolicyDecision {
  // Mientras una persona conduce el navegador, el agente no lo toca.
  if (req.humanInControl && isComputerTool(req.tool)) {
    return {
      effect: "deny",
      rule: "human-in-control",
      reason: "Una persona tiene el control del navegador en este momento.",
    };
  }

  const matched: PolicyDecision[] = [];
  for (const rule of rules) {
    let hit = false;
    try {
      hit = rule.when(req);
    } catch {
      return {
        effect: "deny",
        rule: `${rule.id}:error`,
        reason: "La regla falló al evaluarse; se deniega por precaución.",
      };
    }
    if (hit) matched.push({ effect: rule.effect, rule: rule.id, reason: rule.reason });
  }

  const deny = matched.find((d) => d.effect === "deny");
  if (deny) return deny;
  const ask = matched.find((d) => d.effect === "ask");
  if (ask) return ask;
  const allow = matched.find((d) => d.effect === "allow");
  if (allow) return allow;

  return {
    effect: "deny",
    rule: "default-deny",
    reason: "Ninguna regla permite esta acción.",
  };
}

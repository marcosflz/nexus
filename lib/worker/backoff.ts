/** Espera antes del reintento nº `attempt` (1, 2, 3…): 30 s, 2 min, 8 min… con tope de 1 h. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}

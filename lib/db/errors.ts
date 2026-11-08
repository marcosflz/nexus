/**
 * ¿Es una violación de unicidad de Postgres (23505)?
 *
 * Drizzle envuelve el error original en un `DrizzleQueryError` cuyo mensaje es
 * «Failed query…»: el código SQLSTATE está en `cause`, no en el propio error.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

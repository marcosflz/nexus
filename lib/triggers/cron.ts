import { CronExpressionParser } from "cron-parser";

/** Mínimo entre ejecuciones de una rutina: evita bucles que quemen la cuota del usuario. */
export const MIN_CRON_INTERVAL_MS = 5 * 60 * 1000;

export type CronCheck = { ok: true } | { ok: false; error: string };

export function validateCron(expression: string, tz: string, now: Date = new Date()): CronCheck {
  try {
    // Fallará con una zona horaria inexistente.
    new Intl.DateTimeFormat("es", { timeZone: tz });
    const it = CronExpressionParser.parse(expression, { currentDate: now, tz });
    const first = it.next().toDate().getTime();
    const second = it.next().toDate().getTime();
    if (second - first < MIN_CRON_INTERVAL_MS) {
      return { ok: false, error: "La frecuencia mínima es de una ejecución cada 5 minutos" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Expresión cron no válida" };
  }
}

/** Siguiente ejecución estrictamente posterior a `after`, respetando la zona y el horario de verano. */
export function nextCronRun(expression: string, tz: string, after: Date = new Date()): Date {
  return CronExpressionParser.parse(expression, { currentDate: after, tz }).next().toDate();
}

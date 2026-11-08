/**
 * Se ejecuta una vez al arrancar el servidor de Next.
 *
 * `register()` bloquea la disponibilidad del servidor, así que aquí solo se
 * importa el arranque del worker (y solo en Node: el código usa Postgres) y no
 * se espera a nada de larga duración.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootWorker } = await import("./lib/worker/boot");
  bootWorker();
}

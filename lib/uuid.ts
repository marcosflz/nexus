/**
 * Identificador aleatorio para el cliente.
 *
 * `crypto.randomUUID()` solo existe en **contextos seguros** (HTTPS o
 * `localhost`). En un despliegue autoalojado al que se entra por HTTP en la LAN
 * —el caso normal de Nexus— la función no está, y llamarla lanza
 * `TypeError: crypto.randomUUID is not a function` dentro del manejador del
 * evento, lo que desmonta el árbol de React y deja la página en blanco.
 *
 * `crypto.getRandomValues()` sí está disponible en contextos no seguros, así
 * que se usa para construir un UUID v4 a mano (RFC 4122 §4.4).
 */
export function randomId(): string {
  const webcrypto = globalThis.crypto;
  return typeof webcrypto?.randomUUID === "function" ? webcrypto.randomUUID() : uuidFromRandomValues();
}

function uuidFromRandomValues(): `${string}-${string}-${string}-${string}-${string}` {
  const webcrypto = globalThis.crypto;
  const bytes = new Uint8Array(16);
  if (typeof webcrypto?.getRandomValues === "function") {
    webcrypto.getRandomValues(bytes);
  } else {
    // Último recurso (entornos sin WebCrypto): no es criptográfico, pero sirve
    // para identificar mensajes en pantalla.
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Versión 4 y variante RFC 4122.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Define `crypto.randomUUID` donde el navegador no lo ofrece (HTTP sin cifrar).
 *
 * Nuestro código usa `randomId()`, pero las librerías no: los componentes de OpenUI
 * llaman a `crypto.randomUUID()` al pintarse, y por HTTP en la LAN o por Tailscale
 * cada uno fallaba y desaparecía de la interfaz generativa (los textos, los
 * gráficos…), sin más pista que un error en la consola.
 */
export function installRandomUuid(): void {
  const webcrypto = globalThis.crypto;
  if (!webcrypto || typeof webcrypto.randomUUID === "function") return;
  try {
    Object.defineProperty(webcrypto, "randomUUID", { value: uuidFromRandomValues, configurable: true, writable: true });
  } catch {
    // Un `crypto` sellado: no hay nada que hacer aquí, y no debe romper el arranque.
  }
}

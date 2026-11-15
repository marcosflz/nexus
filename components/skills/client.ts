export async function api<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la operación");
  return data as T;
}

export function decodeFile(data: string): string | null {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0))); }
  catch { return null; }
}

export function encodeFile(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function archiveFile(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("El ZIP supera 10 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer el ZIP"));
    reader.readAsDataURL(file);
  });
}

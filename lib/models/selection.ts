/** Elección del selector de modelos del chat, recordada en este navegador. */

export const MODELS_CHANGED_EVENT = "nexus:models-changed";
const KEY = "nexus.chat.model";

export interface StoredModel {
  provider: string;
  model: string;
}

export function readStoredModel(): StoredModel | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredModel>;
    return typeof value.provider === "string" && typeof value.model === "string"
      ? { provider: value.provider, model: value.model }
      : null;
  } catch {
    return null;
  }
}

export function storeModel(choice: StoredModel): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Sin almacenamiento (modo privado): la elección dura lo que la pestaña.
  }
}

/** Avisa al chat de que han cambiado los proveedores o modelos activos. */
export function notifyModelsChanged(): void {
  try {
    window.dispatchEvent(new Event(MODELS_CHANGED_EVENT));
  } catch {
    // Fuera del navegador no hay nada que avisar.
  }
}

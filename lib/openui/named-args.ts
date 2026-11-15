/**
 * Argumentos con nombre → posicionales.
 *
 * OpenUI Lang solo admite argumentos posicionales, pero muchos modelos escriben
 * `TextContent(text: "Hola", size: "large")` o, al estilo de Python,
 * `TextContent(text="Hola")` y `{title="Fuente"}`. El parser no lo rechaza: lee `text`
 * como una referencia sin definir, descarta el componente y la interfaz sale
 * vacía. Como la intención es inequívoca, se reescribe a `TextContent("Hola", "large")`
 * con el orden de parámetros de la librería, antes de validar y antes de pintar.
 *
 * Es puro texto (sin React ni la librería), para poder usarlo y probarlo en
 * cualquier lado.
 */

/** Orden de los parámetros de cada componente. */
export type ArgumentOrder = ReadonlyMap<string, readonly string[]>;

interface LibrarySchema {
  properties?: Record<string, unknown>;
  $defs?: Record<string, { properties?: Record<string, unknown> } | undefined>;
}

/** El orden posicional es el de las propiedades de cada componente en el esquema de la librería. */
export function argumentOrderOf(schema: object): ArgumentOrder {
  const { properties, $defs } = schema as LibrarySchema;
  const order = new Map<string, string[]>();
  for (const name of Object.keys(properties ?? {})) {
    order.set(name, Object.keys($defs?.[name]?.properties ?? {}));
  }
  return order;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
// `nombre: valor` o `nombre=valor` (no `==`).
const NAMED = /^(\s*)([A-Za-z_]\w*)\s*(?::(?!:)|=(?!=))\s*/;
// Clave de objeto escrita con `=`: `{title="x"}`.
const KEY_ASSIGNED = /^(\s*)([A-Za-z_]\w*)\s*=(?!=)\s*/;
const CLOSER: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Índice siguiente al cierre de la cadena que empieza en `start`. */
function skipString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index] === '"') return index + 1;
    else index += 1;
  }
  return source.length;
}

/** Índice del cierre del paréntesis, corchete o llave abierto en `open`, o -1 si aún no ha llegado (streaming). */
function closingParen(source: string, open: number): number {
  const stack: string[] = [];
  let index = open;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      index = skipString(source, index);
      continue;
    }
    if (char in CLOSER) stack.push(CLOSER[char]);
    else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return index;
    }
    index += 1;
  }
  return -1;
}

/** Parte los argumentos por las comas de primer nivel. */
function splitArguments(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < inner.length) {
    const char = inner[index];
    if (char === '"') {
      index = skipString(inner, index);
      continue;
    }
    if (char in CLOSER) depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  parts.push(inner.slice(start));
  return parts;
}

function rewriteCall(inner: string, params: readonly string[], order: ArgumentOrder): string {
  const parts = splitArguments(inner);
  const untouched = () => parts.map((part) => rewrite(part, order)).join(",");
  if (!parts.some((part) => NAMED.test(part))) return untouched();

  const slots: (string | undefined)[] = new Array(params.length).fill(undefined);
  let next = 0;
  for (const part of parts) {
    if (!part.trim()) continue; // coma final
    const named = NAMED.exec(part);
    const index = named ? params.indexOf(named[2]) : next++;
    // Un nombre que el componente no tiene, o un hueco ya ocupado: no se adivina.
    if (index < 0 || index >= slots.length || slots[index] !== undefined) return untouched();
    slots[index] = rewrite(named ? part.slice(named[0].length) : part, order).trim();
  }
  while (slots.length > 0 && slots[slots.length - 1] === undefined) slots.pop();
  return slots.map((slot) => slot ?? "null").join(", ");
}

/** `{clave="valor"}` → `{clave: "valor"}`. */
function rewriteObject(inner: string, order: ArgumentOrder): string {
  return splitArguments(inner)
    .map((entry) => {
      const key = KEY_ASSIGNED.exec(entry);
      return key ? `${key[1]}${key[2]}: ${rewrite(entry.slice(key[0].length), order)}` : rewrite(entry, order);
    })
    .join(",");
}

function rewrite(source: string, order: ArgumentOrder): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const end = skipString(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === "{") {
      const close = closingParen(source, index);
      if (close >= 0) {
        out += `{${rewriteObject(source.slice(index + 1, close), order)}}`;
        index = close + 1;
        continue;
      }
    }
    if (!IDENT_START.test(char)) {
      out += char;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < source.length && IDENT_CHAR.test(source[end])) end += 1;
    const name = source.slice(index, end);
    let open = end;
    while (source[open] === " " || source[open] === "\t") open += 1;
    const params = order.get(name);
    const close = params && source[open] === "(" ? closingParen(source, open) : -1;
    if (params && close >= 0) {
      out += `${name}(${rewriteCall(source.slice(open + 1, close), params, order)})`;
      index = close + 1;
    } else {
      out += name;
      index = end;
    }
  }
  return out;
}

/**
 * Reescribe `Comp(nombre: valor)` como llamada posicional. Deja igual lo que no
 * sabe resolver (un nombre desconocido, una llamada aún sin cerrar), para que el
 * validador lo señale en vez de inventar.
 */
export function positionalArguments(program: string, order: ArgumentOrder): string {
  return /[:=]/.test(program) ? rewrite(program, order) : program;
}

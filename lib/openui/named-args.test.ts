import { describe, expect, it } from "vitest";
import { nexusLibrary, normalizeOpenUiProgram } from "./library";
import { argumentOrderOf, positionalArguments } from "./named-args";
import { validateOpenUiProgram } from "./validate";

const ORDER = argumentOrderOf(nexusLibrary.toJSONSchema());

// Run real (nemotron): el validador lo dio por bueno y se vio «OpenUI could not render this response».
const NAMED = `root = Card([
  TextContent(text: "Noticias de NASDAQ - 10 de noviembre de 2026", size: "large"),
  Separator(),
  TextContent(text: "1. NASDAQ cayó: informe (IPC), superior a lo esperado.", size: "default"),
])`;

// Run real (nemotron): argumentos y claves de objeto con `=`, al estilo de Python.
const PYTHON_STYLE =
  'root = Card([CardHeader(title="Nasdaq - November 10 2026", subtitle="Daily market movements"), ' +
  'TextContent("Nasdaq rose >3 % at one point.[1]", "default"), Separator()], ' +
  'sources=[{title="NHK via note.com", sourceName="note.com", url="https://note.com/isoft2020/n/nf396a6767fd1?hl=en"}])';

describe("positionalArguments", () => {
  it("entiende también `nombre=valor` y las claves de objeto con `=`", () => {
    expect(positionalArguments('h = CardHeader(title="A", subtitle="B")', ORDER)).toBe('h = CardHeader("A", "B")');
    expect(positionalArguments('s = [{title="A", url="https://a.test/?x=1"}]', ORDER)).toBe(
      's = [{title: "A", url: "https://a.test/?x=1"}]',
    );
    expect(positionalArguments(PYTHON_STYLE, ORDER)).toBe(
      'root = Card([CardHeader("Nasdaq - November 10 2026", "Daily market movements"), ' +
        'TextContent("Nasdaq rose >3 % at one point.[1]", "default"), Separator()], ' +
        '[{title: "NHK via note.com", sourceName: "note.com", url: "https://note.com/isoft2020/n/nf396a6767fd1?hl=en"}])',
    );
  });

  it("no confunde una comparación con un argumento con nombre", () => {
    const program = 'root = Card([TextContent(a == b ? "x" : "y")])';
    expect(positionalArguments(program, ORDER)).toBe(program);
  });

  it("pasa los argumentos con nombre a su posición", () => {
    expect(positionalArguments('t = TextContent(text: "Hola", size: "large")', ORDER)).toBe(
      't = TextContent("Hola", "large")',
    );
    // En otro orden, mezclados con posicionales y con huecos.
    expect(positionalArguments('t = TextContent(size: "large", text: "Hola")', ORDER)).toBe(
      't = TextContent("Hola", "large")',
    );
    expect(positionalArguments('t = TextContent("Hola", size: "large")', ORDER)).toBe('t = TextContent("Hola", "large")');
  });

  it("no toca los programas posicionales, las cadenas ni las claves de los objetos", () => {
    const program = 'root = Card([TextContent("precio: 3, size: 2"), Table(cols, [{ name: "a", value: 1 }])])';
    expect(positionalArguments(program, ORDER)).toBe(program);
  });

  it("deja igual lo que no sabe resolver", () => {
    const unknown = 't = TextContent(texto: "Hola")';
    expect(positionalArguments(unknown, ORDER)).toBe(unknown);
    const streaming = 'root = Card([TextContent(text: "Ho';
    expect(positionalArguments(streaming, ORDER)).toBe(streaming);
  });

  it("repara las llamadas anidadas ya cerradas aunque la exterior siga abierta", () => {
    expect(positionalArguments('root = Card([TextContent(text: "A"), TextContent(te', ORDER)).toBe(
      'root = Card([TextContent("A"), TextContent(te',
    );
  });
});

describe("validación de programas con argumentos con nombre", () => {
  it("acepta el programa reparado y pinta todos sus textos", () => {
    expect(validateOpenUiProgram(NAMED)).toMatchObject({ ok: true });
    const normalized = normalizeOpenUiProgram(NAMED);
    expect(normalized).toContain('TextContent("Noticias de NASDAQ - 10 de noviembre de 2026", "large")');
    expect(normalized).not.toContain("text:");
  });

  it("acepta a la primera el programa al estilo de Python, sin argumentos de más", () => {
    expect(validateOpenUiProgram(PYTHON_STYLE)).toEqual({ ok: true, warnings: 0 });
  });

  it("rechaza, con la firma, lo que dejaría un hueco en la interfaz", () => {
    const missing = validateOpenUiProgram("root = Card([TextContent(titulo)])");
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("titulo");

    const unknown = validateOpenUiProgram('root = Card([TextContent(texto: "Hola")])');
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("TextContent(text");
  });

  it("tolera los argumentos de más, que no cambian lo que se ve", () => {
    expect(validateOpenUiProgram('root = Card([TextContent("Hola", "large", "sobra")])')).toMatchObject({ ok: true });
  });
});

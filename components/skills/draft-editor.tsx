"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Play, Send, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { followRun } from "@/lib/agui/client";
import type { PersistedTool } from "@/lib/db/schema";
import { api, decodeFile, encodeFile } from "./client";

interface TestResult {
  test: { id: string; input: string; expected: string; runId: string | null };
  status: string | null; output: string; tools: PersistedTool[]; error: string | null;
  report?: { passed: boolean; score: number; status: string; details: string };
}
interface Detail {
  baseVersion?: { version: number; package: { files: Record<string, string> } } | null;
  draft: { id: string; skillId: string | null; files: Record<string, string>; revision: number };
  conversation: { id: string; role: string; content: string; tools: PersistedTool[] | null }[];
  tests: TestResult[];
  activeRuns: { id: string; status: string }[];
}
interface Approval { id: string; runId: string; tool: string; args: unknown; reason: string }
const REPORT_LABEL: Record<string, string> = { pending: "Prueba pendiente de terminar", completed: "Ejecución completada; revisa el resultado", contains_expected: "El resultado contiene el texto esperado", missing_expected: "El resultado no contiene el texto esperado", failed: "La prueba no se ha completado" };

function LiveCreator({ runId, onDone }: { runId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [activity, setActivity] = useState("Preparando el borrador…");
  useEffect(() => {
    const controller = new AbortController();
    void followRun({ runId, signal: controller.signal,
      fetchEvents: (id, after, signal) => fetch(`/api/runs/${id}/events?after=${after}`, { signal }),
      onEvent: (event) => {
        if (event.type === "TEXT_MESSAGE_CONTENT") setText((old) => old + event.delta);
        if (event.type === "TOOL_CALL_START") setActivity(({ read_draft: "Leyendo borrador…", write_draft_file: "Escribiendo archivos…", delete_draft_file: "Actualizando archivos…", validate_draft: "Validando skill…" } as Record<string, string>)[event.toolCallName] ?? "Trabajando…");
      },
    }).then(onDone).catch((reason) => { if (!controller.signal.aborted) toast.error(String(reason)); });
    return () => controller.abort();
  }, [runId, onDone]);
  return <article className="border-border rounded-xl border p-4"><p role="status" className="text-muted-fg mb-2 flex items-center gap-2 text-xs"><Loader2 className="size-3 animate-spin" />{activity}</p>{text ? <Markdown>{text}</Markdown> : null}</article>;
}

export function SkillDraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("preview");
  const [path, setPath] = useState("SKILL.md");
  const [editor, setEditor] = useState("");
  const [dirty, setDirty] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [expected, setExpected] = useState("");
  const [botId, setBotId] = useState("");
  const [bots, setBots] = useState<{ id: string; name: string; status: string; environmentEnabled: boolean }[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    try { const data = await api<Detail>(`/api/skill-drafts/${id}`); if (mounted.current) setDetail(data); }
    catch (reason) { if (mounted.current) setError(String(reason)); }
  }, [id]);
  useEffect(() => { mounted.current = true; void load(); const timer = setInterval(() => void load(), 2500); return () => { mounted.current = false; clearInterval(timer); }; }, [load]);
  useEffect(() => {
    void api<{ bots: typeof bots }>("/api/bots").then((data) => setBots(data.bots)).catch(() => {});
    const read = () => void api<{ approvals: Approval[] }>("/api/approvals/pending").then((data) => setApprovals(data.approvals)).catch(() => {});
    read(); const timer = setInterval(read, 2500); return () => clearInterval(timer);
  }, []);
  const encoded = detail?.draft.files[path];
  useEffect(() => { if (!dirty) setEditor(encoded ? decodeFile(encoded) ?? "" : ""); }, [encoded, dirty]);
  const active = detail?.activeRuns.find((run) => run.status === "running");

  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim()) return;
    setBusy(true);
    try { await api(`/api/skill-drafts/${id}/chat`, { text: message }); setMessage(""); await load(); }
    catch (reason) { toast.error(String(reason)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!detail) return;
    setBusy(true);
    try { await api(`/api/skill-drafts/${id}`, { revision: detail.draft.revision, files: { ...detail.draft.files, [path]: encodeFile(editor) } }, "PATCH"); setDirty(false); await load(); toast.success("Archivo guardado"); }
    catch (reason) { toast.error(String(reason)); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!detail) return;
    setBusy(true);
    try { const result = await api<{ skill: { id: string } }>(`/api/skill-drafts/${id}/publish`, { revision: detail.draft.revision }); toast.success("Versión publicada en tu biblioteca privada"); router.push(`/skills/${result.skill.id}`); }
    catch (reason) { toast.error(String(reason)); setBusy(false); }
  }
  async function test(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await api(`/api/skill-drafts/${id}/tests`, { input: testInput, expected, botId: botId || undefined }); await load(); }
    catch (reason) { toast.error(String(reason)); }
    finally { setBusy(false); }
  }
  async function decide(approvalId: string, decision: string) {
    try { await api(`/api/approvals/${approvalId}`, { decision }); setApprovals((old) => old.filter((item) => item.id !== approvalId)); await load(); }
    catch (reason) { toast.error(String(reason)); }
  }
  if (!detail) return <p role={error ? "alert" : "status"} className="p-8">{error || "Cargando borrador…"}</p>;
  const preview = detail.draft.files["SKILL.md"] ? decodeFile(detail.draft.files["SKILL.md"]) : null;
  const baseFiles = detail.baseVersion?.package.files ?? {};
  const changes = [...new Set([...Object.keys(baseFiles), ...Object.keys(detail.draft.files)])].filter((name) => baseFiles[name] !== detail.draft.files[name]);
  return <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-7xl p-4 md:p-7">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><Link href="/skills" className="text-muted-fg text-sm">← Skills</Link><h1 className="mt-2 flex items-center gap-2 text-xl font-semibold"><Sparkles className="size-5" /> Creador de skills</h1><p className="text-muted-fg mt-1 text-sm">Conversa, revisa el borrador y pruébalo antes de publicar.</p></div><Button disabled={busy || Boolean(active) || dirty || !preview} onClick={() => void publish()}><Check className="size-4" /> Publicar versión</Button></header>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="border-border flex min-h-[480px] flex-col rounded-2xl border p-4">
        <div className="mb-4 flex-1 space-y-4">
          {!detail.conversation.length ? <div className="text-muted-fg rounded-xl p-4 text-sm">Describe qué tarea quieres enseñar a Nexus. Por ejemplo: «Quiero una skill para preparar informes semanales con un resumen, riesgos y próximos pasos».</div> : null}
          {detail.conversation.map((item) => <article key={item.id} className={item.role === "user" ? "bg-surface-2 ml-8 rounded-xl p-4" : "rounded-xl p-4"}><p className="text-muted-fg mb-2 text-xs">{item.role === "user" ? "Tú" : "Creador"}</p><Markdown>{item.content}</Markdown>{item.tools?.length ? <details className="text-muted-fg mt-2 text-xs"><summary className="cursor-pointer">{item.tools.length} operaciones sobre el borrador</summary>{item.tools.map((tool) => <p key={tool.id}>{tool.name} · {tool.status}</p>)}</details> : null}</article>)}
          {active ? <LiveCreator key={active.id} runId={active.id} onDone={load} /> : null}
        </div>
        <form onSubmit={(event) => void send(event)} className="border-border border-t pt-3"><Textarea aria-label="Mensaje al creador" placeholder="¿Qué debe hacer esta skill?" value={message} onChange={(event) => setMessage(event.target.value)} disabled={Boolean(active)} rows={3} /><div className="mt-2 flex justify-end gap-2">{active ? <Button type="button" variant="outline" onClick={() => void api(`/api/runs/${active.id}/cancel`, {}).then(load)}><Square className="size-4" /> Detener</Button> : null}<Button disabled={busy || Boolean(active) || !message.trim()}><Send className="size-4" /> Enviar</Button></div></form>
      </section>
      <section className="border-border min-w-0 rounded-2xl border p-4">
        <div className="mb-4 flex gap-1">{[["preview", "Borrador"], ["files", "Archivos"], ["tests", "Pruebas"]].map(([value, label]) => <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} onClick={() => setTab(value)}>{label}</Button>)}</div>
        <p className="text-muted-fg mb-4 text-xs">Revisión {detail.draft.revision} · {Object.keys(detail.draft.files).length} archivos · sin publicar</p>
        {detail.baseVersion ? <details className="border-border mb-4 rounded-xl border p-3 text-sm"><summary className="cursor-pointer">{changes.length} archivos modificados respecto a la versión {detail.baseVersion.version}</summary>{changes.map((name) => <details key={name} className="mt-3"><summary className="cursor-pointer font-mono text-xs">{!baseFiles[name] ? "+" : !detail.draft.files[name] ? "−" : "~"} {name}</summary><div className="mt-2 grid gap-2"><pre className="bg-surface-2 max-h-48 overflow-auto rounded p-2 text-xs">Antes: {baseFiles[name] ? decodeFile(baseFiles[name]) ?? "Binario" : "No existía"}</pre><pre className="bg-surface-2 max-h-48 overflow-auto rounded p-2 text-xs">Ahora: {detail.draft.files[name] ? decodeFile(detail.draft.files[name]) ?? "Binario" : "Eliminado"}</pre></div></details>)}</details> : null}
        {tab === "preview" ? preview ? <Markdown>{preview}</Markdown> : <p className="text-muted-fg text-sm">El creador preparará aquí la skill a partir de tu conversación.</p> : null}
        {tab === "files" ? <div className="space-y-3"><label className="flex items-center gap-2 text-sm"><FileText className="size-4" /><select aria-label="Archivo del borrador" disabled={dirty} className="border-border bg-bg max-w-full rounded-lg border p-2" value={path} onChange={(event) => setPath(event.target.value)}>{[...new Set(["SKILL.md", ...Object.keys(detail.draft.files)])].map((name) => <option key={name}>{name}</option>)}</select></label>{encoded && decodeFile(encoded) === null ? <p className="text-muted-fg text-sm">Archivo binario. Se conservará en el paquete.</p> : <><Textarea aria-label="Contenido del archivo" className="min-h-[420px] font-mono text-xs" value={editor} disabled={Boolean(active)} onChange={(event) => { setEditor(event.target.value); setDirty(true); }} /><div className="flex gap-2"><Button disabled={!dirty || busy || Boolean(active)} onClick={() => void save()}>Guardar archivo</Button>{dirty ? <Button variant="ghost" onClick={() => setDirty(false)}>Descartar edición</Button> : null}</div></>}</div> : null}
        {tab === "tests" ? <div className="space-y-5"><form onSubmit={(event) => void test(event)} className="space-y-3"><Textarea aria-label="Entrada de prueba" placeholder="Un ejemplo real de la tarea…" value={testInput} onChange={(event) => setTestInput(event.target.value)} required /><Input aria-label="Texto esperado" placeholder="Texto que debe aparecer (opcional)" value={expected} onChange={(event) => setExpected(event.target.value)} /><select aria-label="Nexbot para la prueba" className="border-border bg-bg w-full rounded-lg border p-2 text-sm" value={botId} onChange={(event) => setBotId(event.target.value)}><option value="">Nexus · instrucciones y referencias</option>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}{bot.environmentEnabled ? ` · ordenador ${bot.status === "running" ? "en marcha" : "detenido"}` : ""}</option>)}</select><p className="text-muted-fg text-xs">Los scripts requieren un Nexbot con ordenador en marcha. La prueba usa sus herramientas y consume tokens de tu cuenta; no publica el borrador.</p><Button disabled={busy || dirty || Boolean(active) || !preview || !testInput.trim()}><Play className="size-4" /> Probar borrador</Button></form>
          {detail.tests.map((result) => <article className="border-border rounded-xl border p-3" key={result.test.id}><div className="flex items-start justify-between gap-2"><p className="font-medium text-sm">{result.test.input}</p><span className="text-muted-fg text-xs">{result.status}</span></div>{result.test.expected ? <p className="text-muted-fg my-2 text-xs">Debe incluir: {result.test.expected}</p> : null}{result.report ? <p className="my-2 text-sm">{REPORT_LABEL[result.report.details] ?? result.report.details}</p> : null}{result.output ? <Markdown>{result.output}</Markdown> : null}{result.error ? <p role="alert" className="text-danger text-sm">{result.error}</p> : null}{result.tools.length ? <details className="text-muted-fg mt-2 text-xs"><summary className="cursor-pointer">Herramientas utilizadas</summary>{result.tools.map((tool) => <p key={tool.id}>{tool.name} · {tool.status}</p>)}</details> : null}{approvals.filter((approval) => approval.runId === result.test.runId).map((approval) => <div key={approval.id} className="bg-surface-2 my-3 rounded-lg p-3"><p className="text-sm">{approval.reason}</p><pre className="my-2 overflow-auto text-xs">{JSON.stringify(approval.args, null, 2)}</pre><div className="flex gap-2"><Button size="sm" onClick={() => void decide(approval.id, "approve")}>Aprobar</Button><Button size="sm" variant="outline" onClick={() => void decide(approval.id, "deny")}>Rechazar</Button></div></div>)}{result.test.runId && ["running", "awaiting_input"].includes(result.status ?? "") ? <Button className="mt-2" size="sm" variant="ghost" onClick={() => void api(`/api/runs/${result.test.runId}/cancel`, {}).then(load)}>Cancelar prueba</Button> : null}</article>)}
        </div> : null}
      </section>
    </div>
  </div></main>;
}

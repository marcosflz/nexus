"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Download, Plus, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/components/ui/markdown";
import type { SkillPackage } from "@/lib/skills/contracts.generated";
import { api, archiveFile, decodeFile } from "./client";

export interface SkillSummary {
  id: string; name: string; description: string; enabledInChat: boolean;
  currentVersionId: string | null; galleryVersionId: string | null; source: Record<string, unknown>;
}
interface GallerySkill { id: string; name: string; description: string; versionId: string }
const PANEL = "border-border bg-surface rounded-2xl border p-5";

export function ImportSkills({ skillId, initialUrl = "", onDone }: { skillId?: string; initialUrl?: string; onDone?: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [packages, setPackages] = useState<SkillPackage[]>([]);
  const [busy, setBusy] = useState(false);
  async function inspect(archive?: string) {
    setBusy(true);
    try { setPackages((await api<{ packages: SkillPackage[] }>("/api/skills/import", archive ? { archive } : { url })).packages); }
    catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  }
  async function install(pack: SkillPackage) {
    setBusy(true);
    try {
      const { draft } = await api<{ draft: { id: string } }>("/api/skills/import", { package: pack, install: true, skillId, source: url ? { url } : { kind: "zip" } });
      onDone?.(); router.push(`/skills/drafts/${draft.id}`);
    } catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  }
  return <section className={PANEL}>
    <h2 className="mb-2 text-lg font-medium">Importar skills</h2>
    <p className="text-muted-fg mb-4 text-sm">Pega una URL pública de GitHub o sube un ZIP. Podrás revisar el paquete antes de publicarlo en tu biblioteca.</p>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void inspect(); }}>
      <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/organizacion/repositorio/tree/main/skill" aria-label="URL de GitHub" />
      <Button disabled={busy || !url} variant="outline">Revisar</Button>
    </form>
    <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm"><Upload className="size-4" /> Subir ZIP
      <input className="ml-2 max-w-64 text-xs" type="file" accept=".zip" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { setUrl(""); void archiveFile(file).then(inspect).catch((error) => toast.error(String(error))); } }} />
    </label>
    {busy ? <p role="status" className="mt-3 text-sm">Procesando paquete…</p> : null}
    <div className="mt-4 grid gap-3">{packages.map((pack) => <article key={pack.digest} className="border-border rounded-xl border p-4">
      <h3 className="font-medium">{pack.manifest.name}</h3><p className="text-muted-fg text-sm">{pack.manifest.description}</p>
      {pack.manifest.license ? <p className="mt-2 text-xs">Licencia: {pack.manifest.license}</p> : null}
      {pack.manifest.compatibility ? <p className="mt-2 text-xs">Requisitos: {pack.manifest.compatibility}</p> : null}
      <details className="my-3 text-sm"><summary className="cursor-pointer">Ver instrucciones y {Object.keys(pack.files).length} archivos</summary><pre className="my-2 overflow-auto text-xs">{Object.keys(pack.files).join("\n")}</pre><Markdown>{pack.instructions}</Markdown></details>
      <Button size="sm" disabled={busy} onClick={() => void install(pack)}>Abrir borrador para revisar</Button>
    </article>)}</div>
  </section>;
}

export function SkillsLibrary() {
  const router = useRouter();
  const [data, setData] = useState<{ skills: SkillSummary[]; gallery: GallerySkill[] }>({ skills: [], gallery: [] });
  const [drafts, setDrafts] = useState<{ id: string; updatedAt: string }[]>([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("mine");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const [library, pending] = await Promise.all([api<typeof data>("/api/skills"), api<{ drafts: typeof drafts }>("/api/skill-drafts")]); setData(library); setDrafts(pending.drafts); }
    catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function create() {
    setBusy(true);
    try { const result = await api<{ draft: { id: string } }>("/api/skill-drafts", {}); router.push(`/skills/drafts/${result.draft.id}`); }
    catch (reason) { toast.error(String(reason)); setBusy(false); }
  }
  const matches = (item: { name: string; description: string }) => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase());
  return <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-6xl space-y-6 p-5 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Skills</h1><p className="text-muted-fg mt-1 text-sm">Procedimientos reutilizables para Nexus y tus Nexbots.</p></div><Button disabled={busy} onClick={() => void create()}><Sparkles className="size-4" /> Crear con ayuda</Button></header>
    <div className="flex flex-wrap items-center gap-2">{[["mine", "Mi biblioteca"], ["gallery", "Galería interna"], ["import", "Importar"], ["drafts", "Borradores"]].map(([id, label]) => <Button key={id} variant={tab === id ? "secondary" : "ghost"} onClick={() => setTab(id)}>{label}</Button>)}<Input className="ml-auto w-full sm:w-64" placeholder="Buscar skills…" aria-label="Buscar skills" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {error ? <p role="alert">{error}</p> : null}{loading ? <p role="status">Cargando biblioteca…</p> : null}
    {tab === "import" ? <ImportSkills /> : null}
    {tab === "drafts" ? <div className="grid gap-3">{drafts.length ? drafts.map((draft) => <Link className={PANEL} href={`/skills/drafts/${draft.id}`} key={draft.id}>Continuar borrador · {new Date(draft.updatedAt).toLocaleString()}</Link>) : <p className="text-muted-fg">Todavía no hay borradores.</p>}</div> : null}
    {tab === "mine" ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{data.skills.filter(matches).map((skill) => <article key={skill.id} className={`${PANEL} flex flex-col gap-3`}>
      <BookOpen className="text-muted-fg size-5" /><Link className="font-medium hover:underline" href={`/skills/${skill.id}`}>{skill.name}</Link><p className="text-muted-fg flex-1 text-sm">{skill.description}</p>
      <label className="flex items-center justify-between text-sm">Disponible en el chat<Switch checked={skill.enabledInChat} onCheckedChange={(enabledInChat) => void api(`/api/skills/${skill.id}`, { enabledInChat }, "PATCH").then(load).catch((reason) => toast.error(String(reason)))} /></label>
      <p className="text-muted-fg text-xs">{skill.galleryVersionId ? "Compartida en la galería" : "Privada"}</p>
    </article>)}{!loading && !data.skills.length ? <div className={`${PANEL} md:col-span-2`}><h2 className="font-medium">Tu primera skill empieza con una conversación</h2><p className="text-muted-fg my-3 text-sm">Describe una tarea que repites. El creador te ayudará a convertirla en una skill y probarla con ejemplos.</p><Button variant="outline" onClick={() => void create()}><Plus className="size-4" /> Crear skill</Button></div> : null}</div> : null}
    {tab === "gallery" ? <div className="grid gap-4 md:grid-cols-2">{data.gallery.filter(matches).map((skill) => <article key={skill.id} className={PANEL}><h2 className="font-medium">{skill.name}</h2><p className="text-muted-fg my-3 text-sm">{skill.description}</p><Button size="sm" variant="outline" onClick={() => void api(`/api/skills/${skill.id}/copy`, {}).then(() => { toast.success("Copia privada añadida a tu biblioteca"); void load(); }).catch((reason) => toast.error(String(reason)))}>Añadir copia a mi biblioteca</Button></article>)}{!data.gallery.length ? <p className="text-muted-fg">Todavía no se han compartido skills.</p> : null}</div> : null}
  </div></main>;
}

export function SkillDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ skill: SkillSummary; versions: { id: string; version: number; package: SkillPackage }[] } | null>(null);
  const [selected, setSelected] = useState("");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { const result = await api<NonNullable<typeof data>>(`/api/skills/${id}`); setData(result); setSelected((old) => old || result.skill.currentVersionId || ""); } catch (reason) { setError(String(reason)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <p className="p-8">{error || "Cargando skill…"}</p>;
  const version = data.versions.find((item) => item.id === selected) ?? data.versions[0];
  return <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl space-y-5 p-5 md:p-8">
    <Link href="/skills" className="text-muted-fg text-sm">← Skills</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">{data.skill.name}</h1><p className="text-muted-fg mt-2">{data.skill.description}</p></div><Button onClick={() => void api<{ draft: { id: string } }>("/api/skill-drafts", { skillId: id }).then(({ draft }) => router.push(`/skills/drafts/${draft.id}`)).catch((reason) => toast.error(String(reason)))}><Sparkles className="size-4" /> Editar con ayuda</Button></header>
    <div className="flex flex-wrap gap-2"><select aria-label="Versión de skill" className="border-border bg-bg rounded-lg border px-3 py-2 text-sm" value={selected} onChange={(event) => setSelected(event.target.value)}>{data.versions.map((item) => <option key={item.id} value={item.id}>Versión {item.version}{item.id === data.skill.currentVersionId ? " · actual" : ""}</option>)}</select>
      <Button asChild variant="outline"><a href={`/api/skills/${id}/export?version=${selected}`}><Download className="size-4" /> Exportar ZIP</a></Button>
      <Button variant="outline" onClick={() => void api(`/api/skills/${id}`, { shared: !data.skill.galleryVersionId }, "PATCH").then(load).catch((reason) => toast.error(String(reason)))}>{data.skill.galleryVersionId ? "Retirar de la galería" : "Compartir versión actual"}</Button>
      <Button variant="ghost" onClick={() => setUpdating(!updating)}>Importar actualización</Button>
      <Button variant="ghost" onClick={() => { if (confirm("¿Retirar esta skill de tu biblioteca? Las ejecuciones conservan su versión.")) void fetch(`/api/skills/${id}`, { method: "DELETE" }).then((response) => { if (!response.ok) throw new Error("No se pudo retirar"); router.push("/skills"); }).catch((reason) => toast.error(String(reason))); }}>Retirar</Button>
    </div>
    {updating ? <ImportSkills skillId={id} initialUrl={typeof data.skill.source.url === "string" ? data.skill.source.url : ""} /> : null}
    {version ? <section className={PANEL}><Markdown>{version.package.instructions}</Markdown><details className="mt-5"><summary className="cursor-pointer text-sm">Archivos del paquete</summary>{Object.entries(version.package.files).map(([path, content]) => <details key={path} className="my-2 text-sm"><summary className="cursor-pointer font-mono">{path}</summary><pre className="bg-surface-2 mt-2 max-h-80 overflow-auto rounded-lg p-3 text-xs">{decodeFile(content) ?? "Archivo binario incluido en la exportación ZIP"}</pre></details>)}</details></section> : null}
    <p className="text-muted-fg text-sm">En el chat puedes invocarla con /{data.skill.name}. Los Nexbots la utilizan cuando se la asignas en su configuración.</p>
  </div></main>;
}

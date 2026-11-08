"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface KnowledgeFile {
  id: string;
  name: string;
  size: number;
  status: "pending" | "indexed" | "error";
  textChars: number;
}

export function KnowledgePanel({
  agentId,
  enabled,
  topK,
  canEdit,
  onChange,
}: {
  agentId: string;
  enabled: boolean;
  topK: number;
  canEdit: boolean;
  onChange: (knowledge: { enabled: boolean; topK: number }) => void;
}) {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/knowledge`);
    if (res.ok) setFiles(((await res.json()) as { files: KnowledgeFile[] }).files);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(list).forEach((file) => form.append("files", file));
      const res = await fetch(`/api/agents/${agentId}/knowledge`, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        results?: { name: string; ok: boolean; error?: string; chunks?: number; duplicate?: boolean }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir");
      for (const result of data.results ?? []) {
        if (!result.ok) toast.error(`${result.name}: ${result.error}`);
        else if (result.duplicate) toast.info(`${result.name} ya estaba indexado`);
        else toast.success(`${result.name}: ${result.chunks} fragmentos indexados`);
      }
      if ((data.results ?? []).some((r) => r.ok) && !enabled) onChange({ enabled: true, topK });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(file: KnowledgeFile) {
    const res = await fetch(`/api/agents/${agentId}/knowledge?fileId=${file.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("No se pudo eliminar");
    setFiles((prev) => prev.filter((item) => item.id !== file.id));
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-4 border-border bg-surface rounded-xl border p-3 text-sm">
        <span>
          Usar este conocimiento
          <span className="text-muted-foreground block text-xs">
            El agente busca en estos documentos y cita el fragmento que usa. Recuerda guardar la versión tras activarlo.
          </span>
        </span>
        <Switch checked={enabled} disabled={!canEdit} onCheckedChange={(on) => onChange({ enabled: on, topK })} />
      </label>
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="topk">Fragmentos por consulta</Label>
        <Input
          id="topk"
          type="number"
          min={1}
          max={12}
          value={topK}
          disabled={!canEdit}
          onChange={(e) => onChange({ enabled, topK: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })}
        />
      </div>

      {canEdit ? (
        <div>
          <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log" onChange={(e) => upload(e.target.files)} />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Subir documentos
          </Button>
          <p className="text-muted-foreground mt-1.5 text-xs">PDF (con texto), DOCX, TXT, MD, CSV o JSON. Hasta 10 MB cada uno y 50 por agente.</p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.id} className="flex items-center gap-3 border-border bg-surface rounded-xl border p-3 text-sm">
            <FileText className="text-muted-foreground size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs">{Math.round(file.textChars / 1000)}k caracteres</span>
            {canEdit ? (
              <Button variant="ghost" size="icon-sm" aria-label={`Eliminar ${file.name}`} onClick={() => remove(file)}>
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
        {files.length === 0 ? <li className="text-muted-foreground text-sm">Todavía no hay documentos.</li> : null}
      </ul>
    </div>
  );
}

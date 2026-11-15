"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Link2Off, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Crea, copia o retira el enlace público de solo lectura de un hilo. */
export function ShareButton({ threadId }: { threadId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(null);
    let alive = true;
    fetch(`/api/threads/${threadId}/share`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { share: { url: string } | null } | null) => alive && setUrl(data?.share?.url ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [threadId]);

  /** Sin APP_URL el servidor devuelve una ruta relativa: se completa con el origen actual. */
  const absolute = (value: string) => (value.startsWith("/") ? `${window.location.origin}${value}` : value);

  async function create() {
    setBusy(true);
    const res = await fetch(`/api/threads/${threadId}/share`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { share?: { url: string }; error?: string };
    setBusy(false);
    if (!res.ok || !data.share) return toast.error(data.error ?? "No se pudo crear el enlace");
    setUrl(data.share.url);
  }

  async function revoke() {
    setBusy(true);
    const res = await fetch(`/api/threads/${threadId}/share`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error("No se pudo retirar el enlace");
    setUrl(null);
    toast.success("El enlace ya no funciona");
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(absolute(url));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-full px-3">
          <Share2 className="size-4" />
          Compartir
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        {url ? (
          <>
            <p className="text-muted-foreground">
              Cualquiera con este enlace puede leer la conversación (texto y fuentes). No incluye tus adjuntos ni los
              datos internos de las herramientas.
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 text-xs">{absolute(url)}</code>
              <Button size="icon-sm" variant="outline" onClick={copy} aria-label="Copiar enlace">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={revoke} disabled={busy}>
              <Link2Off className="size-4" /> Dejar de compartir
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Crea un enlace público de solo lectura a esta conversación. Puedes retirarlo cuando quieras.
            </p>
            <Button size="sm" className="w-full" onClick={create} disabled={busy}>
              <Link2 className="size-4" /> Crear enlace
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

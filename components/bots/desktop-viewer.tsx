"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const RETRY_MS = 3000;

/**
 * Pantalla del bot en directo. Es solo de lectura: una imagen que se actualiza, sin
 * ningún canal para enviar clics o teclas. Se corta cuando la pestaña no está a la
 * vista, para no consumir ancho de banda sin nadie mirando.
 */
export function DesktopViewer({ botId, running, available, error, idle = false }: {
  botId: string;
  running: boolean;
  available: boolean;
  error: string | null;
  /** El bot aún no ha abierto nada: la pantalla es un fondo negro y conviene decirlo. */
  idle?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [fps, setFps] = useState("2");
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // El servidor corta cada emisión a los 30 min para volver a comprobar el permiso.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((value) => value + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  const streaming = running && available && !paused && !hidden;

  let message: string | null = null;
  if (!running) message = "El bot está detenido.";
  else if (!available) message = error ? `Escritorio no disponible: ${error}` : "Este bot no tiene escritorio.";
  else if (paused) message = "Vista en pausa.";

  return (
    <section className="border-border overflow-hidden rounded-xl border">
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-2 text-[13px]">
          <span className={`size-2 rounded-full ${streaming && live ? "bg-success" : "bg-surface-3"}`} />
          {streaming && live ? "En directo" : "Sin emisión"}
        </span>
        <span className="text-muted-fg text-[12px]">Solo lectura</span>
        <div className="ml-auto flex items-center gap-1">
          <Select value={fps} onValueChange={setFps}>
            <SelectTrigger className="h-8 w-24 rounded-lg text-[13px]" aria-label="Fotogramas por segundo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 fps</SelectItem>
              <SelectItem value="2">2 fps</SelectItem>
              <SelectItem value="5">5 fps</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={paused ? "Reanudar la vista" : "Pausar la vista"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Reconectar" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Pantalla completa"
            onClick={() => void frameRef.current?.requestFullscreen()}
          >
            <Maximize2 />
          </Button>
        </div>
      </div>
      <div ref={frameRef} className="bg-surface-2 relative aspect-[16/10] w-full">
        {streaming && !failed ? (
          // MJPEG: `next/image` no sirve para una emisión continua.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${fps}-${attempt}`}
            src={`/api/bots/${botId}/desktop?fps=${fps}`}
            alt="Escritorio del bot en directo"
            className="size-full object-contain"
            onLoad={() => setLive(true)}
            onError={() => {
              setLive(false);
              setFailed(true);
            }}
          />
        ) : null}
        {message ? (
          <p className="text-muted-fg absolute inset-0 flex items-center justify-center px-6 text-center text-sm">{message}</p>
        ) : failed ? (
          <p className="text-muted-fg absolute inset-0 flex items-center justify-center text-sm">Reconectando…</p>
        ) : idle ? (
          <p role="status" className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-sm text-white">
            El escritorio está vacío: el navegador se abrirá cuando el bot empiece una tarea.
          </p>
        ) : null}
      </div>
    </section>
  );
}

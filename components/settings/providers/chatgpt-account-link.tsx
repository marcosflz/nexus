"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const BASE = "/api/settings/chatgpt";

async function call(path: string, body?: object, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

const errorOf = (data: Record<string, unknown>, fallback: string) =>
  typeof data.error === "string" ? data.error : fallback;

/**
 * Vinculación del plan de ChatGPT de ESTE usuario con «Sign in with ChatGPT». La redirección de
 * OpenAI va a 127.0.0.1 (el equipo del navegador), así que la persona copia esa dirección y la pega.
 */
export function ChatGptAccountLink({
  linked,
  account,
  reason,
  onChange,
}: {
  linked: boolean;
  account: string | null;
  reason: string | null;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [redirect, setRedirect] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  async function start() {
    setStarting(true);
    setError(null);
    setRedirect("");
    setLoginId(null);
    setUrl(null);
    const { ok, data } = await call("/login/start");
    setStarting(false);
    if (!ok || typeof data.url !== "string" || typeof data.loginId !== "string") {
      setError(errorOf(data, "No se pudo iniciar sesión con ChatGPT"));
      return;
    }
    setLoginId(data.loginId);
    setUrl(data.url);
  }

  function openDialog() {
    setRedirect("");
    setLoginId(null);
    setUrl(null);
    setError(null);
    setOpen(true);
    void start();
  }

  function close(next: boolean) {
    if (next) return;
    if (loginId) void call("/login/cancel", { loginId });
    setOpen(false);
    setLoginId(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    setSending(true);
    setError(null);
    const { ok, data } = await call("/login/finish", { loginId, redirectUrl: redirect.trim() });
    setSending(false);
    if (!ok) {
      setError(errorOf(data, "No se pudo vincular la cuenta"));
      // El inicio de sesión es de un solo uso: hay que empezar otro.
      setLoginId(null);
      setUrl(null);
      return;
    }
    setLoginId(null);
    setOpen(false);
    toast.success("Cuenta de ChatGPT vinculada");
    onChange();
  }

  async function test() {
    setTesting(true);
    const { data } = await call("/test");
    setTesting(false);
    if (data.ok) toast.success("ChatGPT ha respondido correctamente con tu plan");
    else toast.error(errorOf(data, "La prueba ha fallado"));
  }

  async function unlink() {
    const { ok, data } = await call("/account", undefined, "DELETE");
    if (!ok) {
      toast.error(errorOf(data, "No se pudo desvincular"));
      return;
    }
    toast.success("Cuenta desvinculada");
    onChange();
  }

  const looksRight = redirect.trim().startsWith("http://127.0.0.1:1455/");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-fg text-[13px]">
        {linked
          ? `Vinculada${account ? ` como ${account}` : ""}. Solo la usan tus agentes; no se comparte con nadie.`
          : (reason ?? "Vincula tu cuenta de ChatGPT para usar tu plan con tus agentes.")}
      </p>
      <div className="flex flex-wrap gap-2">
        {linked ? (
          <>
            <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={testing} onClick={() => void test()}>
              {testing ? "Probando…" : "Probar"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={openDialog}>
              Volver a vincular
            </Button>
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setConfirmUnlink(true)}>
              Desvincular
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" className="rounded-full" onClick={openDialog}>
            Vincular cuenta de ChatGPT
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Vincular tu cuenta de ChatGPT</DialogTitle>
              <DialogDescription>
                Usa «Sign in with ChatGPT», la vía oficial de OpenAI. El uso cuenta para tu plan y puedes
                limitarlo o desconectar Nexus en ChatGPT → Ajustes → Uso. No se comparte con otros usuarios.
              </DialogDescription>
            </DialogHeader>
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-[14px]">
              <li>
                <p>Abre ChatGPT, inicia sesión y autoriza a Nexus a usar tu plan.</p>
                {url ? (
                  <Button asChild variant="outline" size="sm" className="mt-2 rounded-full">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      Abrir ChatGPT <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full" disabled={starting} onClick={() => void start()}>
                    {starting ? "Preparando…" : "Empezar de nuevo"}
                  </Button>
                )}
              </li>
              <li>
                <label htmlFor="chatgpt-redirect">
                  Al terminar, el navegador irá a una página que no carga (empieza por{" "}
                  <code className="text-[12px]">http://127.0.0.1:1455/</code>). Es normal: copia su dirección
                  completa de la barra del navegador y pégala aquí:
                </label>
                <Input
                  id="chatgpt-redirect"
                  autoComplete="off"
                  spellCheck={false}
                  value={redirect}
                  onChange={(event) => setRedirect(event.target.value)}
                  placeholder="http://127.0.0.1:1455/auth/callback?code=…"
                  className="mt-2 h-10 rounded-lg"
                  disabled={!url}
                />
                {redirect.trim() && !looksRight ? (
                  <p className="text-warning mt-1 text-[12px]">Debe empezar por http://127.0.0.1:1455/</p>
                ) : null}
              </li>
            </ol>
            {error ? (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" className="rounded-full px-5" disabled={sending || !url || !looksRight}>
                {sending ? "Vinculando…" : "Vincular"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desvincular tu cuenta de ChatGPT?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran las credenciales guardadas y tus agentes dejarán de usar tu plan. Para quitar el acceso
              también en OpenAI, desconecta Nexus en ChatGPT → Ajustes → Uso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void unlink()}>
              Desvincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

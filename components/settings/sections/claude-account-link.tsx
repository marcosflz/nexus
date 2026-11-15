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

export interface ClaudeAccountState {
  linked: boolean;
  ready: boolean;
  reason: string | null;
}

const BASE = "/api/settings/claude-code";

async function post(path: string, body?: object, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

/**
 * Estado y acciones de la cuenta de Anthropic vinculada por ESTE usuario: vincular (con el
 * `claude setup-token` oficial que corre en el servidor), pegar un token, probar y desvincular.
 */
export function ClaudeAccountLink({
  account,
  unavailable,
  onChange,
}: {
  account: ClaudeAccountState | null;
  /** Problema de la instancia: no se puede vincular ni usar. */
  unavailable: string | null;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"web" | "token">("web");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  async function start() {
    setStarting(true);
    setDialogError(null);
    const { ok, data } = await post("/login/start");
    setStarting(false);
    if (!ok || typeof data.url !== "string" || typeof data.loginId !== "string") {
      setDialogError(errorOf(data, "No se pudo iniciar la vinculación"));
      return;
    }
    setLoginId(data.loginId);
    setUrl(data.url);
  }

  function openDialog() {
    setMode("web");
    setCode("");
    setToken("");
    setLoginId(null);
    setUrl(null);
    setDialogError(null);
    setOpen(true);
    void start();
  }

  function close(next: boolean) {
    if (next) return;
    if (loginId) void post("/login/cancel", { loginId });
    setOpen(false);
    setLoginId(null);
    setUrl(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // El diálogo va en un portal, pero en React el submit sube al formulario de Ajustes.
    event.stopPropagation();
    setSending(true);
    setDialogError(null);
    const result =
      mode === "web"
        ? await post("/login/finish", { loginId, code: code.trim() })
        : await post("/token", { token: token.trim() }, "PUT");
    setSending(false);
    if (!result.ok) {
      setDialogError(errorOf(result.data, "No se pudo vincular la cuenta"));
      // Un código rechazado gasta la sesión: hay que empezar otra.
      if (mode === "web") {
        setLoginId(null);
        setUrl(null);
        setCode("");
      }
      return;
    }
    setLoginId(null);
    setOpen(false);
    toast.success("Cuenta de Anthropic vinculada");
    onChange();
  }

  async function test() {
    setTesting(true);
    const { data } = await post("/test");
    setTesting(false);
    if (data.ok) toast.success("Claude Code ha respondido correctamente con tu cuenta");
    else toast.error(errorOf(data, "La prueba ha fallado"));
  }

  async function unlink() {
    const { ok, data } = await post("/token", undefined, "DELETE");
    if (!ok) {
      toast.error(errorOf(data, "No se pudo desvincular"));
      return;
    }
    toast.success("Cuenta desvinculada");
    onChange();
  }

  const linked = account?.linked ?? false;
  let label = "Sin vincular";
  let tone = "text-warning";
  if (unavailable) label = "No disponible";
  else if (linked && account?.ready) {
    label = "Vinculada";
    tone = "text-success";
  } else if (linked) label = "Revisar";

  const description = unavailable
    ? unavailable
    : linked && account?.ready
      ? "Tus agentes usan tu propia suscripción de Anthropic. No se comparte con otros usuarios."
      : (account?.reason ?? "Vincula tu cuenta de Anthropic para usar tu suscripción con tus agentes.");

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <span className={`${tone} text-[14px]`}>{label}</span>
      <p className="text-muted-foreground max-w-80 text-[13px] sm:text-right">{description}</p>
      {unavailable ? null : (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {linked ? (
            <>
              <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setConfirmUnlink(true)}>
                Desvincular
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={testing || !account?.ready}
                onClick={() => void test()}
              >
                {testing ? "Probando…" : "Probar"}
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={openDialog}>
                Volver a vincular
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" className="rounded-full" onClick={openDialog}>
              Vincular cuenta de Anthropic
            </Button>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Vincular tu cuenta de Anthropic</DialogTitle>
              <DialogDescription>
                Se usa solo para tus agentes y se guarda cifrada en tu cuenta. Cada persona vincula la suya: la
                suscripción no se comparte con otros usuarios.
              </DialogDescription>
            </DialogHeader>

            {mode === "web" ? (
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-[14px]">
                <li>
                  <p>Abre Anthropic, inicia sesión con tu suscripción de Claude y autoriza el acceso.</p>
                  {url ? (
                    <Button asChild variant="outline" size="sm" className="mt-2 rounded-full">
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        Abrir Anthropic <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full" disabled={starting} onClick={() => void start()}>
                      {starting ? "Preparando…" : "Empezar de nuevo"}
                    </Button>
                  )}
                </li>
                <li>
                  <label htmlFor="claude-code-auth-code">Copia el código que te muestra Anthropic y pégalo aquí:</label>
                  <Input
                    id="claude-code-auth-code"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="Código de autorización"
                    className="mt-2 h-10 rounded-lg"
                    disabled={!url}
                  />
                </li>
              </ol>
            ) : (
              <div className="flex flex-col gap-2 text-[14px]">
                <label htmlFor="claude-code-token">
                  En tu equipo, ejecuta <code>claude setup-token</code> y pega aquí el token que genera:
                </label>
                <Input
                  id="claude-code-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="sk-ant-oat01-…"
                  className="h-10 rounded-lg"
                />
              </div>
            )}

            {dialogError ? (
              <p role="alert" className="text-danger text-sm">
                {dialogError}
              </p>
            ) : null}

            <DialogFooter className="items-center gap-2 sm:justify-between">
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto p-0"
                onClick={() => {
                  setDialogError(null);
                  if (mode === "web") {
                    if (loginId) void post("/login/cancel", { loginId });
                    setLoginId(null);
                    setUrl(null);
                    setMode("token");
                  } else {
                    setMode("web");
                    void start();
                  }
                }}
              >
                {mode === "web" ? "Prefiero pegar un token" : "Vincular desde el navegador"}
              </Button>
              <Button
                type="submit"
                className="rounded-full px-5"
                disabled={sending || (mode === "web" ? !url || !code.trim() : !token.trim())}
              >
                {sending ? "Vinculando…" : "Vincular"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desvincular tu cuenta de Anthropic?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra el token guardado y tus agentes dejarán de usar Claude Code hasta que la vuelvas a vincular.
              Para revocarlo también en Anthropic, hazlo desde la configuración de tu cuenta de Claude.
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

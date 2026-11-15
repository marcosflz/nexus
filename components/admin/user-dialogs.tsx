"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { UserRole } from "@/lib/access";
import type { ManagedUser } from "@/lib/users";
import { cn } from "@/lib/utils";

export const ROLE_LABEL: Record<UserRole, string> = { superadmin: "Superadmin", admin: "Admin", user: "Usuario" };
export const TOKENS = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
export const DATE = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });
export const DATE_TIME = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });

export async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export function TokenBar({ used, limit }: { used: number; limit: number }) {
  const percent = limit === 0 ? 100 : Math.min((used / limit) * 100, 100);
  return (
    <div className="bg-surface-3 h-1.5 w-full max-w-60 overflow-hidden rounded-full">
      <div
        className={cn("h-full rounded-full", percent >= 100 ? "bg-danger" : percent >= 80 ? "bg-warning" : "bg-brand")}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** La contraseña generada solo se puede ver aquí: el servidor no la guarda en claro. */
export function PasswordDialog({
  credentials,
  onClose,
}: {
  credentials: { email: string; password: string } | null;
  onClose: () => void;
}) {
  // navigator.clipboard no existe en HTTP sin contexto seguro.
  const canCopy = typeof navigator !== "undefined" && Boolean(navigator.clipboard);
  return (
    <Dialog open={credentials !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contraseña generada</DialogTitle>
          <DialogDescription>
            Pásasela a {credentials?.email}. No se volverá a mostrar; podrá cambiarla en Ajustes → Cuenta.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            aria-label="Contraseña generada"
            value={credentials?.password ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono"
          />
          {canCopy ? (
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar contraseña"
              onClick={() => {
                void navigator.clipboard.writeText(credentials?.password ?? "").then(() => toast.success("Copiada"));
              }}
            >
              <Copy className="size-4" />
            </Button>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Hecho</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewUserDialog({
  open,
  actorRole,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  actorRole: UserRole;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: ManagedUser, generatedPassword: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [claudeCode, setClaudeCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, ...(password ? { password } : {}), role, canUseClaudeCode: claudeCode }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await errorOf(res, "No se pudo crear el usuario"));
      return;
    }
    const data = (await res.json()) as { user: ManagedUser; generatedPassword: string | null };
    setEmail("");
    setPassword("");
    setRole("user");
    setClaudeCode(false);
    onCreated(data.user, data.generatedPassword);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
            <DialogDescription>Si dejas la contraseña vacía, se genera una al crear la cuenta.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Contraseña (opcional)</Label>
            <Input
              id="new-user-password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {actorRole === "superadmin" ? (
            <div className="grid gap-2">
              <Label htmlFor="new-user-role">Rol</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger id="new-user-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABEL) as UserRole[]).map((item) => (
                    <SelectItem key={item} value={item}>
                      {ROLE_LABEL[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <label className="flex items-center justify-between gap-4 text-sm">
            Puede vincular sus suscripciones (Claude, ChatGPT)
            <Switch checked={claudeCode} onCheckedChange={setClaudeCode} />
          </label>
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear usuario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, MoreHorizontal, UserPlus } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Initial } from "@/components/shell/initial";
import { SettingsGroup, SettingsSectionTitle } from "../rows";

interface ManagedUser {
  id: string;
  email: string;
  role: "admin" | "user";
  disabled: boolean;
  canUseClaudeCode: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserChange {
  role?: "admin" | "user";
  disabled?: boolean;
  canUseClaudeCode?: boolean;
  resetPassword?: true;
}

const DATE = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });

async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

/** La contraseña generada solo se puede ver aquí: el servidor no la guarda en claro. */
function PasswordDialog({
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

function NewUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: ManagedUser, generatedPassword: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
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
      body: JSON.stringify({
        email,
        ...(password ? { password } : {}),
        role: admin ? "admin" : "user",
        canUseClaudeCode: claudeCode,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await errorOf(res, "No se pudo crear el usuario"));
      return;
    }
    const data = (await res.json()) as { user: ManagedUser; generatedPassword: string | null };
    setEmail("");
    setPassword("");
    setAdmin(false);
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
          <label className="flex items-center justify-between gap-4 text-sm">
            Administrador
            <Switch checked={admin} onCheckedChange={setAdmin} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            Puede usar Claude Code (suscripción de la instancia)
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

function UserRow({
  user,
  isSelf,
  onChange,
  onDelete,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onChange: (change: UserChange) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Initial email={user.email} className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[15px] font-medium">{user.email}</span>
          {isSelf ? <span className="text-muted-fg text-[13px]">(tú)</span> : null}
          {user.role === "admin" ? <Badge className="rounded-full">Admin</Badge> : null}
          {user.disabled ? (
            <Badge variant="destructive" className="rounded-full">
              Desactivada
            </Badge>
          ) : null}
          {user.canUseClaudeCode && user.role !== "admin" ? (
            <Badge variant="outline" className="rounded-full">
              Claude Code
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-fg mt-0.5 text-[13px]">
          Alta: {DATE.format(new Date(user.createdAt))} · Último acceso:{" "}
          {user.lastLoginAt ? DATE.format(new Date(user.lastLoginAt)) : "nunca"}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`Acciones de ${user.email}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 rounded-xl">
          {!isSelf ? (
            <DropdownMenuItem onSelect={() => onChange({ role: user.role === "admin" ? "user" : "admin" })}>
              {user.role === "admin" ? "Quitar administrador" : "Hacer administrador"}
            </DropdownMenuItem>
          ) : null}
          {user.role !== "admin" ? (
            <DropdownMenuItem onSelect={() => onChange({ canUseClaudeCode: !user.canUseClaudeCode })}>
              {user.canUseClaudeCode ? "Retirar Claude Code" : "Permitir Claude Code"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onChange({ resetPassword: true })}>
            Restablecer contraseña
          </DropdownMenuItem>
          {!isSelf ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onChange({ disabled: !user.disabled })}>
                {user.disabled ? "Reactivar cuenta" : "Desactivar cuenta"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                Borrar cuenta
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Gestor de usuarios. Solo se monta para admins, y la API lo vuelve a comprobar. */
export function UsersSection() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<ManagedUser | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      setLoadError(await errorOf(res, "No se pudieron cargar los usuarios"));
      return;
    }
    const data = (await res.json()) as { users: ManagedUser[]; currentUserId: string };
    setUsers(data.users);
    setCurrentUserId(data.currentUserId);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(user: ManagedUser, patch: UserChange) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo guardar el cambio"));
      return;
    }
    const data = (await res.json()) as { user: ManagedUser; generatedPassword: string | null };
    setUsers((prev) => prev?.map((item) => (item.id === data.user.id ? data.user : item)) ?? prev);
    if (data.generatedPassword) setCredentials({ email: data.user.email, password: data.generatedPassword });
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    const res = await fetch(`/api/admin/users/${target.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo borrar la cuenta"));
      return;
    }
    setUsers((prev) => prev?.filter((item) => item.id !== target.id) ?? prev);
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <SettingsSectionTitle>Usuarios</SettingsSectionTitle>
        <Button className="rounded-full" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> Nuevo usuario
        </Button>
      </div>
      {loadError ? (
        <p role="alert" className="text-danger text-sm">
          {loadError}
        </p>
      ) : users === null ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : (
        <SettingsGroup>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
              onChange={(patch) => void change(user, patch)}
              onDelete={() => setToDelete(user)}
            />
          ))}
        </SettingsGroup>
      )}

      <NewUserDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(user, generatedPassword) => {
          setCreating(false);
          setUsers((prev) => (prev ? [...prev, user] : prev));
          if (generatedPassword) setCredentials({ email: user.email, password: generatedPassword });
          else toast.success("Usuario creado");
        }}
      />
      <PasswordDialog credentials={credentials} onClose={() => setCredentials(null)} />
      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {toDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrarán sus hilos, agentes y claves. No se puede deshacer. Si solo quieres cortarle el acceso,
              desactiva la cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Borrar cuenta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

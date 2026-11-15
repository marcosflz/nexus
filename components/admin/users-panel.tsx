"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Page } from "@/components/shell/page";
import { Initial } from "@/components/shell/initial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserRole } from "@/lib/access";
import type { ManagedUser } from "@/lib/users";
import { DATE, errorOf, NewUserDialog, PasswordDialog, ROLE_LABEL, TOKENS, TokenBar } from "./user-dialogs";

type StatusFilter = "all" | "active" | "disabled" | "never";
type SortKey = "recent" | "tokens" | "email" | "created";

function lastActivity(user: ManagedUser): number {
  return new Date(user.lastSeenAt ?? user.lastLoginAt ?? 0).getTime();
}

const SORTERS: Record<SortKey, (a: ManagedUser, b: ManagedUser) => number> = {
  recent: (a, b) => lastActivity(b) - lastActivity(a),
  tokens: (a, b) => b.tokensThisMonth - a.tokensThisMonth,
  email: (a, b) => a.email.localeCompare(b.email),
  created: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
};

/** Si `actor` puede gestionar esa cuenta. Coincide con `manageError`, que es quien decide. */
function canManage(user: ManagedUser, actorId: string | null, actorRole: UserRole): boolean {
  return user.id !== actorId && (actorRole === "superadmin" || user.role === "user");
}

/** Panel de usuarios. Solo se monta para admins, y la API lo vuelve a comprobar. */
export function UsersPanel() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [actorRole, setActorRole] = useState<UserRole>("admin");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | UserRole>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      setLoadError(await errorOf(res, "No se pudieron cargar los usuarios"));
      return;
    }
    const data = (await res.json()) as { users: ManagedUser[]; currentUserId: string; actorRole: UserRole };
    setUsers(data.users);
    setActorId(data.currentUserId);
    setActorRole(data.actorRole);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde la API
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users ?? [])
      .filter((user) => !needle || user.email.toLowerCase().includes(needle))
      .filter((user) => role === "all" || user.role === role)
      .filter((user) => {
        if (status === "active") return !user.disabled;
        if (status === "disabled") return user.disabled;
        if (status === "never") return user.lastLoginAt === null;
        return true;
      })
      .sort(SORTERS[sort]);
  }, [users, query, role, status, sort]);

  const manageable = visible.filter((user) => canManage(user, actorId, actorRole));
  const allSelected = manageable.length > 0 && manageable.every((user) => selected.has(user.id));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function bulk(action: "disable" | "enable" | "revoke_sessions") {
    setBusy(true);
    const res = await fetch("/api/admin/users/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], action }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo aplicar la acción"));
      return;
    }
    const { failed } = (await res.json()) as { failed: { id: string; error: string }[] };
    if (failed.length > 0) toast.error(`${failed.length} cuentas no se han podido cambiar: ${failed[0].error}`);
    else toast.success("Hecho");
    setSelected(new Set());
    await load();
  }

  const total = users?.length ?? 0;
  const disabled = users?.filter((user) => user.disabled).length ?? 0;
  const tokens = users?.reduce((sum, user) => sum + user.tokensThisMonth, 0) ?? 0;

  return (
    <Page
      title="Usuarios"
      width="wide"
      description={
        users
          ? `${total} cuentas · ${total - disabled} activas · ${disabled} desactivadas · ${TOKENS.format(tokens)} tokens este mes`
          : undefined
      }
      actions={
        <Button className="rounded-full" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> Nuevo usuario
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-fg pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por email"
            aria-label="Buscar por email"
            className="h-10 rounded-lg pl-9"
          />
        </div>
        <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
          <SelectTrigger className="h-10 w-36 rounded-lg" aria-label="Filtrar por rol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los roles</SelectItem>
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((item) => (
              <SelectItem key={item} value={item}>
                {ROLE_LABEL[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          <SelectTrigger className="h-10 w-40 rounded-lg" aria-label="Filtrar por estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier estado</SelectItem>
            <SelectItem value="active">Activas</SelectItem>
            <SelectItem value="disabled">Desactivadas</SelectItem>
            <SelectItem value="never">Sin primer acceso</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
          <SelectTrigger className="h-10 w-44 rounded-lg" aria-label="Ordenar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Última actividad</SelectItem>
            <SelectItem value="tokens">Más consumo</SelectItem>
            <SelectItem value="created">Más recientes</SelectItem>
            <SelectItem value="email">Email</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 ? (
        <div className="border-border bg-surface-2 mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2">
          <span className="mr-auto text-sm">{selected.size} seleccionadas</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bulk("revoke_sessions")}>
            Cerrar sesiones
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bulk("enable")}>
            Reactivar
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bulk("disable")}>
            Desactivar
          </Button>
        </div>
      ) : null}

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
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-muted-fg border-border border-b text-[13px]">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <Checkbox
                    aria-label="Seleccionar todas"
                    checked={allSelected}
                    onCheckedChange={(on) => setSelected(on ? new Set(manageable.map((user) => user.id)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2.5 font-normal">Cuenta</th>
                <th className="px-2 py-2.5 font-normal">Estado</th>
                <th className="px-2 py-2.5 font-normal">Tokens este mes</th>
                <th className="px-2 py-2.5 font-normal">Última actividad</th>
                <th className="px-2 py-2.5 font-normal">Sesiones</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {visible.map((user) => {
                const limit = user.access.monthlyTokenLimit;
                const seen = lastActivity(user);
                return (
                  <tr key={user.id} className="hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <Checkbox
                        aria-label={`Seleccionar ${user.email}`}
                        disabled={!canManage(user, actorId, actorRole)}
                        checked={selected.has(user.id)}
                        onCheckedChange={(on) => toggle(user.id, on === true)}
                      />
                    </td>
                    <td className="px-2 py-3">
                      <Link href={`/admin/users/${user.id}`} className="flex items-center gap-3 hover:underline">
                        <Initial email={user.email} className="size-8 shrink-0" />
                        <span className="min-w-0 truncate">{user.email}</span>
                        {user.id === actorId ? <span className="text-muted-fg text-[13px]">(tú)</span> : null}
                      </Link>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.role !== "user" ? <Badge className="rounded-full">{ROLE_LABEL[user.role]}</Badge> : null}
                        {user.disabled ? (
                          <Badge variant="destructive" className="rounded-full">
                            Desactivada
                          </Badge>
                        ) : (
                          <span className="text-muted-fg text-[13px]">Activa</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {TOKENS.format(user.tokensThisMonth)}
                      {limit !== null && user.role !== "superadmin" ? ` / ${TOKENS.format(limit)}` : ""}
                      {limit !== null && user.role !== "superadmin" ? (
                        <div className="mt-1">
                          <TokenBar used={user.tokensThisMonth} limit={limit} />
                        </div>
                      ) : null}
                    </td>
                    <td className="text-muted-fg px-2 py-3">{seen ? DATE.format(new Date(seen)) : "Nunca"}</td>
                    <td className="text-muted-fg px-2 py-3">{user.activeSessions}</td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-fg px-4 py-8 text-center">
                    Ninguna cuenta coincide con el filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <NewUserDialog
        open={creating}
        actorRole={actorRole}
        onOpenChange={setCreating}
        onCreated={(user, generatedPassword) => {
          setCreating(false);
          setUsers((prev) => (prev ? [...prev, user] : prev));
          if (generatedPassword) setCredentials({ email: user.email, password: generatedPassword });
          else toast.success("Usuario creado");
        }}
      />
      <PasswordDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </Page>
  );
}

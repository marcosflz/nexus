"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/shell/page";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup, SettingsRow } from "@/components/settings/rows";
import { PERMISSIONS, type UserAccess, type UserRole } from "@/lib/access";
import { PROVIDERS } from "@/lib/providers";
import type { AdminAuditEntry, ManagedUser, UserDetail } from "@/lib/users";
import { DATE, DATE_TIME, errorOf, PasswordDialog, ROLE_LABEL, TOKENS, TokenBar } from "./user-dialogs";

type Loaded = UserDetail & { currentUserId: string; actorRole: UserRole };

interface UserChange {
  role?: UserRole;
  disabled?: boolean;
  disabledReason?: string | null;
  adminNote?: string | null;
  email?: string;
  canUseClaudeCode?: boolean;
  access?: UserAccess;
  resetPassword?: true;
}

const STATUS_LABEL: Record<string, string> = {
  completed: "Completado",
  running: "En curso",
  error: "Error",
  interrupted: "Interrumpido",
  awaiting_input: "Esperando",
};

function describeAudit(entry: AdminAuditEntry): string {
  const { action, detail } = entry;
  if (action === "user.create") return "Creó la cuenta";
  if (action === "user.delete") return "Borró la cuenta";
  if (action === "user.sessions_revoked") return detail.all ? "Cerró todas las sesiones" : "Cerró una sesión";
  if (action === "search.update") return "Cambió los motores de búsqueda";
  if (action !== "user.update") return action;

  const parts: string[] = [];
  const role = detail.role as { to: UserRole } | undefined;
  const email = detail.email as { to: string } | undefined;
  if (role) parts.push(`rol: ${ROLE_LABEL[role.to]}`);
  if (email) parts.push(`email: ${email.to}`);
  if (detail.disabled === true) parts.push(detail.reason ? `desactivó (${String(detail.reason)})` : "desactivó");
  if (detail.disabled === false) parts.push("reactivó");
  if (detail.claudeCode !== undefined) parts.push(detail.claudeCode ? "concedió las suscripciones" : "retiró las suscripciones");
  if (detail.access) parts.push("permisos, modelos o cupo");
  if (detail.note) parts.push("nota interna");
  if (detail.password) parts.push("restableció la contraseña");
  return parts.join(" · ") || "Sin cambios";
}

function AccessPanel({
  user,
  locked,
  onSave,
}: {
  user: ManagedUser;
  locked: boolean;
  onSave: (patch: UserChange) => Promise<boolean>;
}) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PERMISSIONS.map(({ id }) => [id, user.access.permissions[id] !== false])),
  );
  const [claudeCode, setClaudeCode] = useState(user.canUseClaudeCode);
  const [restricted, setRestricted] = useState(user.access.modelAccess !== null);
  const [rules, setRules] = useState(() =>
    Object.fromEntries(
      PROVIDERS.map(({ id }) => {
        const rule = user.access.modelAccess?.[id];
        return [id, { enabled: rule !== undefined, models: Array.isArray(rule) ? rule.join(", ") : "" }];
      }),
    ),
  );
  const [limit, setLimit] = useState(user.access.monthlyTokenLimit?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const usedLimit = limit.trim() === "" ? null : Number(limit);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const denied = PERMISSIONS.filter(({ id }) => !permissions[id]).map(({ id }) => [id, false]);
    const modelAccess = restricted
      ? Object.fromEntries(
          Object.entries(rules)
            .filter(([, rule]) => rule.enabled)
            .map(([id, rule]) => {
              const models = rule.models.split(/[\s,]+/).filter(Boolean);
              return [id, models.length > 0 ? models : "*"];
            }),
        )
      : null;
    const saved = await onSave({
      canUseClaudeCode: claudeCode,
      access: {
        permissions: Object.fromEntries(denied) as UserAccess["permissions"],
        modelAccess: modelAccess as UserAccess["modelAccess"],
        monthlyTokenLimit: usedLimit,
      },
    });
    setBusy(false);
    if (saved) toast.success("Guardado");
  }

  if (user.role === "superadmin") {
    return <p className="text-muted-fg text-sm">Un superadmin no tiene restricciones de permisos, modelos ni cupo.</p>;
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={locked} className="disabled:opacity-60">
        <SettingsGroup title="Cupo mensual">
          <SettingsRow
            label="Tokens por mes"
            htmlFor="token-limit"
            description={`Se reinicia el día 1 (UTC). Este mes: ${TOKENS.format(user.tokensThisMonth)}.`}
          >
            <Input
              id="token-limit"
              type="number"
              min={0}
              step={1}
              placeholder="Sin límite"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="h-10 rounded-lg sm:w-48"
            />
          </SettingsRow>
          {usedLimit !== null && Number.isFinite(usedLimit) ? (
            <div className="px-4 py-3">
              <TokenBar used={user.tokensThisMonth} limit={usedLimit} />
            </div>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="Permisos">
          {PERMISSIONS.map(({ id, label, description }) => (
            <SettingsRow key={id} label={label} description={description}>
              <Switch
                aria-label={label}
                checked={permissions[id]}
                onCheckedChange={(on) => setPermissions((prev) => ({ ...prev, [id]: on }))}
              />
            </SettingsRow>
          ))}
          <SettingsRow label="Suscripciones personales" description="Puede vincular y usar su propia cuenta de Claude o ChatGPT (nunca compartida).">
            <Switch aria-label="Suscripciones personales" checked={claudeCode} onCheckedChange={setClaudeCode} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Modelos">
          <SettingsRow label="Limitar modelos" description="Si lo apagas, puede usar cualquier modelo.">
            <Switch aria-label="Limitar modelos" checked={restricted} onCheckedChange={setRestricted} />
          </SettingsRow>
          {restricted
            ? PROVIDERS.map(({ id, label }) => {
                const rule = rules[id];
                return (
                  <div key={id} className="grid gap-2 px-4 py-3">
                    <label className="flex items-center justify-between gap-4 text-sm">
                      {label}
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(on) => setRules((prev) => ({ ...prev, [id]: { ...prev[id], enabled: on } }))}
                      />
                    </label>
                    {rule.enabled ? (
                      <Textarea
                        aria-label={`Modelos permitidos de ${label}`}
                        rows={1}
                        placeholder="Todos los modelos (o escribe los permitidos, separados por comas)"
                        value={rule.models}
                        onChange={(event) =>
                          setRules((prev) => ({ ...prev, [id]: { ...prev[id], models: event.target.value } }))
                        }
                        className="min-h-9 text-[13px]"
                      />
                    ) : null}
                  </div>
                );
              })
            : null}
        </SettingsGroup>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy || locked} className="rounded-full px-5">
            {busy ? "Guardando…" : "Guardar acceso"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/** Ficha de una cuenta. La API vuelve a aplicar cada regla: aquí solo no se ofrece lo imposible. */
export function UserDetailView({ userId }: { userId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${userId}`);
    if (!res.ok) {
      setLoadError(await errorOf(res, "No se pudo cargar la cuenta"));
      return;
    }
    const loaded = (await res.json()) as Loaded;
    setData(loaded);
    setEmail(loaded.user.email);
    setNote(loaded.user.adminNote ?? "");
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde la API
    void load();
  }, [load]);

  async function change(patch: UserChange): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo guardar el cambio"));
      return false;
    }
    const result = (await res.json()) as { user: ManagedUser; generatedPassword: string | null };
    if (result.generatedPassword) setCredentials({ email: result.user.email, password: result.generatedPassword });
    await load();
    return true;
  }

  async function revoke(sessionId: string | null) {
    const query = sessionId ? `?session=${sessionId}` : "";
    const res = await fetch(`/api/admin/users/${userId}/sessions${query}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo cerrar la sesión"));
      return;
    }
    await load();
  }

  async function remove() {
    setConfirmDelete(false);
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo borrar la cuenta"));
      return;
    }
    router.push("/admin/users");
  }

  const back = { href: "/admin/users", label: "Usuarios" };
  if (loadError) {
    return (
      <Page title="Usuario" back={back}>
        <p role="alert" className="text-danger text-sm">
          {loadError}
        </p>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Usuario" back={back}>
        <Skeleton className="h-60 w-full rounded-xl" />
      </Page>
    );
  }

  const { user, sessions, usageByDay, counts, providers, recentRuns, bots, audit, actorRole, currentUserId } = data;
  const isSelf = user.id === currentUserId;
  const canManage = !isSelf && (actorRole === "superadmin" || user.role === "user");

  return (
    <Page
      title={user.email}
      width="wide"
      back={back}
      description={`Alta: ${DATE.format(new Date(user.createdAt))} · Último acceso: ${
        user.lastLoginAt ? DATE_TIME.format(new Date(user.lastLoginAt)) : "nunca"
      }`}
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Badge className="rounded-full">{ROLE_LABEL[user.role]}</Badge>
          {user.disabled ? (
            <Badge variant="destructive" className="rounded-full">
              Desactivada
            </Badge>
          ) : null}
        </div>
      }
    >
      {!canManage ? (
        <p role="status" className="border-border text-muted-fg mb-6 rounded-xl border px-4 py-3 text-sm">
          {isSelf ? "Es tu propia cuenta: solo puedes consultarla aquí." : "Solo un superadmin puede gestionar a otros administradores."}
        </p>
      ) : null}
      {user.disabled && user.disabledReason ? (
        <p role="status" className="border-border mb-6 rounded-xl border px-4 py-3 text-sm">
          Motivo de la desactivación: {user.disabledReason}
        </p>
      ) : null}

      <Tabs defaultValue="summary">
        <TabsList className="mb-6">
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="access">Acceso</TabsTrigger>
          <TabsTrigger value="sessions">Sesiones ({sessions.length})</TabsTrigger>
          <TabsTrigger value="activity">Actividad</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <SettingsGroup title="Consumo y recursos">
            <SettingsRow label="Tokens este mes">
              <span className="text-[14px]">{TOKENS.format(user.tokensThisMonth)}</span>
            </SettingsRow>
            <SettingsRow label="Tokens en 30 días">
              <span className="text-[14px]">{TOKENS.format(user.tokensLast30Days)}</span>
            </SettingsRow>
            <SettingsRow label="Recursos">
              <span className="text-[14px]">
                {counts.threads} chats · {counts.skills} skills · {counts.bots} bots · {counts.connectors} conectores
              </span>
            </SettingsRow>
            <SettingsRow label="Proveedores con clave propia">
              <span className="text-[14px]">{providers.length > 0 ? providers.join(", ") : "Ninguno"}</span>
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="Cuenta">
            <SettingsRow label="Email" htmlFor="user-email" description="Con este correo inicia sesión.">
              <div className="flex gap-2">
                <Input
                  id="user-email"
                  type="email"
                  value={email}
                  disabled={!canManage}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-9 rounded-lg sm:w-64"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManage || email.trim().toLowerCase() === user.email}
                  onClick={() => void change({ email: email.trim().toLowerCase() })}
                >
                  Cambiar
                </Button>
              </div>
            </SettingsRow>
            {actorRole === "superadmin" ? (
              <SettingsRow label="Rol">
                <Select
                  value={user.role}
                  disabled={!canManage}
                  onValueChange={(role) => void change({ role: role as UserRole })}
                >
                  <SelectTrigger className="h-9 w-40 rounded-lg" aria-label="Rol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABEL) as UserRole[]).map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>
            ) : null}
            <SettingsRow label="Contraseña" description="Genera una nueva y cierra todas sus sesiones.">
              <Button size="sm" variant="outline" disabled={!canManage} onClick={() => void change({ resetPassword: true })}>
                Restablecer
              </Button>
            </SettingsRow>
            <div className="grid gap-2 px-4 py-4">
              <Label htmlFor="admin-note" className="text-[15px]">
                Nota interna
              </Label>
              <Textarea
                id="admin-note"
                rows={3}
                maxLength={4000}
                disabled={!canManage}
                placeholder="Solo la ven los administradores"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManage || note === (user.adminNote ?? "")}
                  onClick={() => void change({ adminNote: note.trim() || null })}
                >
                  Guardar nota
                </Button>
              </div>
            </div>
          </SettingsGroup>

          <SettingsGroup title="Zona de riesgo">
            <SettingsRow
              label={user.disabled ? "Reactivar cuenta" : "Desactivar cuenta"}
              description="Una cuenta desactivada no puede entrar ni ejecutar agentes. Sus datos se conservan."
            >
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage}
                onClick={() => (user.disabled ? void change({ disabled: false }) : setConfirmDisable(true))}
              >
                {user.disabled ? "Reactivar" : "Desactivar"}
              </Button>
            </SettingsRow>
            <SettingsRow label="Borrar cuenta" description="Borra sus hilos, agentes, bots y claves. No se puede deshacer.">
              <Button size="sm" variant="destructive" disabled={!canManage} onClick={() => setConfirmDelete(true)}>
                Borrar
              </Button>
            </SettingsRow>
          </SettingsGroup>
        </TabsContent>

        <TabsContent value="access">
          <AccessPanel key={user.id} user={user} locked={!canManage} onSave={change} />
        </TabsContent>

        <TabsContent value="sessions">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" disabled={!canManage || sessions.length === 0} onClick={() => void revoke(null)}>
              Cerrar todas
            </Button>
          </div>
          {sessions.length === 0 ? (
            <p className="text-muted-fg text-sm">No tiene sesiones abiertas.</p>
          ) : (
            <SettingsGroup>
              {sessions.map((session) => (
                <SettingsRow
                  key={session.id}
                  label={session.userAgent ?? "Dispositivo desconocido"}
                  description={`${session.ip ?? "IP desconocida"} · Inició ${DATE_TIME.format(new Date(session.createdAt))} · Activa ${
                    session.lastSeenAt ? DATE_TIME.format(new Date(session.lastSeenAt)) : "sin datos"
                  }`}
                >
                  <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => void revoke(session.id)}>
                    Cerrar
                  </Button>
                </SettingsRow>
              ))}
            </SettingsGroup>
          )}
        </TabsContent>

        <TabsContent value="activity">
          <SettingsGroup title="Consumo por día (30 días, UTC)">
            {usageByDay.length === 0 ? (
              <p className="text-muted-fg px-4 py-4 text-sm">Sin actividad.</p>
            ) : (
              usageByDay.map((entry) => (
                <SettingsRow key={entry.day} label={entry.day}>
                  <span className="text-[14px]">
                    {entry.runs} ejecuciones · {TOKENS.format(entry.tokens)} tokens
                  </span>
                </SettingsRow>
              ))
            )}
          </SettingsGroup>

          <SettingsGroup title="Últimas ejecuciones">
            {recentRuns.length === 0 ? (
              <p className="text-muted-fg px-4 py-4 text-sm">Sin ejecuciones.</p>
            ) : (
              recentRuns.map((run) => (
                <SettingsRow
                  key={run.id}
                  label={STATUS_LABEL[run.status] ?? run.status}
                  description={run.error ?? `${DATE_TIME.format(new Date(run.createdAt))} · ${run.initiator}`}
                >
                  <span className="text-[14px]">{TOKENS.format(run.tokens)} tokens</span>
                </SettingsRow>
              ))
            )}
          </SettingsGroup>

          {bots.length > 0 ? (
            <SettingsGroup title="NexBots">
              {bots.map((bot) => (
                <SettingsRow key={bot.id} label={bot.name}>
                  <span className="text-[14px]">{bot.status}</span>
                </SettingsRow>
              ))}
            </SettingsGroup>
          ) : null}

          <SettingsGroup title="Registro de administración">
            {audit.length === 0 ? (
              <p className="text-muted-fg px-4 py-4 text-sm">Sin cambios registrados.</p>
            ) : (
              audit.map((entry) => (
                <SettingsRow
                  key={entry.id}
                  label={describeAudit(entry)}
                  description={`${entry.actorEmail} · ${DATE_TIME.format(new Date(entry.createdAt))}${
                    entry.targetEmail && entry.targetEmail !== user.email ? ` · sobre ${entry.targetEmail}` : ""
                  }`}
                />
              ))
            )}
          </SettingsGroup>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar {user.email}?</AlertDialogTitle>
            <AlertDialogDescription>Se cerrarán todas sus sesiones. Sus datos se conservan.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Motivo"
            placeholder="Motivo (opcional, solo para admins)"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void change({ disabled: true, disabledReason: reason.trim() || null });
                setReason("");
              }}
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {user.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrarán sus hilos, agentes y claves. No se puede deshacer. Si solo quieres cortarle el acceso, desactiva
              la cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Borrar cuenta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PasswordDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </Page>
  );
}

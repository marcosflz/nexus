"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, ShieldQuestion, X } from "lucide-react";
import { toast } from "sonner";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  threadId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Approval {
  id: string;
  tool: string;
  args: unknown;
  reason: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  run_completed: "Completado",
  run_failed: "Falló",
  needs_approval: "Aprobación",
  needs_input: "Necesita respuesta",
  budget_exceeded: "Presupuesto",
};

export function Inbox() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [n, a] = await Promise.all([
      fetch("/api/notifications").then((res) => (res.ok ? res.json() : { notifications: [] })),
      fetch("/api/approvals/pending").then((res) => (res.ok ? res.json() : { approvals: [] })),
    ]);
    setNotifications(n.notifications);
    setApprovals(a.approvals);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    // Abrir la bandeja la da por vista; el contador de la barra lateral se pone a cero.
    void fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  }, [load]);

  async function decide(approval: Approval, decision: "approve" | "deny") {
    const res = await fetch(`/api/approvals/${approval.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return toast.error(data.error ?? "No se pudo registrar tu decisión");
    toast.success(decision === "approve" ? "Aprobado: el agente continúa" : "Rechazado");
    await load();
  }

  return (
    <Page title="Bandeja" description="Lo que hacen tus agentes cuando trabajan por su cuenta.">
      {approvals.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h2 className="text-sm font-medium">Esperan tu aprobación</h2>
          {approvals.map((approval) => (
            <div key={approval.id} className="border-warning/40 bg-warning/10 rounded-xl border p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <ShieldQuestion className="size-4" />
                Un agente quiere ejecutar <code className="bg-muted rounded px-1">{approval.tool}</code>
              </div>
              {approval.reason ? <p className="text-muted-foreground mt-1">{approval.reason}</p> : null}
              {approval.args ? (
                <pre className="bg-muted mt-2 max-h-40 overflow-auto rounded-lg p-2 text-xs">
                  {JSON.stringify(approval.args, null, 2)}
                </pre>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="rounded-full" onClick={() => decide(approval, "approve")}>
                  <Check className="size-4" /> Aprobar
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => decide(approval, "deny")}>
                  <X className="size-4" /> Rechazar
                </Button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Actividad</h2>
        {loading ? <p className="text-muted-foreground text-sm">Cargando…</p> : null}
        {!loading && notifications.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
            Aquí aparecerá lo que hagan tus agentes cuando trabajen por su cuenta.
          </p>
        ) : null}
        {notifications.map((item) => {
          const content = (
            <div className="border-border bg-surface hover:bg-surface-2 rounded-xl border p-4 text-sm transition-colors">
              <div className="flex items-center gap-2">
                <Badge variant={item.kind === "run_failed" ? "destructive" : "outline"}>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                <span className="font-medium">{item.title}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {new Date(item.createdAt).toLocaleString("es")}
                </span>
              </div>
              {item.body ? <p className="text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">{item.body}</p> : null}
            </div>
          );
          return item.threadId ? (
            <Link key={item.id} href={`/?thread=${item.threadId}`} className="block">
              {content}
            </Link>
          ) : (
            <div key={item.id}>{content}</div>
          );
        })}
      </section>
    </Page>
  );
}

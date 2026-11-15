"use client";

import { useEffect, useMemo, useState } from "react";
import { Page } from "@/components/shell/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Row {
  day: string;
  agent: string;
  runs: number;
  tokens: number;
  failed: number;
}

const fmt = (n: number) => n.toLocaleString("es");

/** Consumo de los últimos días: totales, por día y por agente. */
export function UsageContent() {
  const [days, setDays] = useState("30");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/usage?days=${days}`)
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data: { rows: Row[] }) => alive && setRows(data.rows))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [days]);

  const { totals, byDay, byAgent } = useMemo(() => {
    const totals = { runs: 0, tokens: 0, failed: 0 };
    const day = new Map<string, { runs: number; tokens: number }>();
    const agent = new Map<string, { runs: number; tokens: number; failed: number }>();
    for (const row of rows ?? []) {
      totals.runs += row.runs;
      totals.tokens += row.tokens;
      totals.failed += row.failed;
      const d = day.get(row.day) ?? { runs: 0, tokens: 0 };
      d.runs += row.runs;
      d.tokens += row.tokens;
      day.set(row.day, d);
      const a = agent.get(row.agent) ?? { runs: 0, tokens: 0, failed: 0 };
      a.runs += row.runs;
      a.tokens += row.tokens;
      a.failed += row.failed;
      agent.set(row.agent, a);
    }
    return {
      totals,
      byDay: [...day.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)),
      byAgent: [...agent.entries()].sort((x, y) => y[1].tokens - x[1].tokens),
    };
  }, [rows]);

  const maxDay = Math.max(1, ...byDay.map(([, value]) => value.tokens));

  return (
    <>
      <div className="mb-6 flex justify-end">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40" aria-label="Periodo"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 días</SelectItem>
            <SelectItem value="30">Últimos 30 días</SelectItem>
            <SelectItem value="90">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-3">
        {[
          ["Ejecuciones", fmt(totals.runs)],
          ["Tokens", fmt(totals.tokens)],
          ["Con problemas", fmt(totals.failed)],
        ].map(([label, value]) => (
          <div key={label} className="border-border bg-surface rounded-xl border p-4">
            <p className="text-muted-fg text-xs">{label}</p>
            <p className="text-[28px] font-normal tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {rows === null ? <p className="text-muted-foreground text-sm">Cargando…</p> : null}
      {rows !== null && rows.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          Aún no hay actividad en este periodo.
        </p>
      ) : null}

      {byAgent.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium">Por agente</h2>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr><th className="py-1 font-normal">Agente</th><th className="text-right font-normal">Ejecuciones</th><th className="text-right font-normal">Tokens</th><th className="text-right font-normal">Problemas</th></tr>
            </thead>
            <tbody>
              {byAgent.map(([name, value]) => (
                <tr key={name} className="border-t">
                  <td className="py-2">{name}</td>
                  <td className="text-right tabular-nums">{fmt(value.runs)}</td>
                  <td className="text-right tabular-nums">{fmt(value.tokens)}</td>
                  <td className="text-right tabular-nums">{fmt(value.failed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {byDay.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium">Por día</h2>
          <ul className="space-y-1.5">
            {byDay.map(([day, value]) => (
              <li key={day} className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{day}</span>
                <div className="bg-surface-2 h-3 min-w-0 flex-1 overflow-hidden rounded-full" role="img" aria-label={`${fmt(value.tokens)} tokens`}>
                  <div className="bg-brand h-full rounded-full" style={{ width: `${Math.max(2, (value.tokens / maxDay) * 100)}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right tabular-nums">{fmt(value.tokens)} tok · {value.runs}×</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function UsageDashboard() {
  return (
    <Page title="Uso">
      <UsageContent />
    </Page>
  );
}

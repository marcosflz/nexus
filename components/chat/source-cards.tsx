import { domainOf, shortDomain } from "@/lib/sources";
import { cn } from "@/lib/utils";

export interface CardSource {
  id: number;
  url: string;
  title?: string;
}

/** Inicial del dominio en un círculo. Sin favicons remotos: pedirlos a un tercero filtraría qué se consulta. */
export function DomainInitial({ url, ring = false }: { url: string; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-surface-3 text-fg flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium uppercase",
        ring && "ring-surface ring-2",
      )}
    >
      {shortDomain(url).charAt(0) || "?"}
    </span>
  );
}

const CARD = "border-border bg-surface flex h-[84px] flex-col justify-between rounded-xl border p-3";

export function SourceCards({ sources, onShowAll }: { sources: CardSource[]; onShowAll?: () => void }) {
  if (sources.length === 0) return null;
  const overflow = sources.length > 4;
  const shown = overflow ? sources.slice(0, 3) : sources.slice(0, 4);
  const rest = sources.slice(3);
  const more = (
    <>
      <span className="flex -space-x-1">
        {rest.slice(0, 3).map((s) => (
          <DomainInitial key={s.id} url={s.url} ring />
        ))}
      </span>
      <span className="text-muted-fg text-[12px]">+{rest.length} fuentes</span>
    </>
  );
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {shown.map((s) => (
        <a
          key={s.id}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(CARD, "hover:bg-surface-2 transition-colors")}
        >
          <span className="text-fg line-clamp-2 text-[13px] leading-snug">{s.title ?? domainOf(s.url)}</span>
          <span className="text-muted-fg flex items-center gap-1.5 text-[12px]">
            <DomainInitial url={s.url} />
            <span className="truncate">{shortDomain(s.url)}</span>
            <span className="tabular-nums">· {s.id}</span>
          </span>
        </a>
      ))}
      {overflow ? (
        onShowAll ? (
          <button type="button" onClick={onShowAll} className={cn(CARD, "hover:bg-surface-2 text-left transition-colors")}>
            {more}
          </button>
        ) : (
          <div className={CARD}>{more}</div>
        )
      ) : null}
    </div>
  );
}

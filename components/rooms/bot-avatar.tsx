import { cn } from "@/lib/utils";
import type { Member } from "./types";

const DOT: Record<string, string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  error: "bg-danger",
};

/** Inicial del bot con un punto de estado. `busy` marca que está hablando ahora mismo. */
export function BotAvatar({ member, busy = false, size = "md" }: { member: Pick<Member, "name" | "avatar" | "status">; busy?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "bg-surface-2 text-fg relative inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        size === "sm" ? "size-6 text-[11px]" : "size-8 text-[13px]",
        busy && "ring-brand ring-2",
      )}
    >
      {member.avatar || member.name.slice(0, 1).toUpperCase()}
      <span
        aria-hidden
        className={cn("border-bg absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2", DOT[member.status] ?? "bg-muted-fg/50")}
      />
    </span>
  );
}

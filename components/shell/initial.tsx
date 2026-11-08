import { cn } from "@/lib/utils";

/** Círculo con la inicial del correo. */
export function Initial({ email, className }: { email: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-medium text-fg uppercase",
        className,
      )}
    >
      {email.charAt(0)}
    </span>
  );
}

import { cn } from "@/lib/utils";

/** Marca de Nexus: un nodo central conectado a tres nodos. Hereda el color del texto. */
export function NexusLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-6", className)}
      aria-hidden
    >
      <path d="M12 3.5 19.36 16.25 4.64 16.25Z" opacity={0.3} />
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="12" cy="3.5" r="1.6" />
      <circle cx="19.36" cy="16.25" r="1.6" />
      <circle cx="4.64" cy="16.25" r="1.6" />
      <path d="M12 5.1V9.6M14.08 13.2 17.98 15.45M9.92 13.2 6.02 15.45" />
    </svg>
  );
}

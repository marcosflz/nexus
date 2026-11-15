"use client"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { createContext, useContext } from "react"

const SourceContext = createContext<{
  href: string
  domain: string
} | null>(null)

function useSourceContext() {
  const ctx = useContext(SourceContext)
  if (!ctx) throw new Error("Source.* must be used inside <Source>")
  return ctx
}

export type SourceProps = {
  href: string
  children: React.ReactNode
}

export function Source({ href, children }: SourceProps) {
  let domain = ""
  try {
    domain = new URL(href).hostname
  } catch {
    domain = href.split("/").pop() || href
  }

  return (
    <SourceContext.Provider value={{ href, domain }}>
      <HoverCard openDelay={150} closeDelay={0}>
        {children}
      </HoverCard>
    </SourceContext.Provider>
  )
}

export type SourceTriggerProps = {
  label?: string | number
  showFavicon?: boolean
  className?: string
}

export function SourceTrigger({
  label,
  showFavicon = false,
  className,
}: SourceTriggerProps) {
  const { href, domain } = useSourceContext()
  const labelToShow = label ?? domain.replace("www.", "")

  return (
    <HoverCardTrigger asChild>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex h-[18px] max-w-36 items-center gap-1 overflow-hidden rounded-full bg-surface-2 text-[11px] text-muted-fg no-underline align-[1px] transition-colors duration-150 hover:bg-brand hover:text-brand-fg",
          showFavicon ? "pr-2 pl-1" : "px-1.5",
          className
        )}
      >
        {showFavicon && (
          // Sin favicons remotos: pedirlos a un tercero (p. ej. Google) le diría qué
          // dominios consultan los usuarios. Se muestra la inicial del dominio.
          <span
            aria-hidden
            className="bg-background text-foreground flex size-3.5 items-center justify-center rounded-full text-[9px] font-medium uppercase"
          >
            {domain.replace("www.", "").charAt(0)}
          </span>
        )}
        <span className="truncate tabular-nums text-center font-normal">{labelToShow}</span>
      </a>
    </HoverCardTrigger>
  )
}

export type SourceContentProps = {
  title: string
  description: string
  className?: string
}

export function SourceContent({
  title,
  description,
  className,
}: SourceContentProps) {
  const { href, domain } = useSourceContext()

  return (
    <HoverCardContent className={cn("w-80 rounded-xl p-0 shadow-2", className)}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col gap-2 p-3"
      >
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="bg-muted text-foreground flex size-4 items-center justify-center rounded-full text-[10px] font-medium uppercase"
          >
            {domain.replace("www.", "").charAt(0)}
          </span>
          <div className="text-brand truncate text-sm">
            {domain.replace("www.", "")}
          </div>
        </div>
        <div className="line-clamp-2 text-sm font-medium">{title}</div>
        <div className="text-muted-foreground line-clamp-2 text-sm">
          {description}
        </div>
      </a>
    </HoverCardContent>
  )
}

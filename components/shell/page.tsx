"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** Envoltorio común de las páginas internas (agentes, bandeja, uso). */
export function Page({
  title,
  description,
  actions,
  back,
  width = "default",
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  width?: "default" | "wide";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh">
      <header className="bg-bg/80 sticky top-0 z-20 flex h-14 items-center gap-2 px-3 backdrop-blur-md md:hidden">
        <SidebarTrigger />
      </header>
      <main className={cn("mx-auto w-full px-6 py-8 md:py-12", width === "wide" ? "max-w-5xl" : "max-w-3xl")}>
        {back ? (
          <Link href={back.href} className="text-muted-fg hover:text-fg mb-4 inline-flex items-center gap-1 text-[13px]">
            <ArrowLeft className="size-4" /> {back.label}
          </Link>
        ) : null}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-normal tracking-tight">{title}</h1>
            {description ? <p className="text-muted-fg mt-1 max-w-xl text-[14px]">{description}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

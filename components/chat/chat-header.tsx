"use client";

import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ShareButton } from "@/components/share/share-button";
import { useShell } from "@/components/shell/shell-context";
import { ThreadMenuItems } from "@/components/shell/thread-menu";
import type { ThreadSummary } from "./types";

export function ChatHeader({ thread }: { thread: ThreadSummary | null }) {
  const { user } = useShell();
  return (
    <header className="bg-bg/80 supports-[backdrop-filter]:bg-bg/70 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 px-3 backdrop-blur-md">
      <SidebarTrigger className="md:hidden" />
      {thread ? (
        <>
          <h1 className="text-fg min-w-0 flex-1 truncate text-[14px] font-medium">{thread.title}</h1>
          <div className="flex items-center gap-1">
            {user.permissions.share ? <ShareButton threadId={thread.id} /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Más acciones" className="rounded-full">
                  <Ellipsis className="size-[18px]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <ThreadMenuItems thread={thread} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}
    </header>
  );
}

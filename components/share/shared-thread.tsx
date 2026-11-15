"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Markdown } from "@/components/ui/markdown";
import { NexusLogo } from "@/components/brand/logo";
import { SourceCards } from "@/components/chat/source-cards";
import { CitationChip } from "@/components/chat/message-parts";
import { ThemeToggle } from "@/components/theme-toggle";
import { citationIdsOf, remarkCitations, stripSourcesBlock } from "@/lib/markdown/citations";
import { stripFollowupsBlock, type SourceItem } from "@/lib/sources";
import type { SharedThread } from "@/lib/share/service";

const PLUGINS = [remarkCitations];

function AssistantAnswer({ content, sources }: { content: string; sources: SourceItem[] }) {
  const components = useMemo(
    () => ({
      a: function Anchor({ href, children }: { href?: string; children?: React.ReactNode }) {
        const ids = citationIdsOf(href);
        if (ids.length > 0) return <CitationChip ids={ids} sources={sources} />;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      },
    }),
    [sources],
  );
  const text = stripFollowupsBlock(sources.length > 0 ? stripSourcesBlock(content) : content);
  return (
    <div>
      <SourceCards sources={sources} />
      <Markdown className="aui-md" remarkPlugins={PLUGINS} components={components}>
        {text}
      </Markdown>
    </div>
  );
}

/** Vista de solo lectura de un hilo compartido: texto y fuentes, nada más. */
export function SharedConversation({ thread }: { thread: SharedThread }) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 sm:px-6">
      <header className="flex h-14 items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-medium">
          <NexusLogo className="size-5" /> Nexus
        </Link>
        <ThemeToggle />
      </header>
      <p className="text-muted-fg mt-6 text-[13px]">Conversación compartida</p>
      <h1 className="mb-6 text-[28px] font-normal tracking-tight">{thread.title}</h1>
      <div>
        {thread.messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex justify-end pt-10 first:pt-2">
              <div className="bg-surface-2 text-fg max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap sm:max-w-[75%]">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={index} className="mt-6">
              <AssistantAnswer content={message.content} sources={message.sources} />
            </div>
          ),
        )}
      </div>
      <footer className="text-muted-fg border-border mt-12 border-t pt-4 text-center text-xs">
        Hecho con{" "}
        <Link href="/" className="underline underline-offset-4">
          Nexus
        </Link>
        , un buscador con IA autoalojado.
      </footer>
    </main>
  );
}

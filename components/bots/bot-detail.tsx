"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Page } from "@/components/shell/page";
import { BotPanel } from "./bot-panel";

/** Página de un bot: los mismos paneles que su ficha lateral en una sala. */
export function BotDetail({ botId }: { botId: string }) {
  const router = useRouter();
  const [bot, setBot] = useState<{ name: string; description: string } | null>(null);
  return (
    <Page
      title={bot?.name ?? "NexBot"}
      width="wide"
      back={{ href: "/bots", label: "NexBots" }}
      description={bot?.description || undefined}
    >
      <BotPanel
        botId={botId}
        onDeleted={() => router.push("/bots")}
        onLoaded={(loaded) =>
          setBot((prev) => (prev?.name === loaded.name && prev.description === loaded.description ? prev : loaded))
        }
      />
    </Page>
  );
}

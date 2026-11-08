import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedConversation } from "@/components/share/shared-thread";
import { loadSharedThread } from "@/lib/share/service";

export const dynamic = "force-dynamic";

// Un enlace compartido no debe indexarse ni reenviarse a buscadores.
export const metadata: Metadata = {
  title: "Conversación compartida · Nexus",
  robots: { index: false, follow: false },
};

export default async function SharedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(slug)) notFound();
  const thread = await loadSharedThread(slug);
  if (!thread) notFound();
  return <SharedConversation thread={thread} />;
}

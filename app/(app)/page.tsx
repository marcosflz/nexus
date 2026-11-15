import { ChatApp } from "@/components/chat/chat-app";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const pick = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const agent = pick(query.bot);
  const thread = pick(query.thread);
  return (
    <ChatApp
      initialAgentId={agent && UUID.test(agent) ? agent : null}
      // La API vuelve a comprobar que el hilo es del usuario (404 si no).
      initialThreadId={thread && UUID.test(thread) ? thread : null}
    />
  );
}

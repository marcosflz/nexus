import type { RoomLimits, TopicStatus } from "@/lib/db/schema";
import type { StepCall } from "./tool-steps";

export interface Member {
  id: string;
  name: string;
  slug: string;
  avatar: string;
  description: string;
  status: string;
  network: "restricted" | "none";
}

export interface TopicCard {
  id: string;
  title: string;
  status: TopicStatus;
  assigneeBotId: string | null;
  parentTopicId: string | null;
  createdByBotId: string | null;
  updatedAt: string;
  messages: number;
  blockedBy: { id: string; resolved: boolean }[];
  children: { total: number; done: number };
  activeBotId: string | null;
  queued: number;
  held: number;
}

export interface Overview {
  room: { id: string; name: string; description: string; limits: RoomLimits; mixedNetworkAck: boolean };
  members: Member[];
  topics: TopicCard[];
}

export interface RoomMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  botId: string | null;
  runId: string | null;
  tools: StepCall[] | null;
  reasoning: string | null;
  notice: { kind: string; botId?: string; limit?: string; roundId?: string } | null;
  createdAt: string;
}

export interface TurnInfo {
  id: string;
  botId: string;
  status: "queued" | "held" | "running" | "awaiting";
  runId: string | null;
  reason: string;
  hop: number;
}

export interface TopicDetail {
  messages: RoomMessage[];
  turns: TurnInfo[];
}

export async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export const send = (url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) =>
  fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

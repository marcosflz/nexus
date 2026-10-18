import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";
import type { SourceItem } from "@/lib/sources";
import type { HermesTokens } from "@/lib/hermes/events";
import type { ActionKind, PolicyEffect } from "@/lib/policy/types";

export interface MessageAttachmentMeta {
  name: string;
  mime?: string;
  size?: number;
}

export interface PersistedTool {
  id: string;
  name: string;
  input?: unknown;
  argsText?: string;
  /** `openui` marca un bloque de UI generativa extraído del texto. */
  kind?: "tool" | "openui";
  /** El programa OpenUI no pasó la validación: no se renderiza como UI. */
  invalid?: boolean;
  status: "running" | "complete" | "error";
  durationMs?: number;
}

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const credentials = pgTable("credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiKeyEnc: text("api_key_enc"),
  baseUrl: text("base_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threads = pgTable("threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Nuevo chat"),
  hermesSessionId: text("hermes_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources").$type<SourceItem[]>(),
  tools: jsonb("tools").$type<PersistedTool[]>(),
  attachments: jsonb("attachments").$type<MessageAttachmentMeta[]>(),
  usage: jsonb("usage").$type<HermesTokens>(),
  runId: uuid("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Un turno. Guarda el ciclo de vida y el punto de reanudación para que
 * recargar a mitad de respuesta no pierda el trabajo hecho.
 */
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  agentSessionId: text("agent_session_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  lastSeq: integer("last_seq").notNull().default(0),
  prompt: text("prompt"),
  error: text("error"),
  usage: jsonb("usage").$type<HermesTokens>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Log append-only de eventos AG-UI de un run. Es lo que permite el replay. */
export const runEvents = pgTable("run_events", {
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Registro de cada acción del agente: qué se permitió, qué se negó y qué regla
 * lo decidió. Se escribe **antes** de aplicar el efecto.
 */
export const actionAudit = pgTable("action_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").references(() => threads.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  tool: text("tool").notNull(),
  kind: text("kind").$type<ActionKind>().notNull(),
  effect: text("effect").$type<PolicyEffect>().notNull(),
  rule: text("rule").notNull(),
  reason: text("reason"),
  target: jsonb("target"),
  args: jsonb("args"),
  result: jsonb("result"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Acciones que esperan (o esperaron) una decisión humana explícita. */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  args: jsonb("args"),
  rule: text("rule").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

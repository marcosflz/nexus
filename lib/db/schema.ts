import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  unique,
  text,
  timestamp,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";
import type { SourceItem } from "@/lib/sources";
import type { TokenUsage } from "@/lib/agents/usage";
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
  result?: string;
}

/** Parte ordenada de un mensaje del asistente. */
export type PersistedPart = { type: "text"; text: string } | { type: "tool"; toolId: string };

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

/**
 * Credenciales de proveedor de un usuario: una por proveedor, de modo que un
 * agente puede fijar un proveedor distinto del predeterminado sin que el
 * usuario pierda las claves de los demás.
 */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    apiKeyEnc: text("api_key_enc"),
    baseUrl: text("base_url"),
    /** La que se usa cuando un agente no fija proveedor. Solo una por usuario. */
    isDefault: boolean("is_default").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("credentials_user_provider_idx").on(table.userId, table.provider)],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threads = pgTable("threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Nuevo chat"),
  /** @deprecated Sesión del motor retirado (Hermes). Sin uso; se borrará en una migración posterior. */
  hermesSessionId: text("hermes_session_id"),
  /** Motor que atendió el hilo. Hoy siempre `nas-adk`. */
  backend: text("backend"),
  /** Agente que lleva el hilo; null = el integrado de Nexus. */
  agentId: uuid("agent_id"),
  /** Quién lo originó: una persona (`user`) o una rutina/disparador (`routine`). */
  origin: text("origin").notNull().default("user"),
  /** Fijado en la barra lateral (null = no fijado). Ordena la sección «Fijados». */
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  /** Proyecto (carpeta) al que pertenece; null = sin proyecto. */
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
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
  usage: jsonb("usage").$type<TokenUsage>(),
  /** Partes ordenadas (texto / herramienta). Null en mensajes anteriores a la v2. */
  parts: jsonb("parts").$type<PersistedPart[]>(),
  /** Preguntas de seguimiento propuestas por el agente. */
  followups: jsonb("followups").$type<string[]>(),
  runId: uuid("run_id"),
  /** Mensaje del que continúa (base para ramas de conversación). */
  parentId: uuid("parent_id"),
  /** Marca de «reemplazado» al editar o regenerar: sigue guardado pero fuera del contexto. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  agentId: uuid("agent_id"),
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
  /** Quién lanzó el run: una persona, una rutina programada o un disparador. */
  initiator: text("initiator").notNull().default("user"),
  /** Motor que lo ejecutó. Hoy siempre `nas-adk`. */
  backend: text("backend"),
  agentId: uuid("agent_id"),
  agentVersionId: uuid("agent_version_id"),
  parentRunId: uuid("parent_run_id"),
  triggerId: uuid("trigger_id"),
  /** Agrupa los runs en paralelo de un Model Council. */
  groupId: uuid("group_id"),
  /** Resultado de AG-UI (`success` | `interrupt` con sus interrupts). */
  outcome: jsonb("outcome"),
  /** Sesión del motor serializada al pausar el run, para poder reanudarlo. */
  checkpoint: jsonb("checkpoint"),
  agentSessionId: text("agent_session_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  lastSeq: integer("last_seq").notNull().default(0),
  prompt: text("prompt"),
  error: text("error"),
  usage: jsonb("usage").$type<TokenUsage>(),
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

/** Valoración (+1 / −1) de una respuesta por parte de quien la recibió. */
export const messageFeedback = pgTable(
  "message_feedback",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);

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
  /** Llamada concreta que espera: con ella se reanuda el run al decidir. */
  toolCallId: text("tool_call_id"),
  args: jsonb("args"),
  rule: text("rule").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Agentes, conocimiento y autonomía ---------------------------------------

export type AgentVisibility = "private" | "unlisted" | "public";
export type AgentStatus = "active" | "paused";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    avatar: text("avatar").notNull().default(""),
    description: text("description").notNull().default(""),
    visibility: text("visibility").$type<AgentVisibility>().notNull().default("private"),
    status: text("status").$type<AgentStatus>().notNull().default("active"),
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("agents_owner_slug").on(table.ownerId, table.slug)],
);

/** Versión inmutable de un agente. Los runs fijan la versión con la que arrancaron. */
export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    spec: jsonb("spec").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("agent_versions_agent_version").on(table.agentId, table.version)],
);

export const knowledgeFiles = pgTable(
  "knowledge_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime"),
    size: integer("size").notNull().default(0),
    sha256: text("sha256").notNull(),
    status: text("status").$type<"pending" | "indexed" | "error">().notNull().default("pending"),
    error: text("error"),
    textChars: integer("text_chars").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("knowledge_files_agent_sha").on(table.agentId, table.sha256)],
);

/** `tsv` es una columna generada por Postgres: no se declara aquí ni se escribe. */
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => knowledgeFiles.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
});

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
  evidence: text("evidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("mcp"),
    name: text("name").notNull(),
    url: text("url").notNull(),
    transport: text("transport").$type<"streamable-http" | "sse">().notNull().default("streamable-http"),
    authType: text("auth_type").$type<"none" | "bearer" | "header">().notNull().default("none"),
    headerName: text("header_name"),
    secretEnc: text("secret_enc"),
    allowedTools: text("allowed_tools").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("connectors_user_name").on(table.userId, table.name)],
);

export type JobKind = "agent_run" | "trigger_poll" | "knowledge_index";
export type JobStatus = "queued" | "running" | "done" | "failed" | "dead";

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<JobKind>().notNull(),
  payload: jsonb("payload").notNull().default({}),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lockedBy: text("locked_by"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  dedupeKey: text("dedupe_key").unique(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TriggerKind = "cron" | "webhook" | "rss" | "watch" | "agent_completed";

export const agentTriggers = pgTable("agent_triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  kind: text("kind").$type<TriggerKind>().notNull(),
  name: text("name").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  config: jsonb("config").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastState: jsonb("last_state").notNull().default({}),
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationKind =
  | "run_completed"
  | "needs_approval"
  | "needs_input"
  | "run_failed"
  | "budget_exceeded";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  threadId: uuid("thread_id").references(() => threads.id, { onDelete: "set null" }),
  kind: text("kind").$type<NotificationKind>().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentWorkspaces = pgTable("agent_workspaces", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  containerName: text("container_name").notNull(),
  status: text("status").notNull().default("stopped"),
  /** Una persona conduce el navegador: la política deniega al agente sus herramientas de navegador. */
  humanControl: boolean("human_control").notNull().default(false),
  volume: text("volume").notNull(),
  tokenEnc: text("token_enc"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threadShares = pgTable("thread_shares", {
  slug: text("slug").primaryKey(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  uptoMessageId: uuid("upto_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

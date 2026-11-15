#!/usr/bin/env node
// Migraciones idempotentes del MVP (DDL crudo, sin drizzle-kit).
import postgres from "postgres";
import { migrateSkills } from "./skills-migration.mjs";

const url =
  process.env.DATABASE_URL ?? "postgres://plexo:plexo@localhost:5432/plexo";

// onnotice: los `IF NOT EXISTS` avisan de lo que ya existe en cada arranque; es ruido.
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS credentials (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL,
      model text NOT NULL,
      api_key_enc text,
      base_url text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL DEFAULT 'Nuevo chat',
      hermes_session_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      sources jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS threads_user_idx ON threads (user_id, updated_at)`;

  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS tools jsonb`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS usage jsonb`;

  // --- Ola 0: runs durables, auditoría y aprobaciones -----------------------

  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'running',
      agent_session_id text,
      lease_until timestamptz,
      heartbeat_at timestamptz,
      last_seq integer NOT NULL DEFAULT 0,
      prompt text,
      error text,
      usage jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS runs_thread_idx ON runs (thread_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS runs_live_idx ON runs (status, lease_until)`;

  await sql`
    CREATE TABLE IF NOT EXISTS run_events (
      run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      seq integer NOT NULL,
      type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, seq)
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS action_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
      run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
      tool text NOT NULL,
      kind text NOT NULL,
      effect text NOT NULL,
      rule text NOT NULL,
      reason text,
      target jsonb,
      args jsonb,
      result jsonb,
      duration_ms integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS audit_user_idx ON action_audit (user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS approvals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool text NOT NULL,
      args jsonb,
      rule text NOT NULL,
      reason text,
      status text NOT NULL DEFAULT 'pending',
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS approvals_pending_idx ON approvals (user_id, status, created_at DESC)`;

  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS run_id uuid`;

  // --- Fase 1: runs desacoplados del request y partes ordenadas -------------

  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS initiator text NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS backend text`;
  // agent_id / agent_version_id / trigger_id apuntarán a tablas de fases
  // posteriores; hasta entonces son uuid sueltos, sin FK.
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS agent_id uuid`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS agent_version_id uuid`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS parent_run_id uuid`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS trigger_id uuid`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS outcome jsonb`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS parts jsonb`;

  // --- Fase 3/4: motor nas-adk, pausas reanudables y follow-ups -------------

  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS backend text`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS followups jsonb`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS checkpoint jsonb`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_id uuid`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS superseded_at timestamptz`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id uuid`;

  // --- Fase 2: valoraciones y búsqueda de hilos ---------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS message_feedback (
      message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating integer NOT NULL CHECK (rating IN (-1, 1)),
      comment text,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS messages_live_idx ON messages (thread_id, created_at) WHERE superseded_at IS NULL`;

  // --- Fase 5: credenciales por proveedor -----------------------------------
  // La clave primaria pasa de user_id a un id propio para admitir varios
  // proveedores por usuario. Es idempotente y conserva las filas existentes.

  await sql`ALTER TABLE credentials ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid()`;
  await sql`ALTER TABLE credentials ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT true`;
  const [credentialsKey] = await sql`
    SELECT array_agg(a.attname::text) AS cols
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'credentials'::regclass AND i.indisprimary`;
  if (!credentialsKey.cols?.includes("id")) {
    await sql`UPDATE credentials SET id = gen_random_uuid() WHERE id IS NULL`;
    await sql`ALTER TABLE credentials DROP CONSTRAINT credentials_pkey`;
    await sql`ALTER TABLE credentials ALTER COLUMN id SET NOT NULL`;
    await sql`ALTER TABLE credentials ADD PRIMARY KEY (id)`;
  }
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credentials_user_provider_idx') THEN
        ALTER TABLE credentials ADD CONSTRAINT credentials_user_provider_idx UNIQUE (user_id, provider);
      END IF;
    END $$`;

  // Varios proveedores activos a la vez, cada uno con su lista de modelos visibles.
  // `model` queda como el modelo predeterminado del proveedor.
  await sql`ALTER TABLE credentials ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE credentials ADD COLUMN IF NOT EXISTS models jsonb`;
  await sql`UPDATE credentials SET models = jsonb_build_array(model) WHERE models IS NULL AND model <> ''`;

  // --- Fases 5 a 8: agentes, conocimiento, autonomía y compartir ------------

  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug text NOT NULL,
      name text NOT NULL,
      avatar text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      current_version_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (owner_id, slug)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS agents_public_idx ON agents (visibility, updated_at DESC)`;

  // Las versiones son inmutables: un run fija la versión con la que arrancó.
  await sql`
    CREATE TABLE IF NOT EXISTS agent_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version integer NOT NULL,
      spec jsonb NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (agent_id, version)
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name text NOT NULL,
      mime text,
      size integer NOT NULL DEFAULT 0,
      sha256 text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexed', 'error')),
      error text,
      text_chars integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (agent_id, sha256)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      file_id uuid NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      ordinal integer NOT NULL,
      content text NOT NULL,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
    )`;
  await sql`CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx ON knowledge_chunks USING GIN (tsv)`;
  await sql`CREATE INDEX IF NOT EXISTS knowledge_chunks_agent_idx ON knowledge_chunks (agent_id, file_id, ordinal)`;

  await sql`
    CREATE TABLE IF NOT EXISTS memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
      key text NOT NULL,
      value text NOT NULL,
      evidence text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS memories_live_key_idx
    ON memories (user_id, COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
    WHERE deleted_at IS NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS connectors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'mcp',
      name text NOT NULL,
      url text NOT NULL,
      transport text NOT NULL DEFAULT 'streamable-http' CHECK (transport IN ('streamable-http', 'sse')),
      auth_type text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header')),
      header_name text,
      secret_enc text,
      allowed_tools text[],
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, name)
    )`;

  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS agent_id uuid`;
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS group_id uuid`;
  await sql`CREATE INDEX IF NOT EXISTS runs_agent_idx ON runs (agent_id, created_at DESC)`;

  // Cola de trabajos (Postgres + SKIP LOCKED): runs programados, sondeo de disparadores…
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}',
      run_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'dead')),
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 3,
      locked_by text,
      locked_until timestamptz,
      dedupe_key text UNIQUE,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs (run_at) WHERE status = 'queued'`;

  await sql`
    CREATE TABLE IF NOT EXISTS agent_triggers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('cron', 'webhook', 'rss', 'watch', 'agent_completed')),
      name text NOT NULL DEFAULT '',
      prompt text NOT NULL DEFAULT '',
      config jsonb NOT NULL DEFAULT '{}',
      enabled boolean NOT NULL DEFAULT true,
      next_run_at timestamptz,
      last_run_at timestamptz,
      last_state jsonb NOT NULL DEFAULT '{}',
      failure_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS agent_triggers_due_idx ON agent_triggers (next_run_at) WHERE enabled`;

  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
      run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
      thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
      kind text NOT NULL,
      title text NOT NULL,
      body text NOT NULL DEFAULT '',
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS agent_workspaces (
      agent_id uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      container_name text NOT NULL,
      status text NOT NULL DEFAULT 'stopped',
      volume text NOT NULL,
      token_enc text,
      last_active_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS thread_shares (
      slug text PRIMARY KEY,
      thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      upto_message_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    )`;
  await sql`CREATE INDEX IF NOT EXISTS thread_shares_thread_idx ON thread_shares (thread_id)`;

  await sql`ALTER TABLE approvals ADD COLUMN IF NOT EXISTS tool_call_id text`;
  // «Persona al mando»: mientras está activo, el agente no puede usar el navegador.
  await sql`ALTER TABLE agent_workspaces ADD COLUMN IF NOT EXISTS human_control boolean NOT NULL DEFAULT false`;

  // Proyectos (carpetas de chats) y chats fijados. Borrar un proyecto conserva sus chats.
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id, updated_at DESC)`;
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS pinned_at timestamptz`;
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL`;
  await sql`CREATE INDEX IF NOT EXISTS threads_project_idx ON threads (project_id) WHERE project_id IS NOT NULL`;

  // Hermes se retiró: nas-adk es el único motor. `hermes_session_id` se conserva
  // (sin uso) para poder volver atrás; se borrará en una migración posterior.
  await sql`UPDATE threads SET backend = 'nas-adk' WHERE backend = 'hermes'`;

  // Usuarios gestionados por admins: no hay registro libre.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_use_claude_code boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`;

  // Control por cuenta (permisos, modelos, cupo) y configuración de la instancia.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS access jsonb NOT NULL DEFAULT '{}'::jsonb`;
  await sql`
    CREATE TABLE IF NOT EXISTS instance_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

  // Cuentas con rol fijado por entorno en cada arranque (así se recupera el acceso).
  // NEXUS_ADMIN_EMAILS solo asciende: nunca rebaja a un superadmin.
  const emailsFrom = (name) =>
    (process.env[name] ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  const superadminEmails = emailsFrom("NEXUS_SUPERADMIN_EMAILS");
  if (superadminEmails.length > 0) {
    await sql`UPDATE users SET role = 'superadmin' WHERE lower(email) IN ${sql(superadminEmails)}`;
  }
  const adminEmails = emailsFrom("NEXUS_ADMIN_EMAILS");
  if (adminEmails.length > 0) {
    await sql`UPDATE users SET role = 'admin' WHERE lower(email) IN ${sql(adminEmails)} AND role = 'user'`;
  }
  // Instalaciones anteriores al rol: el admin más antiguo pasa a superadmin.
  await sql`
    UPDATE users SET role = 'superadmin'
    WHERE id = (SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL ORDER BY created_at LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'superadmin' AND disabled_at IS NULL)`;
  const [{ total, superadmins }] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE role = 'superadmin' AND disabled_at IS NULL)::int AS superadmins
    FROM users`;
  if (total > 0 && superadmins === 0) {
    console.warn("[nexus] AVISO: no hay ningún superadmin activo. Define NEXUS_SUPERADMIN_EMAILS con el correo de una cuenta.");
  }

  // NexBots: identidad y configuración. El entorno lo gestiona sandboxd.
  await sql`
    CREATE TABLE IF NOT EXISTS bots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug text NOT NULL,
      name text NOT NULL,
      avatar text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      instructions text NOT NULL DEFAULT '',
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      desired_state text NOT NULL DEFAULT 'stopped',
      status text NOT NULL DEFAULT 'stopped',
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT bots_owner_slug UNIQUE (owner_id, slug)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_agents (
      bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      is_default boolean NOT NULL DEFAULT false,
      PRIMARY KEY (bot_id, agent_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      input jsonb NOT NULL DEFAULT '{}'::jsonb,
      result jsonb,
      artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
      error text,
      run_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`;
  await sql`CREATE INDEX IF NOT EXISTS bot_tasks_bot_created_idx ON bot_tasks (bot_id, created_at DESC)`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS bot_id uuid`;

  // Panel de usuarios: sesiones con origen, notas y registro de acciones de admin.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note text`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip text`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      actor_email text NOT NULL,
      target_id uuid REFERENCES users(id) ON DELETE SET NULL,
      target_email text,
      action text NOT NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit (target_id, created_at DESC)`;

  // Salas de NexBots: foro con hilos que son también tarjetas del tablero.
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS bot_id uuid`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS notice jsonb`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reasoning text`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS computer boolean NOT NULL DEFAULT false`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      limits jsonb NOT NULL DEFAULT '{}'::jsonb,
      mixed_network_ack boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_room_members (
      room_id uuid NOT NULL REFERENCES bot_rooms(id) ON DELETE CASCADE,
      bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (room_id, bot_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS room_topics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES bot_rooms(id) ON DELETE CASCADE,
      thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      title text NOT NULL,
      status text NOT NULL DEFAULT 'todo',
      assignee_bot_id uuid REFERENCES bots(id) ON DELETE SET NULL,
      parent_topic_id uuid,
      created_by_bot_id uuid,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS room_topics_room_idx ON room_topics (room_id, updated_at DESC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS room_topics_thread_idx ON room_topics (thread_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS room_topic_blockers (
      topic_id uuid NOT NULL REFERENCES room_topics(id) ON DELETE CASCADE,
      blocked_by_id uuid NOT NULL REFERENCES room_topics(id) ON DELETE CASCADE,
      PRIMARY KEY (topic_id, blocked_by_id),
      CHECK (topic_id <> blocked_by_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS room_turns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      topic_id uuid NOT NULL REFERENCES room_topics(id) ON DELETE CASCADE,
      bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      round_id uuid NOT NULL,
      hop integer NOT NULL DEFAULT 0,
      reason text NOT NULL DEFAULT 'mention',
      trigger_message_id uuid,
      parent_run_id uuid,
      status text NOT NULL DEFAULT 'queued',
      run_id uuid,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  // Estos tres índices son la garantía: un turno activo por hilo, un run de sala por bot
  // y ningún turno duplicado en cola, pase lo que pase en la aplicación.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS room_turns_one_active_per_topic
    ON room_turns (topic_id) WHERE status IN ('running', 'awaiting')`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS room_turns_one_active_per_bot
    ON room_turns (bot_id) WHERE status IN ('running', 'awaiting')`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS room_turns_one_queued_per_bot_topic
    ON room_turns (topic_id, bot_id) WHERE status = 'queued'`;
  await sql`CREATE INDEX IF NOT EXISTS room_turns_topic_idx ON room_turns (topic_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS room_turns_run_idx ON room_turns (run_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS room_activity (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid NOT NULL REFERENCES bot_rooms(id) ON DELETE CASCADE,
      topic_id uuid,
      actor_user_id uuid,
      actor_bot_id uuid,
      run_id uuid,
      action text NOT NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS room_activity_room_idx ON room_activity (room_id, created_at DESC)`;
  // Una tarea de ordenador activa por bot, también a nivel de base de datos.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bot_tasks_one_computer_per_bot
    ON bot_tasks (bot_id) WHERE kind = 'computer' AND status IN ('queued', 'running', 'awaiting_approval')`;

  // Un run que quedó `running` cuando el proceso murió nunca terminó: se
  // reconcilia al arrancar en vez de dejar la UI en un spinner eterno.
  await sql`
    UPDATE runs
    SET status = 'interrupted', lease_until = NULL, updated_at = now()
    WHERE status = 'running' AND (lease_until IS NULL OR lease_until < now())`;

  await migrateSkills(sql);
  console.log("[nexus] migraciones aplicadas");
} finally {
  await sql.end();
}

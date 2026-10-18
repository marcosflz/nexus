#!/usr/bin/env node
// Migraciones idempotentes del MVP (DDL crudo, sin drizzle-kit).
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ?? "postgres://plexo:plexo@localhost:5432/plexo";

const sql = postgres(url, { max: 1 });

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

  // Un run que quedó `running` cuando el proceso murió nunca terminó: se
  // reconcilia al arrancar en vez de dejar la UI en un spinner eterno.
  await sql`
    UPDATE runs
    SET status = 'interrupted', lease_until = NULL, updated_at = now()
    WHERE status = 'running' AND (lease_until IS NULL OR lease_until < now())`;

  console.log("[plexo] migraciones aplicadas");
} finally {
  await sql.end();
}

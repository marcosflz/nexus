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

  console.log("[plexo] migraciones aplicadas");
} finally {
  await sql.end();
}

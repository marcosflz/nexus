/** One-time product transition. Does not touch Nexbot volumes or unrelated chats. */
export async function migrateSkills(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE bots ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT '';
    ALTER TABLE bots ADD COLUMN IF NOT EXISTS execution jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE bots ADD COLUMN IF NOT EXISTS environment_enabled boolean NOT NULL DEFAULT true;
    ALTER TABLE bots ALTER COLUMN environment_enabled SET DEFAULT false;
    ALTER TABLE bots ADD COLUMN IF NOT EXISTS skill_ids jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE bots ADD COLUMN IF NOT EXISTS current_version_id uuid;
    ALTER TABLE threads ADD COLUMN IF NOT EXISTS bot_id uuid;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS runtime_snapshot jsonb;
    CREATE TABLE IF NOT EXISTS bot_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      version integer NOT NULL, spec jsonb NOT NULL, skill_ids jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bot_id,version));
    CREATE TABLE IF NOT EXISTS skills (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL, description text NOT NULL, current_version_id uuid, gallery_version_id uuid,
      enabled_in_chat boolean NOT NULL DEFAULT true, source jsonb NOT NULL DEFAULT '{}', deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS skills_owner_name ON skills(owner_id,name) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS skill_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      version integer NOT NULL, package jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(skill_id,version));
    CREATE TABLE IF NOT EXISTS skill_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_id uuid REFERENCES skills(id) ON DELETE SET NULL, thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      files jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS skill_tests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES skill_drafts(id) ON DELETE CASCADE,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, package jsonb NOT NULL, input text NOT NULL,
      expected text NOT NULL DEFAULT '', run_id uuid, created_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE skill_drafts ADD COLUMN IF NOT EXISTS base_version_id uuid;
    ALTER TABLE skill_drafts ADD COLUMN IF NOT EXISTS source jsonb NOT NULL DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS bot_triggers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      kind text NOT NULL, name text NOT NULL DEFAULT '', prompt text NOT NULL DEFAULT '', config jsonb NOT NULL DEFAULT '{}',
      enabled boolean NOT NULL DEFAULT true, next_run_at timestamptz, last_run_at timestamptz,
      failure_count integer NOT NULL DEFAULT 0, last_error text, last_state jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS bot_triggers_due ON bot_triggers(next_run_at) WHERE enabled;
    CREATE TABLE IF NOT EXISTS bot_knowledge_files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name text NOT NULL, mime text, size integer NOT NULL DEFAULT 0,
      sha256 text NOT NULL, status text NOT NULL DEFAULT 'pending', error text, text_chars integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bot_id,sha256));
    CREATE TABLE IF NOT EXISTS bot_knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), file_id uuid NOT NULL REFERENCES bot_knowledge_files(id) ON DELETE CASCADE,
      bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE, ordinal integer NOT NULL, content text NOT NULL,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED);
    CREATE INDEX IF NOT EXISTS bot_knowledge_search ON bot_knowledge_chunks USING gin(tsv);
    CREATE TABLE IF NOT EXISTS bot_memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id uuid REFERENCES bots(id) ON DELETE CASCADE, key text NOT NULL, value text NOT NULL, deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS retired_agent_workspaces (agent_id uuid PRIMARY KEY);
  `);
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('nexus-skills-transition'))`;
    const applied = await tx`SELECT id FROM app_migrations WHERE id = 'skills-v1'`;
    if (applied.length) return;
    await tx.unsafe(`
      INSERT INTO retired_agent_workspaces SELECT agent_id FROM agent_workspaces ON CONFLICT DO NOTHING;
      UPDATE jobs SET status = 'dead', last_error = 'Retired agent configuration', updated_at = now()
        WHERE kind IN ('agent_run','trigger_poll','knowledge_index') AND status IN ('queued','running','failed');
      UPDATE runs SET status = 'interrupted', checkpoint = NULL, lease_until = NULL,
        error = 'La configuración de ejecución anterior se ha retirado', updated_at = now()
        WHERE (agent_id IS NOT NULL OR bot_id IS NOT NULL) AND status IN ('running','awaiting_input');
      UPDATE approvals SET status = 'denied', decided_at = now()
        WHERE status = 'pending' AND run_id IN (SELECT id FROM runs WHERE agent_id IS NOT NULL OR bot_id IS NOT NULL);
      INSERT INTO bot_memories (id,user_id,key,value,deleted_at,created_at,updated_at)
        SELECT id,user_id,key,value,deleted_at,created_at,updated_at FROM memories WHERE agent_id IS NULL ON CONFLICT DO NOTHING;
      UPDATE threads SET agent_id = NULL WHERE agent_id IS NOT NULL;
      DELETE FROM agents;
      UPDATE users SET access = jsonb_set(
        jsonb_set(coalesce(access,'{}'), '{permissions}', coalesce(access->'permissions','{}') - 'agents'),
        '{permissions}', (coalesce(access->'permissions','{}') - 'agents') ||
          CASE WHEN access->'permissions'->'agents' = 'false'::jsonb THEN '{"skills":false,"bots":false}'::jsonb ELSE '{}'::jsonb END);
      INSERT INTO app_migrations (id) VALUES ('skills-v1');
    `);
  });
}

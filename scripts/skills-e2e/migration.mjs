import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const url = process.env.SKILLS_MIGRATION_TEST_URL;
if (!url || !new URL(url).pathname.startsWith("/skills_migration_")) throw new Error("Use SKILLS_MIGRATION_TEST_URL with a disposable database named skills_migration_*");
const sql = postgres(url, { max: 1 });
const migrate = () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
try {
  migrate();
  const owner = randomUUID(), agent = randomUUID(), bot = randomUUID(), thread = randomUUID(), run = randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,access) VALUES (${owner},'migration@example.test','unused',${sql.json({ permissions: { agents: false }, modelAccess: null, monthlyTokenLimit: 1000 })})`;
  await sql`INSERT INTO agents(id,owner_id,slug,name) VALUES (${agent},${owner},'legacy','Legacy profile')`;
  await sql`INSERT INTO agent_workspaces(agent_id,container_name,volume) VALUES (${agent},'legacy-fixture','legacy-fixture')`;
  await sql`INSERT INTO bots(id,owner_id,slug,name,instructions,environment_enabled) VALUES (${bot},${owner},'preserved','Preserved bot','KEEP-IDENTITY',true)`;
  await sql`INSERT INTO threads(id,user_id,title,agent_id) VALUES (${thread},${owner},'Preserved history',${agent})`;
  await sql`INSERT INTO messages(thread_id,role,content) VALUES (${thread},'assistant','KEEP-HISTORY')`;
  await sql`INSERT INTO memories(user_id,agent_id,key,value) VALUES (${owner},NULL,'personal','KEEP-PERSONAL'),(${owner},${agent},'profile','REMOVE-PROFILE')`;
  await sql`INSERT INTO runs(id,thread_id,user_id,agent_id,status,checkpoint) VALUES (${run},${thread},${owner},${agent},'awaiting_input','[]'::jsonb)`;
  await sql`INSERT INTO jobs(kind,payload,status) VALUES ('agent_run',${sql.json({ agentId: agent })},'queued')`;
  await sql`DELETE FROM app_migrations WHERE id = 'skills-v1'`;
  migrate();
  assert.equal((await sql`SELECT count(*)::int AS n FROM agents`)[0].n, 0);
  assert.equal((await sql`SELECT instructions FROM bots WHERE id = ${bot}`)[0].instructions, "KEEP-IDENTITY");
  assert.equal((await sql`SELECT content FROM messages WHERE thread_id = ${thread}`)[0].content, "KEEP-HISTORY");
  assert.equal((await sql`SELECT value FROM bot_memories WHERE user_id = ${owner}`)[0].value, "KEEP-PERSONAL");
  assert.equal((await sql`SELECT status FROM runs WHERE id = ${run}`)[0].status, "interrupted");
  assert.equal((await sql`SELECT status FROM jobs WHERE kind = 'agent_run'`)[0].status, "dead");
  assert.equal((await sql`SELECT agent_id FROM retired_agent_workspaces WHERE agent_id = ${agent}`).length, 1);
  const access = (await sql`SELECT access FROM users WHERE id = ${owner}`)[0].access;
  assert.deepEqual(access.permissions, { skills: false, bots: false });
  assert.equal(access.monthlyTokenLimit, 1000);
  migrate();
  assert.equal((await sql`SELECT count(*)::int AS n FROM bot_memories WHERE user_id = ${owner}`)[0].n, 1);
  console.log("PASS: fresh/repeated migration, legacy profile removal, bot/history/personal memory preservation, permission mapping and interrupted legacy runs");
} finally { await sql.end(); }

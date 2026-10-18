import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://plexo:plexo@localhost:5432/plexo";

declare global {
  // eslint-disable-next-line no-var
  var __plexoSql: ReturnType<typeof postgres> | undefined;
}

const sql = globalThis.__plexoSql ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalThis.__plexoSql = sql;
}

export const db = drizzle(sql, { schema });
export const sqlClient = sql;

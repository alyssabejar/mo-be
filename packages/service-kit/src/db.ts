import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export type Database<S extends Record<string, unknown> = Record<string, unknown>> = NodePgDatabase<S>;
/** A transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type Tx<S extends Record<string, unknown> = Record<string, unknown>> = Parameters<Parameters<Database<S>["transaction"]>[0]>[0];
/** Either the database or a transaction on it. */
export type Queryable<S extends Record<string, unknown> = Record<string, unknown>> = Database<S> | Tx<S>;

// Return DATE columns as plain "YYYY-MM-DD" strings, never JS Dates shifted by the server zone.
pg.types.setTypeParser(1082, (v) => v);

export function openDatabase<S extends Record<string, unknown>>(url: string, schema: S) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function runMigrations(db: Database<any>, migrationsFolder: string) {
  await migrate(db, { migrationsFolder });
}

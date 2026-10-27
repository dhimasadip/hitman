import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export interface DatabaseOptions {
  url: string;
  maxConnections?: number;
  ssl?: boolean;
  connectTimeoutMs?: number;
  applicationName?: string;
  onPoolError?: (error: Error) => void;
}

export interface Database {
  readonly db: NodePgDatabase<typeof schema>;
  readonly pool: pg.Pool;
  check(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new Pool({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectTimeoutMs ?? 5_000,
    application_name: options.applicationName ?? "hitman",
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
  });

  // Prevent unhandled 'error' events from idle clients from crashing the process.
  pool.on("error", (error) => {
    options.onPoolError?.(error);
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async check(timeoutMs = 2_000) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          (async () => {
            const result = await db.execute(
              sql`select 1 from information_schema.tables
                  where table_schema = 'public'
                    and table_name = 'platform_schema_state'
                  limit 1`,
            );
            if ((result.rowCount ?? 0) === 0) {
              throw new Error("database schema baseline is not applied");
            }
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("database health check timed out")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async close() {
      await pool.end();
    },
  };
}

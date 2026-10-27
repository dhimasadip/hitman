import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

const defaultMigrationsFolder = fileURLToPath(
  new URL("../../../database/migrations", import.meta.url),
);

export interface MigrationOptions {
  url: string;
  ssl?: boolean;
  migrationsFolder?: string;
}

export async function runMigrations(options: MigrationOptions): Promise<void> {
  const database = createDatabase({
    url: options.url,
    maxConnections: 1,
    ssl: options.ssl ?? false,
    applicationName: "hitman-migrate",
  });

  try {
    await migrate(database.db, {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
    });
  } finally {
    await database.close();
  }
}

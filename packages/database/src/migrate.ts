import { runMigrations } from "./migrator.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  await runMigrations({
    url,
    ssl: process.env.DATABASE_SSL === "true",
  });
  process.stdout.write("Database migrations applied.\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
});

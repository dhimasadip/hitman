import { createDatabase, type Database, runMigrations } from "@hitman/database";
import { afterAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = testDatabaseUrl ? describe : describe.skip;

describeIntegration("PostgreSQL integration", () => {
  let database: Database | undefined;

  afterAll(async () => {
    await database?.close();
  });

  it("applies checked-in migrations to a disposable database", async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
    await runMigrations({ url: testDatabaseUrl });
    database = createDatabase({ url: testDatabaseUrl, maxConnections: 1 });
    await expect(database.check(2_000)).resolves.toBeUndefined();

    const result = await database.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = 'platform_schema_state'",
    );
    expect(result.rows[0]?.table_name).toBe("platform_schema_state");
  });
});

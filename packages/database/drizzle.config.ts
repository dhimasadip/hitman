import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "../../database/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://hitman@127.0.0.1:5433/hitman_dev",
  },
  strict: true,
  verbose: true,
});

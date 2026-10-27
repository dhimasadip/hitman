import { describe, expect, it } from "vitest";
import {
  EnvironmentSecretProvider,
  loadConfig,
  sanitizeError,
  sanitizeForLog,
} from "../src/index.js";

const validBase = {
  NODE_ENV: "test",
  APP_ENV: "test",
  DATABASE_URL: "postgres://hitman@127.0.0.1:5433/hitman_test",
};

describe("environment validation", () => {
  it("fails fast without required configuration", () => {
    expect(() => loadConfig("server", {})).toThrow(/DATABASE_URL/);
  });

  it("does not echo submitted values in validation errors", () => {
    try {
      loadConfig("server", {
        ...validBase,
        DATABASE_URL: "mysql://user:supersecret@example.test/db",
        LOG_LEVEL: "super-secret-log-level",
      });
      throw new Error("expected validation failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain("supersecret");
      expect(message).not.toContain("super-secret-log-level");
    }
  });

  it("warns when production settings are unsafe", () => {
    const { warnings } = loadConfig("server", {
      ...validBase,
      NODE_ENV: "production",
      APP_ENV: "production",
      DATABASE_SSL: "false",
    });
    expect(warnings.some((warning) => warning.includes("DATABASE_SSL"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("METRICS_TOKEN"))).toBe(true);
  });
});

describe("redaction", () => {
  it("redacts sensitive keys and URL credentials recursively", () => {
    const sanitized = sanitizeForLog({
      authorization: "Bearer very-secret",
      nested: {
        password: "hunter2",
        databaseUrl: "postgres://user:password@db:5432/hitman",
        safe: "visible",
        values: [{ token: "abc" }, { ok: true }],
      },
    }) as Record<string, unknown>;

    expect(sanitized.authorization).toBe("[REDACTED]");
    const nested = sanitized.nested as Record<string, unknown>;
    expect(nested.password).toBe("[REDACTED]");
    expect(nested.databaseUrl).toContain("[REDACTED]@db");
    expect(nested.safe).toBe("visible");
    expect(JSON.stringify(nested.values)).not.toContain("abc");
  });

  it("sanitizes errors without leaking secrets embedded in connection strings", () => {
    const safe = sanitizeError(new Error("failed: postgres://user:secret@db:5432/hitman"));
    expect(safe.message).toContain("[REDACTED]@db");
    expect(safe.message).not.toContain("secret");
  });
});

describe("environment secret provider", () => {
  it("resolves env:// references without exposing values in descriptions", async () => {
    const provider = new EnvironmentSecretProvider({ HITMAN_SECRET_X: "value-123" });
    await expect(provider.resolve("env://HITMAN_SECRET_X")).resolves.toBe("value-123");
    expect(provider.describe("env://HITMAN_SECRET_X")).toEqual({
      provider: "env",
      name: "HITMAN_SECRET_X",
    });
  });

  it("rejects unsupported schemes and missing values", async () => {
    const provider = new EnvironmentSecretProvider({});
    await expect(provider.resolve("vault://path/to/secret")).rejects.toThrow(
      /Unsupported secret reference/,
    );
    await expect(provider.resolve("env://MISSING_SECRET")).rejects.toThrow(/not configured/);
  });
});

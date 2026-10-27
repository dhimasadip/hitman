import {
  createLogger,
  createObjectStorage,
  createSecretProvider,
  loadConfig,
  type ServerConfig,
} from "@hitman/config";
import type { Database } from "@hitman/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const { config } = loadConfig("server", {
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_URL: "postgres://hitman@127.0.0.1:5433/hitman_test",
  });
  return { ...(config as ServerConfig), ...overrides };
}

function makeDatabase(check = vi.fn(async () => undefined)): Database {
  return {
    db: {} as Database["db"],
    pool: {} as Database["pool"],
    check,
    close: vi.fn(async () => undefined),
  };
}

const logger = createLogger({
  role: "server",
  service: "hitman-server-test",
  version: "0.1.0",
  commit: "test",
  level: "silent",
});

async function makeApp(options: { config?: Partial<ServerConfig>; database?: Database } = {}) {
  return buildApp({
    config: makeConfig(options.config),
    logger,
    database: options.database ?? makeDatabase(),
    secretProvider: createSecretProvider("env"),
    objectStorage: createObjectStorage("disabled"),
    metadata: { version: "0.1.0", commit: "test", builtAt: null },
  });
}

describe("server health endpoints", () => {
  const apps: Awaited<ReturnType<typeof makeApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("reports liveness", async () => {
    const app = await makeApp();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.role).toBe("server");
    expect(body.checks).toEqual([]);
  });

  it("reports readiness when PostgreSQL is reachable", async () => {
    const app = await makeApp();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json().checks[0]).toMatchObject({ name: "postgres", status: "ok" });
  });

  it("fails readiness when PostgreSQL is unreachable", async () => {
    const database = makeDatabase(
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const app = await makeApp({ database });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe("error");
    expect(body.checks[0].name).toBe("postgres");
  });
});

describe("request correlation and errors", () => {
  const apps: Awaited<ReturnType<typeof makeApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("returns a request id header and error envelope for unknown routes", async () => {
    const app = await makeApp();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(response.statusCode).toBe(404);
    const requestId = response.headers["x-request-id"];
    expect(typeof requestId).toBe("string");
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId,
      },
    });
  });

  it("preserves a valid caller-supplied request id", async () => {
    const app = await makeApp();
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-request-id": "req.caller-1234" },
    });
    expect(response.headers["x-request-id"]).toBe("req.caller-1234");
  });
});

describe("metrics endpoint", () => {
  const apps: Awaited<ReturnType<typeof makeApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("is open locally when no token is configured", async () => {
    const app = await makeApp();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("hitman_http_requests_total");
  });

  it("requires the configured bearer token", async () => {
    const app = await makeApp({ config: { METRICS_TOKEN: "0123456789abcdef" } });
    apps.push(app);
    const unauthorized = await app.inject({ method: "GET", url: "/metrics" });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer 0123456789abcdef" },
    });
    expect(authorized.statusCode).toBe(200);
  });
});

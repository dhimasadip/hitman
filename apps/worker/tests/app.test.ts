import { createLogger, loadConfig, type WorkerConfig } from "@hitman/config";
import type { Database } from "@hitman/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorkerApp } from "../src/app.js";

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  const { config } = loadConfig("worker", {
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_URL: "postgres://hitman@127.0.0.1:5433/hitman_test",
  });
  return { ...(config as WorkerConfig), ...overrides };
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
  role: "worker",
  service: "hitman-worker-test",
  version: "0.1.0",
  commit: "test",
  level: "silent",
});

async function makeWorker(options: { config?: Partial<WorkerConfig>; database?: Database } = {}) {
  return buildWorkerApp({
    config: makeConfig(options.config),
    logger,
    database: options.database ?? makeDatabase(),
    metadata: { version: "0.1.0", commit: "test", builtAt: null },
  });
}

describe("worker health endpoints", () => {
  const apps: Awaited<ReturnType<typeof makeWorker>>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("reports liveness and readiness", async () => {
    const app = await makeWorker();
    apps.push(app);
    const live = await app.inject({ method: "GET", url: "/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.json().role).toBe("worker");

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks[0]).toMatchObject({ name: "postgres", status: "ok" });
  });

  it("becomes unready when the database check fails", async () => {
    const database = makeDatabase(
      vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    );
    const app = await makeWorker({ database });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("error");
  });

  it("exposes worker metrics with token protection", async () => {
    const app = await makeWorker({ config: { METRICS_TOKEN: "0123456789abcdef" } });
    apps.push(app);
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    const authorized = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer 0123456789abcdef" },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).toContain("hitman_worker_up");
  });
});

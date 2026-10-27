import { timingSafeEqual } from "node:crypto";
import { isProductionLike, type Logger, type WorkerConfig } from "@hitman/config";
import {
  ApiError,
  apiErrorEnvelopeSchema,
  type HealthCheck,
  type HealthResponse,
} from "@hitman/contracts";
import type { Database } from "@hitman/database";
import Fastify, { type FastifyRequest } from "fastify";
import { Counter, collectDefaultMetrics, Gauge, Registry } from "prom-client";

export interface WorkerAppDependencies {
  config: WorkerConfig;
  logger: Logger;
  database: Database;
  metadata: {
    version: string;
    commit: string;
    builtAt: string | null;
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function metricsAuthorized(request: FastifyRequest, token: string | undefined): boolean {
  if (!token) return true;
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return safeEqual(header.slice(7), token);
  }
  const metricsToken = request.headers["x-metrics-token"];
  return typeof metricsToken === "string" && safeEqual(metricsToken, token);
}

async function runCheck(
  name: string,
  check: () => Promise<void>,
  timeoutMs: number,
): Promise<HealthCheck> {
  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("check timed out")), timeoutMs);
      }),
    ]);
    return { name, status: "ok", latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return {
      name,
      status: "error",
      latencyMs: Math.round(performance.now() - startedAt),
      message: "dependency check failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildWorkerApp(deps: WorkerAppDependencies) {
  const { config } = deps;
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 64 * 1024 });

  const registry = new Registry();
  registry.setDefaultLabels({ service: "hitman-worker", version: deps.metadata.version });
  collectDefaultMetrics({ register: registry, prefix: "hitman_" });
  const workerUp = new Gauge({
    name: "hitman_worker_up",
    help: "Worker process liveness",
    registers: [registry],
  });
  const workerPollCycles = new Counter({
    name: "hitman_worker_poll_cycles_total",
    help: "Worker scheduling cycles executed",
    registers: [registry],
  });
  workerUp.set(1);
  workerMetrics.set(app, workerPollCycles);

  const metricsEnabled =
    config.METRICS_ENABLED && (!isProductionLike(config) || Boolean(config.METRICS_TOKEN));

  app.setErrorHandler((error: unknown, request, reply) => {
    const apiError =
      error instanceof ApiError
        ? error
        : (() => {
            request.log.error({ err: error }, "unhandled worker health error");
            return ApiError.internal();
          })();
    void reply.status(apiError.statusCode).send(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: apiError.code,
          message: apiError.message,
          requestId: request.id,
        },
      }),
    );
  });

  app.get("/health/live", async () => {
    const body: HealthResponse = {
      status: "ok",
      service: "hitman-worker",
      role: "worker",
      version: deps.metadata.version,
      commit: deps.metadata.commit,
      uptimeSeconds: process.uptime(),
      checks: [],
      timestamp: new Date().toISOString(),
    };
    return body;
  });

  app.get("/health/ready", async (_request, reply) => {
    const check = await runCheck(
      "postgres",
      () => deps.database.check(config.DB_HEALTH_TIMEOUT_MS),
      config.DB_HEALTH_TIMEOUT_MS,
    );
    const status = check.status === "ok" ? "ok" : "error";
    const body: HealthResponse = {
      status,
      service: "hitman-worker",
      role: "worker",
      version: deps.metadata.version,
      commit: deps.metadata.commit,
      uptimeSeconds: process.uptime(),
      checks: [check],
      timestamp: new Date().toISOString(),
    };
    return reply.status(status === "ok" ? 200 : 503).send(body);
  });

  app.get("/version", async () => ({
    name: "hitman-worker",
    version: deps.metadata.version,
    commit: deps.metadata.commit,
    builtAt: deps.metadata.builtAt,
    nodeVersion: process.version,
    role: "worker" as const,
  }));

  if (metricsEnabled) {
    app.get("/metrics", async (request, reply) => {
      if (!metricsAuthorized(request, config.METRICS_TOKEN)) {
        const error = ApiError.unauthorized("Metrics authentication required");
        return reply.status(401).send(
          apiErrorEnvelopeSchema.parse({
            error: { code: error.code, message: error.message, requestId: request.id },
          }),
        );
      }
      reply.header("content-type", registry.contentType);
      return reply.send(await registry.metrics());
    });
  }

  return app;
}

const workerMetrics = new WeakMap<object, Counter>();

export function recordWorkerPoll(app: object): void {
  workerMetrics.get(app)?.inc();
}

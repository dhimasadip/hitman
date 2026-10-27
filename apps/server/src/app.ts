import { randomUUID, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  buildInfo,
  isProductionLike,
  type Logger,
  type ObjectStorage,
  type SecretProvider,
  type ServerConfig,
} from "@hitman/config";
import {
  ApiError,
  apiErrorEnvelopeSchema,
  type HealthCheck,
  type HealthResponse,
  requestIdHeader,
  requestIdSchema,
} from "@hitman/contracts";
import type { Database } from "@hitman/database";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";
import { registerCollectionRoutes } from "./modules/catalog/collection-routes.js";
import { registerRequestRoutes } from "./modules/catalog/request-routes.js";
import { registerSpecificationRoutes } from "./modules/catalog/spec-routes.js";
import { registerAuthRoutes } from "./modules/identity/auth-routes.js";
import { createIdentityServices } from "./modules/identity/services.js";
import { registerOrganizationRoutes } from "./modules/organizations/organization-routes.js";
import { registerProjectRoutes } from "./modules/projects/project-routes.js";
import { registerAuthPlugin } from "./plugins/auth.js";

export interface AppDependencies {
  config: ServerConfig;
  logger: Logger;
  database: Database;
  secretProvider: SecretProvider;
  objectStorage: ObjectStorage;
  metadata: {
    version: string;
    commit: string;
    builtAt: string | null;
  };
}

interface Metrics {
  registry: Registry;
  requests: Counter<"method" | "route" | "status">;
  duration: Histogram<"method" | "route">;
}

function createMetrics(service: string, version: string): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service, version });
  collectDefaultMetrics({ register: registry, prefix: "hitman_" });

  const requests = new Counter({
    name: "hitman_http_requests_total",
    help: "Total HTTP requests handled",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  });

  const duration = new Histogram({
    name: "hitman_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  return { registry, requests, duration };
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

function errorEnvelope(error: ApiError, requestId: string) {
  return apiErrorEnvelopeSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
    },
  });
}

async function runHealthCheck(
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
    return {
      name,
      status: "ok",
      latencyMs: Math.round(performance.now() - startedAt),
    };
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

export async function buildApp(deps: AppDependencies) {
  const { config } = deps;
  const app = Fastify({
    loggerInstance: deps.logger,
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
    requestIdHeader,
    genReqId: (request) => {
      const candidate = request.headers[requestIdHeader];
      if (typeof candidate === "string") {
        const parsed = requestIdSchema.safeParse(candidate);
        if (parsed.success) return parsed.data;
      }
      return randomUUID();
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
  });

  const identity = createIdentityServices(deps.database.db, config, deps.logger);
  const routeApp = app as unknown as FastifyInstance;
  registerAuthPlugin(routeApp, { sessions: identity.sessions, config });
  await registerAuthRoutes(routeApp, { config, auth: identity.auth });
  await registerOrganizationRoutes(routeApp, {
    config,
    organizations: identity.organizations,
  });
  await registerProjectRoutes(routeApp, { config, projects: identity.projects });
  await registerSpecificationRoutes(routeApp, {
    config,
    specifications: identity.specifications,
  });
  await registerCollectionRoutes(routeApp, { config, collections: identity.collections });
  await registerRequestRoutes(routeApp, { config, requests: identity.requests });

  const metrics = createMetrics("hitman-server", deps.metadata.version);
  const metricsEnabled =
    config.METRICS_ENABLED && (!isProductionLike(config) || Boolean(config.METRICS_TOKEN));
  const metricsToken = config.METRICS_TOKEN;

  app.addHook("onRequest", async (request, reply) => {
    reply.header(requestIdHeader, request.id);
    request.log = request.log.child({ requestId: request.id });
    if (metricsEnabled && request.url !== "/metrics") {
      (request as FastifyRequest & { metricsStart?: bigint }).metricsStart =
        process.hrtime.bigint();
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!metricsEnabled || request.url === "/metrics") return;
    const route = request.routeOptions.url ?? "unknown";
    metrics.requests.inc({ method: request.method, route, status: String(reply.statusCode) });
    const started = (request as FastifyRequest & { metricsStart?: bigint }).metricsStart;
    if (started !== undefined) {
      metrics.duration.observe(
        { method: request.method, route },
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    let apiError: ApiError;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (error instanceof Error) {
      const statusCode =
        "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
      if (statusCode === 400) {
        apiError = ApiError.badRequest("Malformed request");
      } else if (statusCode === 401) {
        apiError = ApiError.unauthorized();
      } else if (statusCode === 403) {
        apiError = ApiError.forbidden();
      } else if (statusCode === 404) {
        apiError = ApiError.notFound();
      } else if (statusCode === 409) {
        apiError = ApiError.conflict();
      } else if (statusCode === 413) {
        apiError = new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large", 413);
      } else if (statusCode === 429) {
        apiError = new ApiError("RATE_LIMITED", "Too many requests. Try again later.", 429);
      } else {
        request.log.error({ err: error }, "unhandled request error");
        apiError = ApiError.internal();
      }
    } else {
      request.log.error({ err: error }, "unhandled request error");
      apiError = ApiError.internal();
    }

    if (apiError.statusCode >= 500) {
      request.log.error({ err: error, code: apiError.code }, "request failed");
    } else {
      request.log.warn(
        { code: apiError.code, statusCode: apiError.statusCode },
        "request rejected",
      );
    }

    void reply.status(apiError.statusCode).send(errorEnvelope(apiError, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const error = ApiError.notFound("Route not found");
    void reply.status(404).send(errorEnvelope(error, request.id));
  });

  app.get("/health/live", async (_request, reply) => {
    const body: HealthResponse = {
      status: "ok",
      service: "hitman-server",
      role: "server",
      version: deps.metadata.version,
      commit: deps.metadata.commit,
      uptimeSeconds: process.uptime(),
      checks: [],
      timestamp: new Date().toISOString(),
    };
    return reply.status(200).send(body);
  });

  app.get("/health/ready", async (_request, reply) => {
    const check = await runHealthCheck(
      "postgres",
      () => deps.database.check(config.DB_HEALTH_TIMEOUT_MS),
      config.DB_HEALTH_TIMEOUT_MS,
    );
    const status = check.status === "ok" ? "ok" : "error";
    const body: HealthResponse = {
      status,
      service: "hitman-server",
      role: "server",
      version: deps.metadata.version,
      commit: deps.metadata.commit,
      uptimeSeconds: process.uptime(),
      checks: [check],
      timestamp: new Date().toISOString(),
    };
    return reply.status(status === "ok" ? 200 : 503).send(body);
  });

  app.get("/version", async () => ({
    ...buildInfo("hitman-server", {
      version: deps.metadata.version,
      commit: deps.metadata.commit,
      builtAt: deps.metadata.builtAt,
    }),
    role: "server" as const,
  }));

  if (metricsEnabled) {
    app.get("/metrics", async (request, reply) => {
      if (!metricsAuthorized(request, metricsToken)) {
        const error = ApiError.unauthorized("Metrics authentication required");
        return reply.status(401).send(errorEnvelope(error, request.id));
      }
      reply.header("content-type", metrics.registry.contentType);
      return reply.send(await metrics.registry.metrics());
    });
  }

  app.get("/api/v1/meta", async () => ({
    product: "Hitman",
    role: "server" as const,
    version: deps.metadata.version,
    commit: deps.metadata.commit,
    appEnv: config.APP_ENV,
    secretProvider: deps.secretProvider.kind,
    objectStorage: deps.objectStorage.kind,
  }));

  return app;
}

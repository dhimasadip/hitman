import type { ServiceRole } from "@hitman/contracts";
import { z } from "zod";

const booleanFromString = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  ctx.addIssue({
    code: "custom",
    message: "Expected one of true/false, 1/0, yes/no, on/off",
  });
  return z.NEVER;
});

const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const appEnvironmentSchema = z.enum(["local", "development", "staging", "production", "test"]);

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: appEnvironmentSchema.default("local"),
  LOG_LEVEL: logLevelSchema.default("info"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// URL",
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_SSL: booleanFromString.default(false),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DB_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  SERVICE_VERSION: z.string().min(1).default("0.1.0"),
  GIT_COMMIT: z.string().min(1).default("unknown"),
  BUILD_TIME: z.string().min(1).default("unknown"),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SECRET_PROVIDER: z.enum(["env"]).default("env"),
  OBJECT_STORAGE_DRIVER: z.enum(["disabled"]).default("disabled"),
});

const serverEnvSchema = baseEnvSchema.extend({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  METRICS_ENABLED: booleanFromString.default(true),
  METRICS_TOKEN: z.string().min(16).optional(),
  TRUST_PROXY: booleanFromString.default(false),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(30 * 24 * 60 * 60)
    .default(7 * 24 * 60 * 60),
  SESSION_COOKIE_NAME: z.string().min(1).max(64).default("hitman_session"),
  CSRF_COOKIE_NAME: z.string().min(1).max(64).default("hitman_csrf"),
  COOKIE_SECURE: booleanFromString.optional(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1_000).default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().max(3_600).default(60),
});

const workerEnvSchema = baseEnvSchema.extend({
  WORKER_HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  METRICS_ENABLED: booleanFromString.default(true),
  METRICS_TOKEN: z.string().min(16).optional(),
});

export type BaseConfig = z.infer<typeof baseEnvSchema>;
export type ServerConfig = z.infer<typeof serverEnvSchema> & { role: "server" };
export type WorkerConfig = z.infer<typeof workerEnvSchema> & { role: "worker" };
export type ServiceConfig = ServerConfig | WorkerConfig;

export interface EnvLoadResult {
  config: ServiceConfig;
  warnings: string[];
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const message = issue.message.replace(/\s+received\s+.*$/i, "");
      return `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${message}`;
    })
    .join("; ");
}

/**
 * Validate process configuration. Error messages deliberately contain only
 * variable names and validation messages, never the submitted values.
 */
export function loadConfig(
  role: ServiceRole,
  source: NodeJS.ProcessEnv = process.env,
): EnvLoadResult {
  const schema = role === "server" ? serverEnvSchema : workerEnvSchema;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid ${role} configuration: ${formatIssues(parsed.error)}`);
  }

  const config = { ...parsed.data, role } as ServiceConfig;
  const warnings: string[] = [];

  if (config.APP_ENV === "production") {
    if (config.NODE_ENV !== "production") {
      warnings.push("APP_ENV=production should normally be paired with NODE_ENV=production");
    }
    if (!config.DATABASE_SSL) {
      warnings.push("DATABASE_SSL is disabled in a production-like environment");
    }
    if (!config.METRICS_TOKEN) {
      warnings.push("METRICS_TOKEN is unset; the metrics endpoint will be unavailable");
    }
  }

  if (config.APP_ENV === "staging" && !config.DATABASE_SSL) {
    warnings.push("DATABASE_SSL is disabled in staging");
  }

  if (isProductionLike(config) && config.role === "server" && config.COOKIE_SECURE === false) {
    warnings.push("COOKIE_SECURE=false in a production-like environment");
  }

  return { config, warnings };
}

export function isProductionLike(config: BaseConfig): boolean {
  return config.APP_ENV === "staging" || config.APP_ENV === "production";
}

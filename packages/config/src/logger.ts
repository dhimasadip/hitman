import type { ServiceRole } from "@hitman/contracts";
import pino from "pino";
import { pinoRedactPaths, sanitizeError } from "./redact.js";

export interface LoggerOptions {
  role: ServiceRole;
  service: string;
  version: string;
  commit: string;
  level?: string;
  destination?: NodeJS.WritableStream;
}

export type Logger = pino.Logger;

export function createLogger(options: LoggerOptions): Logger {
  const config: pino.LoggerOptions = {
    name: options.service,
    level: options.level ?? "info",
    base: {
      service: options.service,
      role: options.role,
      version: options.version,
      commit: options.commit,
    },
    redact: {
      paths: pinoRedactPaths,
      censor: "[REDACTED]",
    },
    serializers: {
      err: (error) => sanitizeError(error),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return options.destination ? pino(config, options.destination) : pino(config);
}

export function logStartupWarnings(logger: Logger, warnings: string[]): void {
  for (const warning of warnings) {
    logger.warn({ warning }, "configuration warning");
  }
}

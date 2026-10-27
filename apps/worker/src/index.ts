import {
  createLogger,
  createObjectStorage,
  createSecretProvider,
  loadConfig,
  logStartupWarnings,
  readBuildMetadata,
  type WorkerConfig,
} from "@hitman/config";
import { createDatabase } from "@hitman/database";
import { buildWorkerApp, recordWorkerPoll } from "./app.js";

async function main(): Promise<void> {
  const { config, warnings } = loadConfig("worker");
  const typedConfig = config as WorkerConfig;
  const metadata = readBuildMetadata(process.env);
  const logger = createLogger({
    role: "worker",
    service: "hitman-worker",
    version: metadata.version,
    commit: metadata.commit,
    level: typedConfig.LOG_LEVEL,
  });

  logStartupWarnings(logger, warnings);

  const database = createDatabase({
    url: typedConfig.DATABASE_URL,
    maxConnections: typedConfig.DATABASE_POOL_MAX,
    ssl: typedConfig.DATABASE_SSL,
    connectTimeoutMs: typedConfig.DATABASE_CONNECT_TIMEOUT_MS,
    applicationName: "hitman-worker",
    onPoolError: (error) => logger.error({ err: error }, "database pool error"),
  });
  const secretProvider = createSecretProvider(typedConfig.SECRET_PROVIDER);
  const objectStorage = createObjectStorage(typedConfig.OBJECT_STORAGE_DRIVER);

  if (secretProvider.kind !== "env" || objectStorage.kind !== "disabled") {
    logger.warn("worker started with a non-default provider configuration");
  }

  const app = await buildWorkerApp({
    config: typedConfig,
    logger,
    database,
    metadata,
  });

  let pollTimer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    pollTimer = setTimeout(async () => {
      // Phase 3 has no scheduled work. Phase 13 adds durable job and
      // reconciliation loops behind this same scheduler boundary.
      recordWorkerPoll(app);
      logger.debug(
        { intervalMs: typedConfig.WORKER_POLL_INTERVAL_MS },
        "worker scheduling cycle (no jobs registered)",
      );
      try {
        await database.check(typedConfig.DB_HEALTH_TIMEOUT_MS);
      } catch (error) {
        logger.warn({ err: error }, "worker database probe failed");
      }
      schedule();
    }, typedConfig.WORKER_POLL_INTERVAL_MS);
    pollTimer.unref();
  };

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down worker");
    if (pollTimer) clearTimeout(pollTimer);
    const timeout = setTimeout(() => {
      logger.error("graceful worker shutdown timed out");
      process.exit(1);
    }, typedConfig.SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    try {
      await app.close();
      await database.close();
      clearTimeout(timeout);
      logger.info("worker shutdown complete");
    } catch (error) {
      logger.error({ err: error }, "worker shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({
      host: typedConfig.WORKER_HEALTH_HOST,
      port: typedConfig.WORKER_HEALTH_PORT,
    });
    schedule();
    logger.info(
      {
        host: typedConfig.WORKER_HEALTH_HOST,
        port: typedConfig.WORKER_HEALTH_PORT,
        env: typedConfig.APP_ENV,
      },
      "worker health server listening",
    );
  } catch (error) {
    logger.error({ err: error }, "worker failed to start");
    await database.close();
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  process.stderr.write(`Hitman worker failed to start: ${message}\n`);
  process.exitCode = 1;
});

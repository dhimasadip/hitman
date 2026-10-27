import {
  createLogger,
  createObjectStorage,
  createSecretProvider,
  loadConfig,
  logStartupWarnings,
  readBuildMetadata,
  type ServerConfig,
} from "@hitman/config";
import { createDatabase } from "@hitman/database";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const { config, warnings } = loadConfig("server");
  const typedConfig = config as ServerConfig;
  const metadata = readBuildMetadata(process.env);
  const logger = createLogger({
    role: "server",
    service: "hitman-server",
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
    applicationName: "hitman-server",
    onPoolError: (error) => logger.error({ err: error }, "database pool error"),
  });
  const secretProvider = createSecretProvider(typedConfig.SECRET_PROVIDER);
  const objectStorage = createObjectStorage(typedConfig.OBJECT_STORAGE_DRIVER);

  const app = await buildApp({
    config: typedConfig,
    logger,
    database,
    secretProvider,
    objectStorage,
    metadata,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    const timeout = setTimeout(() => {
      logger.error("graceful shutdown timed out");
      process.exit(1);
    }, typedConfig.SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    try {
      await app.close();
      await database.close();
      clearTimeout(timeout);
      logger.info("shutdown complete");
    } catch (error) {
      logger.error({ err: error }, "shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: typedConfig.HOST, port: typedConfig.PORT });
    logger.info(
      { host: typedConfig.HOST, port: typedConfig.PORT, env: typedConfig.APP_ENV },
      "server listening",
    );
  } catch (error) {
    logger.error({ err: error }, "server failed to start");
    await database.close();
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  process.stderr.write(`Hitman server failed to start: ${message}\n`);
  process.exitCode = 1;
});

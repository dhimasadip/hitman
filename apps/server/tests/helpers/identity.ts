import {
  createLogger,
  createObjectStorage,
  createSecretProvider,
  loadConfig,
  type ServerConfig,
} from "@hitman/config";
import { createDatabase, type Database, runMigrations } from "@hitman/database";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../../src/app.js";
import {
  createIdentityServices,
  type IdentityServices,
} from "../../src/modules/identity/services.js";

export const TEST_PASSWORD = "correct horse battery staple";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

export interface TestContext {
  app: TestApp;
  database: Database;
  config: ServerConfig;
  services: IdentityServices;
  url: string;
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export async function createTestContext(
  url: string,
  overrides: Partial<ServerConfig> = {},
): Promise<TestContext> {
  await runMigrations({ url });
  const { config } = loadConfig("server", {
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_URL: url,
    COOKIE_SECURE: "false",
    LOGIN_RATE_LIMIT_MAX: "100",
  });
  const typedConfig = { ...(config as ServerConfig), ...overrides };
  const logger = createLogger({
    role: "server",
    service: "hitman-auth-test",
    version: "0.1.0",
    commit: "test",
    level: "silent",
  });
  const database = createDatabase({ url, maxConnections: 5, applicationName: "hitman-auth-test" });
  const services = createIdentityServices(database.db, typedConfig, logger);
  const app = await buildApp({
    config: typedConfig,
    logger,
    database,
    secretProvider: createSecretProvider("env"),
    objectStorage: createObjectStorage("disabled"),
    metadata: { version: "0.1.0", commit: "test", builtAt: null },
  });
  return { app, database, config: typedConfig, services, url };
}

export async function truncateIdentityTables(database: Database): Promise<void> {
  await database.pool.query(
    "truncate table audit_events, api_request_source_links, api_request_source_observations, api_request_versions, api_requests, collection_folders, collections, api_operations, api_specification_versions, api_specifications, gitlab_repositories, gitlab_connections, project_memberships, projects, sessions, team_memberships, teams, organization_memberships, users, organizations cascade",
  );
}

export interface CookieJar {
  cookie: string;
  session: string;
  csrf: string;
}

export function extractCookies(response: LightMyRequestResponse): CookieJar {
  const raw = response.headers["set-cookie"];
  const headers = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const values = new Map<string, string>();
  for (const header of headers) {
    const [pair] = header.split(";");
    if (!pair) continue;
    const index = pair.indexOf("=");
    if (index < 0) continue;
    values.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const session = values.get("hitman_session");
  const csrf = values.get("hitman_csrf");
  if (!session || !csrf) throw new Error("login response did not set auth cookies");
  return {
    cookie: `hitman_session=${session}; hitman_csrf=${csrf}`,
    session,
    csrf,
  };
}

export async function login(
  app: TestApp,
  email: string,
  password = TEST_PASSWORD,
): Promise<{ response: LightMyRequestResponse; cookies: CookieJar }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  return { response, cookies: extractCookies(response) };
}

export function authenticatedHeaders(cookies: CookieJar): Record<string, string> {
  return { cookie: cookies.cookie, "x-csrf-token": cookies.csrf };
}

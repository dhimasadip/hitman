import { isProductionLike, type ServerConfig } from "@hitman/config";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  switchOrganizationRequestSchema,
} from "@hitman/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { createRequireCsrf, getAuth, requireAuth } from "../../plugins/auth.js";
import { parseBody } from "../shared/validation.js";
import type { AuthService, LoginResult } from "./auth-service.js";

export interface AuthRouteDependencies {
  config: ServerConfig;
  auth: AuthService;
}

function cookieBase(config: ServerConfig) {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: config.COOKIE_SECURE ?? isProductionLike(config),
  };
}

function setSessionCookies(reply: FastifyReply, config: ServerConfig, result: LoginResult): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, result.token, {
    ...cookieBase(config),
    httpOnly: true,
    maxAge: config.SESSION_TTL_SECONDS,
  });
  reply.setCookie(config.CSRF_COOKIE_NAME, result.csrfToken, {
    ...cookieBase(config),
    httpOnly: false,
    maxAge: config.SESSION_TTL_SECONDS,
  });
}

function clearSessionCookies(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(config.SESSION_COOKIE_NAME, cookieBase(config));
  reply.clearCookie(config.CSRF_COOKIE_NAME, cookieBase(config));
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDependencies,
): Promise<void> {
  const requireCsrf = createRequireCsrf(deps.config);

  app.post(
    "/api/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: deps.config.LOGIN_RATE_LIMIT_MAX,
          timeWindow: deps.config.LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1_000,
        },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const input = parseBody(loginRequestSchema, request.body);
      const result = await deps.auth.login(input, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        correlationId: request.id,
      });
      setSessionCookies(reply, deps.config, result);
      return reply.status(200).send(result.session);
    },
  );

  app.get("/api/v1/auth/session", { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply);
    return reply.send(await deps.auth.sessionContext(getAuth(request)));
  });

  app.post(
    "/api/v1/auth/logout",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      await deps.auth.logout(getAuth(request), request.id);
      clearSessionCookies(reply, deps.config);
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/v1/auth/switch-organization",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const input = parseBody(switchOrganizationRequestSchema, request.body);
      const session = await deps.auth.switchOrganization(
        getAuth(request),
        input.organizationId,
        request.id,
      );
      return reply.send(session);
    },
  );

  app.post(
    "/api/v1/auth/change-password",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const input = parseBody(changePasswordRequestSchema, request.body);
      await deps.auth.changePassword(
        getAuth(request),
        input.currentPassword,
        input.newPassword,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.get("/api/v1/organizations", { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply);
    const session = await deps.auth.sessionContext(getAuth(request));
    return reply.send({ organizations: session.organizations });
  });
}

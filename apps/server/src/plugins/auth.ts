import type { ServerConfig } from "@hitman/config";
import { ApiError } from "@hitman/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ResolvedSession, SessionService } from "../modules/identity/session-service.js";
import { constantTimeEqual, hashToken } from "../modules/shared/crypto.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: ResolvedSession | null;
  }
}

export function registerAuthPlugin(
  app: FastifyInstance,
  deps: { sessions: SessionService; config: ServerConfig },
): void {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/v1") || request.url.startsWith("/api/v1/auth/login")) {
      return;
    }
    const token = request.cookies[deps.config.SESSION_COOKIE_NAME];
    if (!token) return;
    request.auth = await deps.sessions.resolveSession(token);
  });
}

export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.auth) throw ApiError.unauthorized("Authentication required");
}

export function createRequireCsrf(config: ServerConfig) {
  return async function requireCsrf(request: FastifyRequest): Promise<void> {
    if (!request.auth) throw ApiError.unauthorized("Authentication required");
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;

    const header = request.headers["x-csrf-token"];
    const cookie = request.cookies[config.CSRF_COOKIE_NAME];
    if (
      typeof header !== "string" ||
      typeof cookie !== "string" ||
      !constantTimeEqual(header, cookie) ||
      !constantTimeEqual(hashToken(header), request.auth.session.csrfHash)
    ) {
      throw ApiError.forbidden("Invalid CSRF token");
    }
  };
}

export function getAuth(request: FastifyRequest): ResolvedSession {
  if (!request.auth) throw ApiError.unauthorized("Authentication required");
  return request.auth;
}

import type { ServerConfig } from "@hitman/config";
import {
  createRequestRequestSchema,
  requestLifecycleSchema,
  updateRequestRequestSchema,
} from "@hitman/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createRequireCsrf, getAuth, requireAuth } from "../../plugins/auth.js";
import { parseBody, parseParams, parseQuery } from "../shared/validation.js";
import type { RequestService } from "./request-service.js";

const projectParamsSchema = z.object({ projectId: z.uuid() });
const requestParamsSchema = z.object({ requestId: z.uuid() });
const versionParamsSchema = z.object({ requestId: z.uuid(), versionId: z.uuid() });
const requestListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  method: z.string().trim().max(20).optional(),
  path: z.string().trim().max(500).optional(),
  lifecycle: requestLifecycleSchema.optional(),
  collectionId: z.uuid().optional(),
  folderId: z.uuid().optional(),
  tag: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface RequestRouteDependencies {
  config: ServerConfig;
  requests: RequestService;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "private, no-store");
}

export async function registerRequestRoutes(
  app: FastifyInstance,
  deps: RequestRouteDependencies,
): Promise<void> {
  const requireCsrf = createRequireCsrf(deps.config);

  app.get(
    "/api/v1/projects/:projectId/requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const query = parseQuery(requestListQuerySchema, request.query);
      return reply.send({
        requests: await deps.requests.listRequests(getAuth(request).user.id, projectId, {
          ...(query.q ? { search: query.q } : {}),
          ...(query.method ? { method: query.method } : {}),
          ...(query.path ? { path: query.path } : {}),
          ...(query.lifecycle ? { lifecycle: query.lifecycle } : {}),
          ...(query.collectionId ? { collectionId: query.collectionId } : {}),
          ...(query.folderId ? { folderId: query.folderId } : {}),
          ...(query.tag ? { tag: query.tag } : {}),
          limit: query.limit,
        }),
      });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/requests",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(createRequestRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.requests.createRequest(getAuth(request).user.id, projectId, input, request.id),
        );
    },
  );

  app.get("/api/v1/requests/:requestId", { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply);
    const { requestId } = parseParams(requestParamsSchema, request.params);
    return reply.send(await deps.requests.getRequest(getAuth(request).user.id, requestId));
  });

  app.patch(
    "/api/v1/requests/:requestId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { requestId } = parseParams(requestParamsSchema, request.params);
      const input = parseBody(updateRequestRequestSchema, request.body);
      return reply.send(
        await deps.requests.updateRequest(getAuth(request).user.id, requestId, input, request.id),
      );
    },
  );

  app.post(
    "/api/v1/requests/:requestId/archive",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { requestId } = parseParams(requestParamsSchema, request.params);
      return reply.send(
        await deps.requests.archiveRequest(getAuth(request).user.id, requestId, request.id),
      );
    },
  );

  app.get(
    "/api/v1/requests/:requestId/versions",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { requestId } = parseParams(requestParamsSchema, request.params);
      return reply.send({
        versions: await deps.requests.listVersions(getAuth(request).user.id, requestId),
      });
    },
  );

  app.get(
    "/api/v1/requests/:requestId/versions/:versionId",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { requestId, versionId } = parseParams(versionParamsSchema, request.params);
      return reply.send(
        await deps.requests.getVersion(getAuth(request).user.id, requestId, versionId),
      );
    },
  );
}

import type { ServerConfig } from "@hitman/config";
import { importSpecificationRequestSchema } from "@hitman/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createRequireCsrf, getAuth, requireAuth } from "../../plugins/auth.js";
import { parseBody, parseParams, parseQuery } from "../shared/validation.js";
import type { SpecificationService } from "./spec-service.js";

const projectParamsSchema = z.object({ projectId: z.uuid() });
const specificationParamsSchema = z.object({
  projectId: z.uuid(),
  specificationId: z.uuid(),
});
const operationQuerySchema = z.object({
  specificationId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  method: z.string().trim().max(20).optional(),
});

export interface SpecificationRouteDependencies {
  config: ServerConfig;
  specifications: SpecificationService;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "private, no-store");
}

export async function registerSpecificationRoutes(
  app: FastifyInstance,
  deps: SpecificationRouteDependencies,
): Promise<void> {
  const requireCsrf = createRequireCsrf(deps.config);

  app.get(
    "/api/v1/projects/:projectId/specifications",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send({
        specifications: await deps.specifications.listSpecifications(
          getAuth(request).user.id,
          projectId,
        ),
      });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/specifications/import",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(importSpecificationRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.specifications.importSpecification(
            getAuth(request).user.id,
            projectId,
            input,
            request.id,
          ),
        );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/specifications/:specificationId",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId, specificationId } = parseParams(specificationParamsSchema, request.params);
      return reply.send(
        await deps.specifications.getSpecification(
          getAuth(request).user.id,
          projectId,
          specificationId,
        ),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/operations",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const query = parseQuery(operationQuerySchema, request.query);
      return reply.send({
        operations: await deps.specifications.listOperations(getAuth(request).user.id, projectId, {
          ...(query.specificationId ? { specificationId: query.specificationId } : {}),
          ...(query.q ? { search: query.q } : {}),
          ...(query.method ? { method: query.method } : {}),
        }),
      });
    },
  );
}

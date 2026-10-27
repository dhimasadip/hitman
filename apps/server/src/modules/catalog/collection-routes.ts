import type { ServerConfig } from "@hitman/config";
import {
  createCollectionFolderRequestSchema,
  createCollectionRequestSchema,
  updateCollectionFolderRequestSchema,
  updateCollectionRequestSchema,
} from "@hitman/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createRequireCsrf, getAuth, requireAuth } from "../../plugins/auth.js";
import { parseBody, parseParams } from "../shared/validation.js";
import type { CollectionService } from "./collection-service.js";

const projectParamsSchema = z.object({ projectId: z.uuid() });
const collectionParamsSchema = z.object({
  projectId: z.uuid(),
  collectionId: z.uuid(),
});
const folderParamsSchema = z.object({
  projectId: z.uuid(),
  collectionId: z.uuid(),
  folderId: z.uuid(),
});

export interface CollectionRouteDependencies {
  config: ServerConfig;
  collections: CollectionService;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "private, no-store");
}

export async function registerCollectionRoutes(
  app: FastifyInstance,
  deps: CollectionRouteDependencies,
): Promise<void> {
  const requireCsrf = createRequireCsrf(deps.config);

  app.get(
    "/api/v1/projects/:projectId/collections",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send({
        collections: await deps.collections.listCollections(getAuth(request).user.id, projectId),
      });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/collections",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(createCollectionRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.collections.createCollection(
            getAuth(request).user.id,
            projectId,
            input,
            request.id,
          ),
        );
    },
  );

  app.patch(
    "/api/v1/projects/:projectId/collections/:collectionId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, collectionId } = parseParams(collectionParamsSchema, request.params);
      const input = parseBody(updateCollectionRequestSchema, request.body);
      return reply.send(
        await deps.collections.updateCollection(
          getAuth(request).user.id,
          projectId,
          collectionId,
          input,
          request.id,
        ),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/collections/:collectionId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, collectionId } = parseParams(collectionParamsSchema, request.params);
      await deps.collections.deleteCollection(
        getAuth(request).user.id,
        projectId,
        collectionId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/v1/projects/:projectId/collections/:collectionId/folders",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, collectionId } = parseParams(collectionParamsSchema, request.params);
      const input = parseBody(createCollectionFolderRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.collections.createFolder(
            getAuth(request).user.id,
            projectId,
            collectionId,
            input,
            request.id,
          ),
        );
    },
  );

  app.patch(
    "/api/v1/projects/:projectId/collections/:collectionId/folders/:folderId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, collectionId, folderId } = parseParams(folderParamsSchema, request.params);
      const input = parseBody(updateCollectionFolderRequestSchema, request.body);
      return reply.send(
        await deps.collections.updateFolder(
          getAuth(request).user.id,
          projectId,
          collectionId,
          folderId,
          input,
          request.id,
        ),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/collections/:collectionId/folders/:folderId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, collectionId, folderId } = parseParams(folderParamsSchema, request.params);
      await deps.collections.deleteFolder(
        getAuth(request).user.id,
        projectId,
        collectionId,
        folderId,
        request.id,
      );
      return reply.status(204).send();
    },
  );
}

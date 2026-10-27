import type { ServerConfig } from "@hitman/config";
import {
  addProjectMemberRequestSchema,
  createProjectRequestSchema,
  linkRepositoryRequestSchema,
  projectStatusFilterSchema,
  updateProjectMemberRequestSchema,
  updateProjectRequestSchema,
  updateRepositoryRequestSchema,
} from "@hitman/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createRequireCsrf, getAuth, requireAuth } from "../../plugins/auth.js";
import { parseBody, parseParams, parseQuery } from "../shared/validation.js";
import type { ProjectService } from "./project-service.js";

const organizationParamsSchema = z.object({ organizationId: z.uuid() });
const projectParamsSchema = z.object({ projectId: z.uuid() });
const projectMemberParamsSchema = z.object({ projectId: z.uuid(), userId: z.uuid() });
const projectListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: projectStatusFilterSchema.default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface ProjectRouteDependencies {
  config: ServerConfig;
  projects: ProjectService;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "private, no-store");
}

export async function registerProjectRoutes(
  app: FastifyInstance,
  deps: ProjectRouteDependencies,
): Promise<void> {
  const requireCsrf = createRequireCsrf(deps.config);

  app.get(
    "/api/v1/organizations/:organizationId/projects",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      const query = parseQuery(projectListQuerySchema, request.query);
      return reply.send({
        projects: await deps.projects.listProjects(getAuth(request).user.id, organizationId, {
          ...(query.q !== undefined ? { search: query.q } : {}),
          status: query.status,
          limit: query.limit,
        }),
      });
    },
  );

  app.post(
    "/api/v1/organizations/:organizationId/projects",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      const input = parseBody(createProjectRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.projects.createProject(
            getAuth(request).user.id,
            organizationId,
            input,
            request.id,
          ),
        );
    },
  );

  app.get("/api/v1/projects/:projectId", { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply);
    const { projectId } = parseParams(projectParamsSchema, request.params);
    return reply.send(await deps.projects.getProject(getAuth(request).user.id, projectId));
  });

  app.patch(
    "/api/v1/projects/:projectId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(updateProjectRequestSchema, request.body);
      return reply.send(
        await deps.projects.updateProject(getAuth(request).user.id, projectId, input, request.id),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/archive",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send(
        await deps.projects.archiveProject(getAuth(request).user.id, projectId, request.id),
      );
    },
  );

  app.post(
    "/api/v1/projects/:projectId/restore",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send(
        await deps.projects.restoreProject(getAuth(request).user.id, projectId, request.id),
      );
    },
  );

  app.get(
    "/api/v1/projects/:projectId/members",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send({
        members: await deps.projects.listMembers(getAuth(request).user.id, projectId),
      });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/members",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(addProjectMemberRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.projects.addMember(
            getAuth(request).user.id,
            projectId,
            input.email,
            input.role,
            request.id,
          ),
        );
    },
  );

  app.patch(
    "/api/v1/projects/:projectId/members/:userId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, userId } = parseParams(projectMemberParamsSchema, request.params);
      const input = parseBody(updateProjectMemberRequestSchema, request.body);
      await deps.projects.updateMemberRole(
        getAuth(request).user.id,
        projectId,
        userId,
        input.role,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/members/:userId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId, userId } = parseParams(projectMemberParamsSchema, request.params);
      await deps.projects.removeMember(getAuth(request).user.id, projectId, userId, request.id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/projects/:projectId/repository",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send({
        repository: await deps.projects.getRepository(getAuth(request).user.id, projectId),
      });
    },
  );

  app.get(
    "/api/v1/projects/:projectId/gitlab/repositories",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return reply.send({
        repositories: await deps.projects.listMockRepositories(getAuth(request).user.id, projectId),
      });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/repository",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(linkRepositoryRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.projects.linkRepository(
            getAuth(request).user.id,
            projectId,
            input.externalProjectId,
            input.openapiFilePath,
            request.id,
          ),
        );
    },
  );

  app.patch(
    "/api/v1/projects/:projectId/repository",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      const input = parseBody(updateRepositoryRequestSchema, request.body);
      return reply.send(
        await deps.projects.updateRepository(
          getAuth(request).user.id,
          projectId,
          input.openapiFilePath,
          request.id,
        ),
      );
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/repository",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { projectId } = parseParams(projectParamsSchema, request.params);
      await deps.projects.unlinkRepository(getAuth(request).user.id, projectId, request.id);
      return reply.status(204).send();
    },
  );
}

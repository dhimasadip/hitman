import type { ServerConfig } from "@hitman/config";
import {
  addOrganizationMemberRequestSchema,
  addTeamMemberRequestSchema,
  createTeamRequestSchema,
  updateOrganizationMemberRequestSchema,
  updateOrganizationRequestSchema,
  updateTeamMemberRequestSchema,
  updateTeamRequestSchema,
} from "@hitman/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createRequireCsrf, getAuth, requireAuth } from "../../plugins/auth.js";
import type { OrganizationService } from "../organizations/organization-service.js";
import { parseBody, parseParams, parseQuery } from "../shared/validation.js";

const organizationParamsSchema = z.object({ organizationId: z.uuid() });
const memberParamsSchema = z.object({ organizationId: z.uuid(), userId: z.uuid() });
const teamParamsSchema = z.object({ organizationId: z.uuid(), teamId: z.uuid() });
const teamMemberParamsSchema = z.object({
  organizationId: z.uuid(),
  teamId: z.uuid(),
  userId: z.uuid(),
});
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface OrganizationRouteDependencies {
  config: ServerConfig;
  organizations: OrganizationService;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "private, no-store");
}

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: OrganizationRouteDependencies,
): Promise<void> {
  const requireCsrf = createRequireCsrf(deps.config);

  app.get(
    "/api/v1/organizations/:organizationId",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      return reply.send(
        await deps.organizations.getOrganization(getAuth(request).user.id, organizationId),
      );
    },
  );

  app.patch(
    "/api/v1/organizations/:organizationId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      const input = parseBody(updateOrganizationRequestSchema, request.body);
      return reply.send(
        await deps.organizations.updateOrganization(
          getAuth(request).user.id,
          organizationId,
          input.name,
          request.id,
        ),
      );
    },
  );

  app.get(
    "/api/v1/organizations/:organizationId/members",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      return reply.send({
        members: await deps.organizations.listMembers(getAuth(request).user.id, organizationId),
      });
    },
  );

  app.post(
    "/api/v1/organizations/:organizationId/members",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      const input = parseBody(addOrganizationMemberRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.organizations.addMember(
            getAuth(request).user.id,
            organizationId,
            input.email,
            input.role,
            request.id,
          ),
        );
    },
  );

  app.patch(
    "/api/v1/organizations/:organizationId/members/:userId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, userId } = parseParams(memberParamsSchema, request.params);
      const input = parseBody(updateOrganizationMemberRequestSchema, request.body);
      await deps.organizations.updateMemberRole(
        getAuth(request).user.id,
        organizationId,
        userId,
        input.role,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/api/v1/organizations/:organizationId/members/:userId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, userId } = parseParams(memberParamsSchema, request.params);
      await deps.organizations.removeMember(
        getAuth(request).user.id,
        organizationId,
        userId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/organizations/:organizationId/teams",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      return reply.send({
        teams: await deps.organizations.listTeams(getAuth(request).user.id, organizationId),
      });
    },
  );

  app.post(
    "/api/v1/organizations/:organizationId/teams",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      const input = parseBody(createTeamRequestSchema, request.body);
      return reply
        .status(201)
        .send(
          await deps.organizations.createTeam(
            getAuth(request).user.id,
            organizationId,
            input,
            request.id,
          ),
        );
    },
  );

  app.get(
    "/api/v1/organizations/:organizationId/teams/:teamId",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, teamId } = parseParams(teamParamsSchema, request.params);
      return reply.send(
        await deps.organizations.getTeam(getAuth(request).user.id, organizationId, teamId),
      );
    },
  );

  app.patch(
    "/api/v1/organizations/:organizationId/teams/:teamId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, teamId } = parseParams(teamParamsSchema, request.params);
      const input = parseBody(updateTeamRequestSchema, request.body);
      await deps.organizations.updateTeam(
        getAuth(request).user.id,
        organizationId,
        teamId,
        input.name,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/api/v1/organizations/:organizationId/teams/:teamId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, teamId } = parseParams(teamParamsSchema, request.params);
      await deps.organizations.deleteTeam(
        getAuth(request).user.id,
        organizationId,
        teamId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/v1/organizations/:organizationId/teams/:teamId/members",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, teamId } = parseParams(teamParamsSchema, request.params);
      const input = parseBody(addTeamMemberRequestSchema, request.body);
      await deps.organizations.addTeamMember(
        getAuth(request).user.id,
        organizationId,
        teamId,
        input.email,
        input.role,
        request.id,
      );
      return reply.status(201).send({ status: "added" });
    },
  );

  app.patch(
    "/api/v1/organizations/:organizationId/teams/:teamId/members/:userId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, teamId, userId } = parseParams(
        teamMemberParamsSchema,
        request.params,
      );
      const input = parseBody(updateTeamMemberRequestSchema, request.body);
      await deps.organizations.updateTeamMemberRole(
        getAuth(request).user.id,
        organizationId,
        teamId,
        userId,
        input.role,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/api/v1/organizations/:organizationId/teams/:teamId/members/:userId",
    { preHandler: [requireAuth, requireCsrf] },
    async (request, reply) => {
      noStore(reply);
      const { organizationId, teamId, userId } = parseParams(
        teamMemberParamsSchema,
        request.params,
      );
      await deps.organizations.removeTeamMember(
        getAuth(request).user.id,
        organizationId,
        teamId,
        userId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/organizations/:organizationId/audit-events",
    { preHandler: requireAuth },
    async (request, reply) => {
      noStore(reply);
      const { organizationId } = parseParams(organizationParamsSchema, request.params);
      const { limit } = parseQuery(auditQuerySchema, request.query);
      return reply.send({
        events: await deps.organizations.listAuditEvents(
          getAuth(request).user.id,
          organizationId,
          limit,
        ),
      });
    },
  );
}

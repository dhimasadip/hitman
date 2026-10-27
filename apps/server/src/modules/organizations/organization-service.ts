import {
  ApiError,
  type AuditEvent,
  type OrganizationDetail,
  type OrganizationMember,
  type OrganizationRole,
  type TeamDetail,
  type TeamMember,
  type TeamRole,
  type TeamSummary,
} from "@hitman/contracts";
import {
  auditEvents,
  organizationMemberships,
  organizations,
  projectMemberships,
  projects,
  teamMemberships,
  teams,
  users,
} from "@hitman/database/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthorizationService } from "../authorization/authorization-service.js";
import type { SessionService } from "../identity/session-service.js";
import type { Db, DbExecutor } from "../shared/db.js";
import { isUniqueViolation } from "../shared/db.js";
import { normalizeEmail } from "../shared/validation.js";

export class OrganizationService {
  constructor(
    private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async getOrganization(userId: string, organizationId: string): Promise<OrganizationDetail> {
    const role = await this.authorization.requireOrganizationRead(userId, organizationId);
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const organization = rows[0];
    if (!organization) throw ApiError.notFound("Organization not found");
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role,
      settings: organization.settings,
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    };
  }

  async updateOrganization(
    actorUserId: string,
    organizationId: string,
    name: string,
    correlationId: string | null,
  ): Promise<OrganizationDetail> {
    await this.authorization.requireOrganizationAdmin(actorUserId, organizationId);
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(organizations)
        .set({ name: name.trim(), updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning();
      const organization = rows[0];
      if (!organization) throw ApiError.notFound("Organization not found");
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "organization.updated",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
        correlationId,
        metadata: { name: organization.name },
      });
      return organization;
    });

    const role = await this.authorization.requireOrganizationRead(actorUserId, organizationId);
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      role,
      settings: updated.settings,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async listMembers(userId: string, organizationId: string): Promise<OrganizationMember[]> {
    await this.authorization.requireOrganizationRead(userId, organizationId);
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        role: organizationMemberships.role,
        createdAt: organizationMemberships.createdAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(asc(users.displayName));

    return rows.map((row) => ({
      user: {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        status: row.status,
      },
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addMember(
    actorUserId: string,
    organizationId: string,
    emailInput: string,
    role: OrganizationRole,
    correlationId: string | null,
  ): Promise<OrganizationMember> {
    await this.authorization.requireOrganizationAdmin(actorUserId, organizationId);
    const email = normalizeEmail(emailInput);
    const userRows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = userRows[0];
    if (!user) {
      throw ApiError.notFound(
        "User not found. Provision a new user through the administrator CLI first.",
      );
    }

    try {
      const membership = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(organizationMemberships)
          .values({ organizationId, userId: user.id, role })
          .returning({ createdAt: organizationMemberships.createdAt });
        const created = rows[0];
        if (!created) throw new Error("membership insert returned no row");
        await this.audit.record(tx, {
          organizationId,
          actorUserId,
          actorType: "user",
          action: "organization.member_added",
          resourceType: "user",
          resourceId: user.id,
          outcome: "success",
          correlationId,
          metadata: { role },
        });
        return created;
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          status: user.status,
        },
        role,
        createdAt: membership.createdAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("User is already a member of this organization");
      }
      throw error;
    }
  }

  async updateMemberRole(
    actorUserId: string,
    organizationId: string,
    targetUserId: string,
    role: OrganizationRole,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireOrganizationAdmin(actorUserId, organizationId);
    await this.db.transaction(async (tx) => {
      await this.lockMemberships(tx, organizationId);
      const target = await this.findMembership(tx, organizationId, targetUserId);
      if (!target) throw ApiError.notFound("Organization member not found");
      if (target.role === "org_admin" && role !== "org_admin") {
        await this.ensureNotLastAdmin(tx, organizationId);
      }
      await tx
        .update(organizationMemberships)
        .set({ role })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, targetUserId),
          ),
        );
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "organization.member_role_changed",
        resourceType: "user",
        resourceId: targetUserId,
        outcome: "success",
        correlationId,
        metadata: { from: target.role, to: role },
      });
    });
  }

  async removeMember(
    actorUserId: string,
    organizationId: string,
    targetUserId: string,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireOrganizationAdmin(actorUserId, organizationId);
    await this.db.transaction(async (tx) => {
      await this.lockMemberships(tx, organizationId);
      const target = await this.findMembership(tx, organizationId, targetUserId);
      if (!target) throw ApiError.notFound("Organization member not found");
      if (target.role === "org_admin") {
        await this.ensureNotLastAdmin(tx, organizationId);
      }

      const targetProjects = await tx
        .select({ projectId: projectMemberships.projectId, role: projectMemberships.role })
        .from(projectMemberships)
        .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projectMemberships.userId, targetUserId),
          ),
        );
      for (const project of targetProjects) {
        if (project.role !== "project_admin") continue;
        const admins = await tx
          .select({ userId: projectMemberships.userId })
          .from(projectMemberships)
          .where(
            and(
              eq(projectMemberships.projectId, project.projectId),
              eq(projectMemberships.role, "project_admin"),
            ),
          );
        if (admins.length <= 1) {
          throw ApiError.conflict(
            "Cannot remove a member who is the last administrator of an organization project",
          );
        }
      }

      await tx
        .delete(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, targetUserId),
          ),
        );
      await tx
        .delete(teamMemberships)
        .where(
          and(
            eq(teamMemberships.userId, targetUserId),
            inArray(
              teamMemberships.teamId,
              tx
                .select({ id: teams.id })
                .from(teams)
                .where(eq(teams.organizationId, organizationId)),
            ),
          ),
        );
      await tx
        .delete(projectMemberships)
        .where(
          and(
            eq(projectMemberships.userId, targetUserId),
            inArray(
              projectMemberships.projectId,
              tx
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.organizationId, organizationId)),
            ),
          ),
        );
      await this.sessions.clearActiveOrganizationForUserInOrg(tx, targetUserId, organizationId);
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "organization.member_removed",
        resourceType: "user",
        resourceId: targetUserId,
        outcome: "success",
        correlationId,
        metadata: { role: target.role },
      });
    });
  }

  async listTeams(userId: string, organizationId: string): Promise<TeamSummary[]> {
    await this.authorization.requireOrganizationRead(userId, organizationId);
    const rows = await this.db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        createdAt: teams.createdAt,
        memberCount: sql<number>`count(${teamMemberships.userId})::int`,
      })
      .from(teams)
      .leftJoin(teamMemberships, eq(teamMemberships.teamId, teams.id))
      .where(eq(teams.organizationId, organizationId))
      .groupBy(teams.id)
      .orderBy(asc(teams.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      memberCount: Number(row.memberCount),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getTeam(userId: string, organizationId: string, teamId: string): Promise<TeamDetail> {
    await this.authorization.requireTeamAccess({
      userId,
      organizationId,
      teamId,
      manage: false,
    });
    const teamRows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)))
      .limit(1);
    const team = teamRows[0];
    if (!team) throw ApiError.notFound("Team not found");

    const members = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        role: teamMemberships.role,
        createdAt: teamMemberships.createdAt,
      })
      .from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(eq(teamMemberships.teamId, teamId))
      .orderBy(asc(users.displayName));

    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      memberCount: members.length,
      createdAt: team.createdAt.toISOString(),
      members: members.map((member) => ({
        user: {
          id: member.id,
          email: member.email,
          displayName: member.displayName,
          status: member.status,
        },
        role: member.role,
        createdAt: member.createdAt.toISOString(),
      })),
    };
  }

  async createTeam(
    actorUserId: string,
    organizationId: string,
    input: { name: string; slug: string },
    correlationId: string | null,
  ): Promise<TeamSummary> {
    await this.authorization.requireOrganizationAdmin(actorUserId, organizationId);
    try {
      const team = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(teams)
          .values({
            organizationId,
            name: input.name.trim(),
            slug: input.slug.trim().toLowerCase(),
          })
          .returning();
        const created = rows[0];
        if (!created) throw new Error("team insert returned no row");
        await this.audit.record(tx, {
          organizationId,
          actorUserId,
          actorType: "user",
          action: "team.created",
          resourceType: "team",
          resourceId: created.id,
          outcome: "success",
          correlationId,
          metadata: { slug: created.slug },
        });
        return created;
      });

      return {
        id: team.id,
        name: team.name,
        slug: team.slug,
        memberCount: 0,
        createdAt: team.createdAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.conflict("Team slug already exists");
      throw error;
    }
  }

  async updateTeam(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    name: string,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireTeamAccess({
      userId: actorUserId,
      organizationId,
      teamId,
      manage: true,
    });
    await this.db.transaction(async (tx) => {
      await tx
        .update(teams)
        .set({ name: name.trim(), updatedAt: new Date() })
        .where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)));
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "team.updated",
        resourceType: "team",
        resourceId: teamId,
        outcome: "success",
        correlationId,
        metadata: { name },
      });
    });
  }

  async deleteTeam(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireTeamAccess({
      userId: actorUserId,
      organizationId,
      teamId,
      manage: true,
    });
    await this.db.transaction(async (tx) => {
      await tx
        .delete(teams)
        .where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)));
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "team.deleted",
        resourceType: "team",
        resourceId: teamId,
        outcome: "success",
        correlationId,
      });
    });
  }

  async addTeamMember(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    emailInput: string,
    role: TeamRole,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireTeamAccess({
      userId: actorUserId,
      organizationId,
      teamId,
      manage: true,
    });
    const email = normalizeEmail(emailInput);
    const userRows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = userRows[0];
    if (!user) throw ApiError.notFound("User not found");

    const orgMember = await this.db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, user.id),
        ),
      )
      .limit(1);
    if (!orgMember[0]) {
      throw ApiError.conflict("User must be an organization member before joining a team");
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(teamMemberships).values({ teamId, userId: user.id, role });
        await this.audit.record(tx, {
          organizationId,
          actorUserId,
          actorType: "user",
          action: "team.member_added",
          resourceType: "team",
          resourceId: teamId,
          outcome: "success",
          correlationId,
          metadata: { userId: user.id, role },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.conflict("User is already a team member");
      throw error;
    }
  }

  async updateTeamMemberRole(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    targetUserId: string,
    role: TeamRole,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireTeamAccess({
      userId: actorUserId,
      organizationId,
      teamId,
      manage: true,
    });
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(teamMemberships)
        .set({ role })
        .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, targetUserId)))
        .returning({ userId: teamMemberships.userId });
      if (updated.length === 0) throw ApiError.notFound("Team member not found");
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "team.member_role_changed",
        resourceType: "team",
        resourceId: teamId,
        outcome: "success",
        correlationId,
        metadata: { userId: targetUserId, role },
      });
    });
  }

  async removeTeamMember(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    targetUserId: string,
    correlationId: string | null,
  ): Promise<void> {
    await this.authorization.requireTeamAccess({
      userId: actorUserId,
      organizationId,
      teamId,
      manage: true,
    });
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(teamMemberships)
        .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, targetUserId)))
        .returning({ userId: teamMemberships.userId });
      if (removed.length === 0) throw ApiError.notFound("Team member not found");
      await this.audit.record(tx, {
        organizationId,
        actorUserId,
        actorType: "user",
        action: "team.member_removed",
        resourceType: "team",
        resourceId: teamId,
        outcome: "success",
        correlationId,
        metadata: { userId: targetUserId },
      });
    });
  }

  async listAuditEvents(
    userId: string,
    organizationId: string,
    limit: number,
  ): Promise<AuditEvent[]> {
    await this.authorization.requireOrganizationAdmin(userId, organizationId);
    const rows = await this.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        actorType: auditEvents.actorType,
        actorUserId: auditEvents.actorUserId,
        actorDisplayName: users.displayName,
        outcome: auditEvents.outcome,
        correlationId: auditEvents.correlationId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actorDisplayName: row.actorDisplayName,
      outcome: row.outcome,
      correlationId: row.correlationId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async lockMemberships(
    executor: DbExecutor,
    organizationId: string,
  ): Promise<Array<{ userId: string; role: OrganizationRole }>> {
    return executor
      .select({
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId))
      .for("update");
  }

  private async findMembership(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<{ role: OrganizationRole } | undefined> {
    const rows = await executor
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async ensureNotLastAdmin(executor: DbExecutor, organizationId: string): Promise<void> {
    const rows = await executor
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId));
    const admins = rows.filter((row) => row.role === "org_admin").length;
    if (admins <= 1) {
      throw ApiError.conflict("Cannot remove or demote the last organization administrator");
    }
  }
}

export type { TeamMember };

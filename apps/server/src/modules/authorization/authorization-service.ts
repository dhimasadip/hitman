import {
  ApiError,
  type OrganizationRole,
  type OrganizationSummary,
  type ProjectRole,
  type TeamRole,
} from "@hitman/contracts";
import {
  organizationMemberships,
  organizations,
  projectMemberships,
  projects,
  teamMemberships,
  teams,
} from "@hitman/database/schema";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../shared/db.js";

export interface TeamAccess {
  team: typeof teams.$inferSelect;
  organizationRole: OrganizationRole;
  teamRole: TeamRole | null;
}

export interface ProjectAccess {
  project: typeof projects.$inferSelect;
  organizationRole: OrganizationRole;
  projectRole: ProjectRole | null;
  effectiveRole: ProjectRole;
}

/**
 * Single server-side authorization boundary for organization, team, and project
 * resources. No route may bypass this service for access decisions.
 */
export class AuthorizationService {
  constructor(private readonly db: Db) {}

  async getOrganizationRole(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole | null> {
    const rows = await this.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organizationId),
        ),
      )
      .limit(1);
    return rows[0]?.role ?? null;
  }

  async listOrganizations(userId: string): Promise<OrganizationSummary[]> {
    return this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, userId))
      .orderBy(asc(organizations.name));
  }

  /**
   * Missing membership returns 404 so callers cannot distinguish an unknown
   * organization from one they cannot access. Insufficient role within a known
   * organization returns 403.
   */
  async requireOrganizationRead(userId: string, organizationId: string): Promise<OrganizationRole> {
    const role = await this.getOrganizationRole(userId, organizationId);
    if (!role) throw ApiError.notFound("Organization not found");
    return role;
  }

  async requireOrganizationAdmin(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole> {
    const role = await this.requireOrganizationRead(userId, organizationId);
    if (role !== "org_admin") throw ApiError.forbidden("Organization administrator role required");
    return role;
  }

  async requireTeamAccess(input: {
    userId: string;
    organizationId: string;
    teamId: string;
    manage: boolean;
  }): Promise<TeamAccess> {
    const organizationRole = await this.requireOrganizationRead(input.userId, input.organizationId);

    const teamRows = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.id, input.teamId), eq(teams.organizationId, input.organizationId)))
      .limit(1);
    const team = teamRows[0];
    if (!team) throw ApiError.notFound("Team not found");

    const teamRoleRows = await this.db
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, input.userId)))
      .limit(1);
    const teamRole = teamRoleRows[0]?.role ?? null;

    if (
      input.manage &&
      organizationRole !== "org_admin" &&
      !(organizationRole === "member" && teamRole === "team_admin")
    ) {
      throw ApiError.forbidden("Team administrator role required");
    }

    return { team, organizationRole, teamRole };
  }

  async requireProjectRead(userId: string, projectId: string): Promise<ProjectAccess> {
    const projectRows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) throw ApiError.notFound("Project not found");

    const organizationRole = await this.getOrganizationRole(userId, project.organizationId);
    if (!organizationRole) throw ApiError.notFound("Project not found");

    if (organizationRole === "org_admin") {
      return {
        project,
        organizationRole,
        projectRole: null,
        effectiveRole: "project_admin",
      };
    }

    const membershipRows = await this.db
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(
        and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)),
      )
      .limit(1);
    const projectRole = membershipRows[0]?.role;
    if (!projectRole) throw ApiError.notFound("Project not found");

    return {
      project,
      organizationRole,
      projectRole,
      effectiveRole: projectRole,
    };
  }

  async requireProjectManage(userId: string, projectId: string): Promise<ProjectAccess> {
    const access = await this.requireProjectRead(userId, projectId);
    if (access.organizationRole === "read_only" || access.effectiveRole !== "project_admin") {
      throw ApiError.forbidden("Project administrator role required");
    }
    return access;
  }

  async requireProjectEdit(userId: string, projectId: string): Promise<ProjectAccess> {
    const access = await this.requireProjectRead(userId, projectId);
    if (
      access.organizationRole === "read_only" ||
      !["project_admin", "editor"].includes(access.effectiveRole)
    ) {
      throw ApiError.forbidden("Project editor role required");
    }
    return access;
  }

  async requireProjectExecute(userId: string, projectId: string): Promise<ProjectAccess> {
    const access = await this.requireProjectRead(userId, projectId);
    if (
      access.organizationRole === "read_only" ||
      !["project_admin", "editor", "executor"].includes(access.effectiveRole)
    ) {
      throw ApiError.forbidden("Project executor role required");
    }
    return access;
  }
}

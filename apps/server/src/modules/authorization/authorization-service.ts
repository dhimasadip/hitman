import {
  ApiError,
  type OrganizationRole,
  type OrganizationSummary,
  type TeamRole,
} from "@hitman/contracts";
import {
  organizationMemberships,
  organizations,
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

/**
 * Single server-side authorization boundary for organization and team
 * resources. Project/request/device checks are added in later phases when those
 * tables exist; no route may bypass this service for org/team access.
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
}

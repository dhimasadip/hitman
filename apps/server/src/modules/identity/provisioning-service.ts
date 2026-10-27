import { ApiError, type OrganizationRole, type TeamRole } from "@hitman/contracts";
import {
  organizationMemberships,
  organizations,
  teamMemberships,
  teams,
  users,
} from "@hitman/database/schema";
import { and, eq } from "drizzle-orm";
import type { AuditService } from "../audit/audit-service.js";
import type { Db } from "../shared/db.js";
import { isUniqueViolation } from "../shared/db.js";
import { normalizeEmail } from "../shared/validation.js";
import { hashPassword } from "./password.js";
import type { SessionService } from "./session-service.js";

export interface BootstrapInput {
  organizationName: string;
  organizationSlug: string;
  email: string;
  displayName: string;
  password: string;
}

export interface AddUserToOrganizationInput {
  organizationSlug: string;
  email: string;
  displayName?: string;
  role: OrganizationRole;
  password?: string;
}

export interface ProvisionedMembership {
  organizationId: string;
  userId: string;
  createdUser: boolean;
}

export class ProvisioningService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async bootstrapOrganization(input: BootstrapInput): Promise<ProvisionedMembership> {
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);

    try {
      return await this.db.transaction(async (tx) => {
        const organizationRows = await tx
          .insert(organizations)
          .values({
            name: input.organizationName.trim(),
            slug: input.organizationSlug.trim().toLowerCase(),
          })
          .returning({ id: organizations.id });
        const organization = organizationRows[0];
        if (!organization) throw new Error("organization insert returned no row");

        const userRows = await tx
          .insert(users)
          .values({
            externalSubject: `native:${email}`,
            email,
            displayName: input.displayName.trim(),
            passwordHash,
            passwordUpdatedAt: new Date(),
            status: "active",
          })
          .returning({ id: users.id });
        const user = userRows[0];
        if (!user) throw new Error("user insert returned no row");

        await tx.insert(organizationMemberships).values({
          organizationId: organization.id,
          userId: user.id,
          role: "org_admin",
        });

        await this.audit.record(tx, {
          organizationId: organization.id,
          actorUserId: user.id,
          actorType: "system",
          action: "organization.bootstrapped",
          resourceType: "organization",
          resourceId: organization.id,
          outcome: "success",
          metadata: { organizationSlug: input.organizationSlug, initialAdminUserId: user.id },
        });

        return { organizationId: organization.id, userId: user.id, createdUser: true };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("Organization slug or user email already exists");
      }
      throw error;
    }
  }

  async addUserToOrganization(input: AddUserToOrganizationInput): Promise<ProvisionedMembership> {
    const organization = await this.findOrganizationBySlug(input.organizationSlug);
    if (!organization) throw ApiError.notFound("Organization not found");

    const email = normalizeEmail(input.email);
    const existing = await this.findUserByEmail(email);
    if (!existing && !input.password) {
      throw ApiError.validation("A password is required when creating a new user");
    }
    const passwordHash =
      !existing && input.password ? await hashPassword(input.password) : undefined;

    try {
      return await this.db.transaction(async (tx) => {
        let userId = existing?.id;
        const createdUser = !existing;
        if (!userId) {
          const userRows = await tx
            .insert(users)
            .values({
              externalSubject: `native:${email}`,
              email,
              displayName: input.displayName?.trim() || email.split("@")[0] || email,
              passwordHash: passwordHash ?? null,
              passwordUpdatedAt: passwordHash ? new Date() : null,
              status: "active",
            })
            .returning({ id: users.id });
          const created = userRows[0];
          if (!created) throw new Error("user insert returned no row");
          userId = created.id;
        }

        await tx.insert(organizationMemberships).values({
          organizationId: organization.id,
          userId,
          role: input.role,
        });

        await this.audit.record(tx, {
          organizationId: organization.id,
          actorUserId: null,
          actorType: "system",
          action: createdUser ? "organization.member_provisioned" : "organization.member_added",
          resourceType: "user",
          resourceId: userId,
          outcome: "success",
          metadata: { role: input.role, createdUser },
        });

        return { organizationId: organization.id, userId, createdUser };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("User is already a member of this organization");
      }
      throw error;
    }
  }

  async resetPassword(emailInput: string, newPassword: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    const user = await this.findUserByEmail(email);
    if (!user) throw ApiError.notFound("User not found");
    const passwordHash = await hashPassword(newPassword);

    const membership = await this.db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, user.id))
      .limit(1);

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id);
      const organizationId = membership[0]?.organizationId;
      if (organizationId) {
        await this.audit.record(tx, {
          organizationId,
          actorUserId: null,
          actorType: "system",
          action: "auth.password_reset",
          resourceType: "user",
          resourceId: user.id,
          outcome: "success",
        });
      }
    });
  }

  async setUserStatus(
    emailInput: string,
    status: "active" | "disabled" | "pending",
  ): Promise<void> {
    const email = normalizeEmail(emailInput);
    const user = await this.findUserByEmail(email);
    if (!user) throw ApiError.notFound("User not found");

    const membership = await this.db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, user.id))
      .limit(1);

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, user.id));
      if (status !== "active") {
        await this.sessions.revokeAllForUser(tx, user.id);
      }
      const organizationId = membership[0]?.organizationId;
      if (organizationId) {
        await this.audit.record(tx, {
          organizationId,
          actorUserId: null,
          actorType: "system",
          action: "user.status_changed",
          resourceType: "user",
          resourceId: user.id,
          outcome: "success",
          metadata: { status },
        });
      }
    });
  }

  async createTeam(input: {
    organizationSlug: string;
    name: string;
    slug: string;
  }): Promise<{ organizationId: string; teamId: string }> {
    const organization = await this.findOrganizationBySlug(input.organizationSlug);
    if (!organization) throw ApiError.notFound("Organization not found");

    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(teams)
          .values({
            organizationId: organization.id,
            name: input.name.trim(),
            slug: input.slug.trim().toLowerCase(),
          })
          .returning({ id: teams.id });
        const team = rows[0];
        if (!team) throw new Error("team insert returned no row");
        await this.audit.record(tx, {
          organizationId: organization.id,
          actorUserId: null,
          actorType: "system",
          action: "team.created",
          resourceType: "team",
          resourceId: team.id,
          outcome: "success",
          metadata: { slug: input.slug },
        });
        return { organizationId: organization.id, teamId: team.id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.conflict("Team slug already exists");
      throw error;
    }
  }

  async addTeamMember(input: {
    organizationSlug: string;
    teamSlug: string;
    email: string;
    role: TeamRole;
  }): Promise<{ teamId: string; userId: string }> {
    const organization = await this.findOrganizationBySlug(input.organizationSlug);
    if (!organization) throw ApiError.notFound("Organization not found");
    const teamRows = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organizationId, organization.id), eq(teams.slug, input.teamSlug)))
      .limit(1);
    const team = teamRows[0];
    if (!team) throw ApiError.notFound("Team not found");

    const user = await this.findUserByEmail(normalizeEmail(input.email));
    if (!user) throw ApiError.notFound("User not found");

    const membership = await this.db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organization.id),
          eq(organizationMemberships.userId, user.id),
        ),
      )
      .limit(1);
    if (!membership[0]) {
      throw ApiError.conflict("User must be an organization member before joining a team");
    }

    try {
      return await this.db.transaction(async (tx) => {
        await tx.insert(teamMemberships).values({
          teamId: team.id,
          userId: user.id,
          role: input.role,
        });
        await this.audit.record(tx, {
          organizationId: organization.id,
          actorUserId: null,
          actorType: "system",
          action: "team.member_added",
          resourceType: "team",
          resourceId: team.id,
          outcome: "success",
          metadata: { userId: user.id, role: input.role },
        });
        return { teamId: team.id, userId: user.id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.conflict("User is already a team member");
      throw error;
    }
  }

  private async findOrganizationBySlug(
    slug: string,
  ): Promise<{ id: string; slug: string } | undefined> {
    const rows = await this.db
      .select({ id: organizations.id, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.slug, slug.trim().toLowerCase()))
      .limit(1);
    return rows[0];
  }

  private async findUserByEmail(email: string): Promise<typeof users.$inferSelect | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0];
  }
}

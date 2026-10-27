import type { Logger } from "@hitman/config";
import {
  ApiError,
  type LoginRequest,
  type PublicUser,
  type SessionResponse,
} from "@hitman/contracts";
import { organizationMemberships, users } from "@hitman/database/schema";
import { eq } from "drizzle-orm";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthorizationService } from "../authorization/authorization-service.js";
import type { Db } from "../shared/db.js";
import { normalizeEmail } from "../shared/validation.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { ResolvedSession, SessionService } from "./session-service.js";

export interface LoginContext {
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

export interface LoginResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  session: SessionResponse;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  async login(input: LoginRequest, context: LoginContext): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    const passwordValid = await verifyPassword(user?.passwordHash ?? null, input.password);

    if (!user || !passwordValid || !user.passwordHash || user.status !== "active") {
      if (user) {
        await this.recordLoginFailureSafely(
          user.id,
          user.status === "active" ? "invalid_credentials" : "account_not_active",
          context,
        );
      } else {
        this.logger.warn(
          { reason: "unknown_email", correlationId: context.correlationId },
          "login failed",
        );
      }
      throw ApiError.unauthorized("Invalid email or password");
    }

    const organizations = await this.authorization.listOrganizations(user.id);
    if (organizations.length === 0) {
      this.logger.warn({ userId: user.id }, "authenticated user has no organization membership");
      throw ApiError.forbidden("No organization access");
    }

    const active = input.organizationId
      ? organizations.find((organization) => organization.id === input.organizationId)
      : organizations[0];
    if (!active) {
      throw ApiError.forbidden("No access to the requested organization");
    }

    const result = await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));
      const created = await this.sessions.createSession(tx, {
        userId: user.id,
        activeOrganizationId: active.id,
        userAgent: truncate(context.userAgent, 512),
        ipAddress: truncate(context.ipAddress, 128),
      });
      await this.audit.record(tx, {
        organizationId: active.id,
        actorUserId: user.id,
        actorType: "user",
        action: "auth.login_succeeded",
        resourceType: "user",
        resourceId: user.id,
        outcome: "success",
        correlationId: context.correlationId,
        metadata: { method: "password" },
      });
      return created;
    });

    return {
      token: result.token,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
      session: {
        user: toPublicUser(user),
        organizations,
        activeOrganizationId: active.id,
      },
    };
  }

  async sessionContext(resolved: ResolvedSession): Promise<SessionResponse> {
    const organizations = await this.authorization.listOrganizations(resolved.user.id);
    const activeStillValid = organizations.some(
      (organization) => organization.id === resolved.session.activeOrganizationId,
    );
    let activeOrganizationId = activeStillValid
      ? resolved.session.activeOrganizationId
      : (organizations[0]?.id ?? null);

    if (
      organizations.length > 0 &&
      activeOrganizationId !== null &&
      activeOrganizationId !== resolved.session.activeOrganizationId
    ) {
      await this.sessions.setActiveOrganization(this.db, resolved.session.id, activeOrganizationId);
    }

    if (organizations.length === 0) activeOrganizationId = null;

    return {
      user: toPublicUser(resolved.user),
      organizations,
      activeOrganizationId,
    };
  }

  async switchOrganization(
    resolved: ResolvedSession,
    organizationId: string,
    correlationId: string | null,
  ): Promise<SessionResponse> {
    await this.authorization.requireOrganizationRead(resolved.user.id, organizationId);

    await this.db.transaction(async (tx) => {
      await this.sessions.setActiveOrganization(tx, resolved.session.id, organizationId);
      await this.audit.record(tx, {
        organizationId,
        actorUserId: resolved.user.id,
        actorType: "user",
        action: "auth.organization_switched",
        resourceType: "organization",
        resourceId: organizationId,
        outcome: "success",
        correlationId,
      });
    });

    return this.sessionContext({
      ...resolved,
      session: { ...resolved.session, activeOrganizationId: organizationId },
    });
  }

  async logout(resolved: ResolvedSession, correlationId: string | null): Promise<void> {
    const organizations = await this.authorization.listOrganizations(resolved.user.id);
    const organizationId =
      organizations.find(
        (organization) => organization.id === resolved.session.activeOrganizationId,
      )?.id ??
      organizations[0]?.id ??
      null;

    await this.db.transaction(async (tx) => {
      await this.sessions.revokeSession(tx, resolved.session.id);
      if (organizationId) {
        await this.audit.record(tx, {
          organizationId,
          actorUserId: resolved.user.id,
          actorType: "user",
          action: "auth.logout",
          resourceType: "session",
          resourceId: resolved.session.id,
          outcome: "success",
          correlationId,
        });
      }
    });
  }

  async changePassword(
    resolved: ResolvedSession,
    currentPassword: string,
    newPassword: string,
    correlationId: string | null,
  ): Promise<void> {
    if (newPassword.length < 12 || newPassword.length > 128) {
      throw ApiError.validation("Password must be between 12 and 128 characters");
    }
    const valid = await verifyPassword(resolved.user.passwordHash, currentPassword);
    if (!valid) throw ApiError.unauthorized("Current password is incorrect");

    let newHash: string;
    try {
      newHash = await hashPassword(newPassword);
    } catch (error) {
      throw ApiError.validation(error instanceof Error ? error.message : "Password is not allowed");
    }

    const organizations = await this.authorization.listOrganizations(resolved.user.id);
    const organizationId =
      organizations.find(
        (organization) => organization.id === resolved.session.activeOrganizationId,
      )?.id ??
      organizations[0]?.id ??
      null;

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: newHash,
          passwordUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, resolved.user.id));
      await this.sessions.revokeOtherSessions(tx, resolved.user.id, resolved.session.id);
      if (organizationId) {
        await this.audit.record(tx, {
          organizationId,
          actorUserId: resolved.user.id,
          actorType: "user",
          action: "auth.password_changed",
          resourceType: "user",
          resourceId: resolved.user.id,
          outcome: "success",
          correlationId,
        });
      }
    });
  }

  private async recordLoginFailureSafely(
    userId: string,
    reason: string,
    context: LoginContext,
  ): Promise<void> {
    try {
      const rows = await this.db
        .select({ organizationId: organizationMemberships.organizationId })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, userId))
        .limit(1);
      const organizationId = rows[0]?.organizationId;
      if (!organizationId) return;
      await this.audit.record(this.db, {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "auth.login_failed",
        resourceType: "user",
        resourceId: userId,
        outcome: "failure",
        correlationId: context.correlationId,
        metadata: { reason },
      });
    } catch (error) {
      this.logger.error({ err: error }, "failed to record login failure audit event");
    }
  }
}

export function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
  };
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

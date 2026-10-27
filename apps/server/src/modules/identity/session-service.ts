import type { ServerConfig } from "@hitman/config";
import { sessions, users } from "@hitman/database/schema";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { hashToken, randomToken } from "../shared/crypto.js";
import type { Db, DbExecutor } from "../shared/db.js";

export interface CreateSessionInput {
  userId: string;
  activeOrganizationId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  session: typeof sessions.$inferSelect;
  user: typeof users.$inferSelect;
}

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<ServerConfig, "SESSION_TTL_SECONDS">,
  ) {}

  async createSession(executor: DbExecutor, input: CreateSessionInput): Promise<CreatedSession> {
    const token = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_SECONDS * 1_000);
    const rows = await executor
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrfToken),
        activeOrganizationId: input.activeOrganizationId,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt,
      })
      .returning({ id: sessions.id });

    const session = rows[0];
    if (!session) throw new Error("session insert returned no row");
    return { sessionId: session.id, token, csrfToken, expiresAt };
  }

  async resolveSession(token: string): Promise<ResolvedSession | null> {
    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.user.status !== "active") return null;

    if (Date.now() - row.session.lastSeenAt.getTime() > 60_000) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, row.session.id));
    }

    return row;
  }

  async revokeSession(executor: DbExecutor, sessionId: string): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeOtherSessions(
    executor: DbExecutor,
    userId: string,
    currentSessionId: string,
  ): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          ne(sessions.id, currentSessionId),
        ),
      );
  }

  async revokeAllForUser(executor: DbExecutor, userId: string): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async setActiveOrganization(
    executor: DbExecutor,
    sessionId: string,
    organizationId: string | null,
  ): Promise<void> {
    await executor
      .update(sessions)
      .set({ activeOrganizationId: organizationId, lastSeenAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async clearActiveOrganizationForUserInOrg(
    executor: DbExecutor,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    await executor
      .update(sessions)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.activeOrganizationId, organizationId),
          isNull(sessions.revokedAt),
        ),
      );
  }
}

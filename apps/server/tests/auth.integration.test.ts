import { randomUUID } from "node:crypto";
import type { SessionResponse } from "@hitman/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authenticatedHeaders,
  createTestContext,
  login,
  TEST_PASSWORD,
  type TestContext,
  testDatabaseUrl,
  truncateIdentityTables,
} from "./helpers/identity.js";

const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("identity and organization API", () => {
  let context: TestContext;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
    context = await createTestContext(testDatabaseUrl);
  });

  beforeEach(async () => {
    await truncateIdentityTables(context.database);
  });

  afterAll(async () => {
    await context?.app.close();
    await context?.database.close();
  });

  async function seedOrganization(
    suffix = "a",
  ): Promise<{ organizationId: string; userId: string; email: string; slug: string }> {
    const email = `admin-${suffix}@example.test`;
    const slug = `org-${suffix}`;
    const result = await context.services.provisioning.bootstrapOrganization({
      organizationName: `Organization ${suffix.toUpperCase()}`,
      organizationSlug: slug,
      email,
      displayName: `Admin ${suffix.toUpperCase()}`,
      password: TEST_PASSWORD,
    });
    return { organizationId: result.organizationId, userId: result.userId, email, slug };
  }

  it("logs in, returns a cookie-backed session, and logs out", async () => {
    const admin = await seedOrganization();
    const { response, cookies } = await login(context.app, admin.email);
    expect(response.statusCode).toBe(200);
    const session = response.json<SessionResponse>();
    expect(session.user.email).toBe(admin.email);
    expect(session.activeOrganizationId).toBe(admin.organizationId);
    expect(session.organizations).toHaveLength(1);

    const setCookie = response.headers["set-cookie"];
    const cookieText = Array.isArray(setCookie) ? setCookie.join("\n") : (setCookie ?? "");
    expect(cookieText).toContain("hitman_session=");
    expect(cookieText).toContain("HttpOnly");
    expect(cookieText).toContain("SameSite=Lax");
    expect(cookieText).toContain("hitman_csrf=");

    const current = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: cookies.cookie },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json<SessionResponse>().user.id).toBe(admin.userId);

    const logout = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authenticatedHeaders(cookies),
    });
    expect(logout.statusCode).toBe(204);

    const after = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: cookies.cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it("returns a generic login failure and records an audit event", async () => {
    const admin = await seedOrganization();
    const failed = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: admin.email, password: "this is not the password" },
    });
    expect(failed.statusCode).toBe(401);
    expect(failed.json().error.code).toBe("UNAUTHORIZED");
    expect(failed.json().error.message).toBe("Invalid email or password");
    expect(failed.headers["set-cookie"]).toBeUndefined();

    const { cookies } = await login(context.app, admin.email);
    const audit = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/audit-events`,
      headers: { cookie: cookies.cookie },
    });
    expect(audit.statusCode).toBe(200);
    const events = audit.json().events as Array<{ action: string }>;
    expect(events.some((event) => event.action === "auth.login_failed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("this is not the password");
  });

  it("requires a matching CSRF header for state-changing requests", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);

    const missing = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: cookies.cookie },
    });
    expect(missing.statusCode).toBe(403);

    const wrong = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: cookies.cookie, "x-csrf-token": "wrong-token" },
    });
    expect(wrong.statusCode).toBe(403);

    const valid = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authenticatedHeaders(cookies),
    });
    expect(valid.statusCode).toBe(204);
  });

  it("does not reveal another organization through ID guessing", async () => {
    const adminA = await seedOrganization("a");
    const adminB = await seedOrganization("b");
    const { cookies } = await login(context.app, adminA.email);

    const own = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${adminA.organizationId}`,
      headers: { cookie: cookies.cookie },
    });
    expect(own.statusCode).toBe(200);

    for (const suffix of ["", "/members", "/teams", "/audit-events"]) {
      const other = await context.app.inject({
        method: "GET",
        url: `/api/v1/organizations/${adminB.organizationId}${suffix}`,
        headers: { cookie: cookies.cookie },
      });
      expect(other.statusCode).toBe(404);
    }
  });

  it("allows members to read but not administer an organization", async () => {
    const admin = await seedOrganization();
    const memberEmail = "member@example.test";
    await context.services.provisioning.addUserToOrganization({
      organizationSlug: admin.slug,
      email: memberEmail,
      displayName: "Member User",
      role: "member",
      password: TEST_PASSWORD,
    });
    const { cookies } = await login(context.app, memberEmail);

    const read = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/members`,
      headers: { cookie: cookies.cookie },
    });
    expect(read.statusCode).toBe(200);

    const write = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${admin.organizationId}`,
      headers: authenticatedHeaders(cookies),
      payload: { name: "Hijacked" },
    });
    expect(write.statusCode).toBe(403);

    const createTeam = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${admin.organizationId}/teams`,
      headers: authenticatedHeaders(cookies),
      payload: { name: "Member Team", slug: "member-team" },
    });
    expect(createTeam.statusCode).toBe(403);
  });

  it("prevents removing or demoting the last organization administrator", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);

    const demote = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${admin.organizationId}/members/${admin.userId}`,
      headers: authenticatedHeaders(cookies),
      payload: { role: "member" },
    });
    expect(demote.statusCode).toBe(409);

    const remove = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/organizations/${admin.organizationId}/members/${admin.userId}`,
      headers: authenticatedHeaders(cookies),
    });
    expect(remove.statusCode).toBe(409);
  });

  it("manages teams and records auditable team changes", async () => {
    const admin = await seedOrganization();
    const memberEmail = "team-member@example.test";
    const member = await context.services.provisioning.addUserToOrganization({
      organizationSlug: admin.slug,
      email: memberEmail,
      displayName: "Team Member",
      role: "member",
      password: TEST_PASSWORD,
    });
    const { cookies } = await login(context.app, admin.email);

    const created = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${admin.organizationId}/teams`,
      headers: authenticatedHeaders(cookies),
      payload: { name: "Platform", slug: "platform" },
    });
    expect(created.statusCode).toBe(201);
    const team = created.json() as { id: string };

    const added = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${admin.organizationId}/teams/${team.id}/members`,
      headers: authenticatedHeaders(cookies),
      payload: { email: memberEmail, role: "member" },
    });
    expect(added.statusCode).toBe(201);

    const detail = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/teams/${team.id}`,
      headers: { cookie: cookies.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().memberCount).toBe(1);
    expect(detail.json().members[0].user.email).toBe(memberEmail);

    const removed = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/organizations/${admin.organizationId}/members/${member.userId}`,
      headers: authenticatedHeaders(cookies),
    });
    expect(removed.statusCode).toBe(204);

    const afterRemoval = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/teams/${team.id}`,
      headers: { cookie: cookies.cookie },
    });
    expect(afterRemoval.statusCode).toBe(200);
    expect(afterRemoval.json().memberCount).toBe(0);

    const audit = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/audit-events`,
      headers: { cookie: cookies.cookie },
    });
    const actions = (audit.json().events as Array<{ action: string }>).map((event) => event.action);
    expect(actions).toContain("team.created");
    expect(actions).toContain("team.member_added");
    expect(JSON.stringify(audit.json())).not.toContain(TEST_PASSWORD);
  });

  it("revokes access after session expiry or account disablement", async () => {
    const admin = await seedOrganization();
    const first = await login(context.app, admin.email);
    await context.database.pool.query(
      "update sessions set expires_at = now() - interval '1 second' where user_id = $1",
      [admin.userId],
    );
    const expired = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: first.cookies.cookie },
    });
    expect(expired.statusCode).toBe(401);

    const second = await login(context.app, admin.email);
    await context.database.pool.query("update users set status = 'disabled' where id = $1", [
      admin.userId,
    ]);
    const disabledSession = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: second.cookies.cookie },
    });
    expect(disabledSession.statusCode).toBe(401);

    const disabledLogin = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: admin.email, password: TEST_PASSWORD },
    });
    expect(disabledLogin.statusCode).toBe(401);
  });

  it("revokes sessions when an administrator disables and re-enables a user", async () => {
    const admin = await seedOrganization();
    const loginResult = await login(context.app, admin.email);
    await context.services.provisioning.setUserStatus(admin.email, "disabled");

    const disabledSession = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: loginResult.cookies.cookie },
    });
    expect(disabledSession.statusCode).toBe(401);

    const disabledLogin = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: admin.email, password: TEST_PASSWORD },
    });
    expect(disabledLogin.statusCode).toBe(401);

    await context.services.provisioning.setUserStatus(admin.email, "active");
    const restored = await login(context.app, admin.email);
    expect(restored.response.statusCode).toBe(200);
  });

  it("changes the password and revokes other sessions", async () => {
    const admin = await seedOrganization();
    const first = await login(context.app, admin.email);
    const second = await login(context.app, admin.email);
    const newPassword = "another correct horse battery staple";

    const changed = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: authenticatedHeaders(first.cookies),
      payload: { currentPassword: TEST_PASSWORD, newPassword },
    });
    expect(changed.statusCode).toBe(204);

    const revoked = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: second.cookies.cookie },
    });
    expect(revoked.statusCode).toBe(401);

    const oldLogin = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: admin.email, password: TEST_PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: admin.email, password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("adds an existing user from another organization to the active organization", async () => {
    const admin = await seedOrganization("a");
    const otherAdmin = await seedOrganization("b");
    const { cookies } = await login(context.app, admin.email);

    const added = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${admin.organizationId}/members`,
      headers: authenticatedHeaders(cookies),
      payload: { email: otherAdmin.email, role: "read_only" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().role).toBe("read_only");

    const members = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/members`,
      headers: { cookie: cookies.cookie },
    });
    expect(
      (members.json().members as Array<{ user: { email: string } }>).some(
        (member) => member.user.email === otherAdmin.email,
      ),
    ).toBe(true);
  });

  it("rate-limits repeated failed login attempts", async () => {
    const limited = await createTestContext(testDatabaseUrl as string, {
      LOGIN_RATE_LIMIT_MAX: 2,
    });
    try {
      const admin = await limited.services.provisioning.bootstrapOrganization({
        organizationName: "Rate Limit Org",
        organizationSlug: "rate-limit-org",
        email: "rate-admin@example.test",
        displayName: "Rate Admin",
        password: TEST_PASSWORD,
      });
      expect(admin.organizationId).toBeTruthy();

      const first = await limited.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "rate-admin@example.test", password: "wrong password" },
      });
      const second = await limited.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "rate-admin@example.test", password: "wrong password" },
      });
      const third = await limited.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "rate-admin@example.test", password: "wrong password" },
      });
      expect(first.statusCode).toBe(401);
      expect(second.statusCode).toBe(401);
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe("RATE_LIMITED");
    } finally {
      await limited.app.close();
      await limited.database.close();
    }
  });

  it("switches the active organization only when membership exists", async () => {
    const adminA = await seedOrganization("a");
    const adminB = await seedOrganization("b");
    for (const slug of [adminA.slug, adminB.slug]) {
      await context.services.provisioning.addUserToOrganization({
        organizationSlug: slug,
        email: "multi@example.test",
        displayName: "Multi Org",
        role: "member",
        password: TEST_PASSWORD,
      });
    }
    const { cookies } = await login(context.app, "multi@example.test");
    const session = await context.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: cookies.cookie },
    });
    expect(session.json<SessionResponse>().organizations).toHaveLength(2);

    const switched = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-organization",
      headers: authenticatedHeaders(cookies),
      payload: { organizationId: adminB.organizationId },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json<SessionResponse>().activeOrganizationId).toBe(adminB.organizationId);

    const missing = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-organization",
      headers: authenticatedHeaders(cookies),
      payload: { organizationId: randomUUID() },
    });
    expect(missing.statusCode).toBe(404);
  });
});

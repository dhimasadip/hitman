import type { ProjectDetail, ProjectRepository, ProjectSummary } from "@hitman/contracts";
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

describeWithDatabase("projects and mock GitLab API", () => {
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

  async function addUser(
    organizationSlug: string,
    email: string,
    role: "org_admin" | "member" | "read_only",
  ): Promise<string> {
    const result = await context.services.provisioning.addUserToOrganization({
      organizationSlug,
      email,
      displayName: email.split("@")[0],
      role,
      password: TEST_PASSWORD,
    });
    return result.userId;
  }

  async function createProject(
    cookies: Awaited<ReturnType<typeof login>>["cookies"],
    organizationId: string,
    body: { name: string; slug: string; description?: string; ownerTeamId?: string },
  ): Promise<ProjectDetail> {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/projects`,
      headers: authenticatedHeaders(cookies),
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    return response.json<ProjectDetail>();
  }

  it("creates a project without repository, specification, or runner", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);
    const project = await createProject(cookies, admin.organizationId, {
      name: "App A",
      slug: "app-a",
      description: "Primary application",
    });

    expect(project.status).toBe("active");
    expect(project.role).toBe("project_admin");
    expect(project.memberCount).toBe(1);
    expect(project.repositoryLinked).toBe(false);

    const members = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/members`,
      headers: { cookie: cookies.cookie },
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toEqual([expect.objectContaining({ role: "project_admin" })]);

    const audit = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/audit-events`,
      headers: { cookie: cookies.cookie },
    });
    expect(
      (audit.json().events as Array<{ action: string }>).some(
        (event) => event.action === "project.created",
      ),
    ).toBe(true);
  });

  it("allows only organization admins to create projects", async () => {
    const admin = await seedOrganization();
    await addUser(admin.slug, "member@example.test", "member");
    const member = await login(context.app, "member@example.test");

    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${admin.organizationId}/projects`,
      headers: authenticatedHeaders(member.cookies),
      payload: { name: "Not Allowed", slug: "not-allowed" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("shows all projects to organization admins and only assigned projects to members", async () => {
    const admin = await seedOrganization();
    await addUser(admin.slug, "member@example.test", "member");
    const adminLogin = await login(context.app, admin.email);
    const memberLogin = await login(context.app, "member@example.test");

    const assigned = await createProject(adminLogin.cookies, admin.organizationId, {
      name: "Assigned",
      slug: "assigned",
    });
    await createProject(adminLogin.cookies, admin.organizationId, {
      name: "Unassigned",
      slug: "unassigned",
    });

    const added = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${assigned.id}/members`,
      headers: authenticatedHeaders(adminLogin.cookies),
      payload: { email: "member@example.test", role: "viewer" },
    });
    expect(added.statusCode).toBe(201);

    const adminList = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/projects`,
      headers: { cookie: adminLogin.cookies.cookie },
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().projects).toHaveLength(2);

    const memberList = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/projects`,
      headers: { cookie: memberLogin.cookies.cookie },
    });
    expect(memberList.statusCode).toBe(200);
    expect(memberList.json<{ projects: ProjectSummary[] }>().projects.map((p) => p.id)).toEqual([
      assigned.id,
    ]);
    expect(memberList.json().projects[0].role).toBe("viewer");
  });

  it("supports search and team ownership metadata", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);
    const teamResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${admin.organizationId}/teams`,
      headers: authenticatedHeaders(cookies),
      payload: { name: "Platform", slug: "platform" },
    });
    expect(teamResponse.statusCode).toBe(201);
    const team = teamResponse.json() as { id: string };

    const project = await createProject(cookies, admin.organizationId, {
      name: "Billing",
      slug: "billing",
      ownerTeamId: team.id,
    });
    expect(project.ownerTeamName).toBe("Platform");

    await createProject(cookies, admin.organizationId, {
      name: "Identity",
      slug: "identity",
    });

    const search = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/projects?q=billing`,
      headers: { cookie: cookies.cookie },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().projects).toHaveLength(1);
    expect(search.json().projects[0].slug).toBe("billing");
  });

  it("protects the last project administrator", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);
    const project = await createProject(cookies, admin.organizationId, {
      name: "Protected",
      slug: "protected",
    });

    const demote = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/members/${admin.userId}`,
      headers: authenticatedHeaders(cookies),
      payload: { role: "viewer" },
    });
    expect(demote.statusCode).toBe(409);

    const remove = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/members/${admin.userId}`,
      headers: authenticatedHeaders(cookies),
    });
    expect(remove.statusCode).toBe(409);
  });

  it("does not reveal projects from another organization", async () => {
    const adminA = await seedOrganization("a");
    const adminB = await seedOrganization("b");
    const loginA = await login(context.app, adminA.email);
    const loginB = await login(context.app, adminB.email);
    const projectB = await createProject(loginB.cookies, adminB.organizationId, {
      name: "Secret",
      slug: "secret",
    });

    const response = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectB.id}`,
      headers: { cookie: loginA.cookies.cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("archives and restores projects and blocks edits while archived", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);
    const project = await createProject(cookies, admin.organizationId, {
      name: "Archive Me",
      slug: "archive-me",
    });

    const archived = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/archive`,
      headers: authenticatedHeaders(cookies),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<ProjectDetail>().status).toBe("archived");

    const edit = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: authenticatedHeaders(cookies),
      payload: { name: "Changed" },
    });
    expect(edit.statusCode).toBe(409);

    const defaultList = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/projects`,
      headers: { cookie: cookies.cookie },
    });
    expect(defaultList.json().projects).toHaveLength(0);

    const archivedList = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/projects?status=archived`,
      headers: { cookie: cookies.cookie },
    });
    expect(archivedList.json().projects).toHaveLength(1);

    const restored = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/restore`,
      headers: authenticatedHeaders(cookies),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<ProjectDetail>().status).toBe("active");
  });

  it("links, updates, and unlinks a mocked GitLab repository", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);
    const project = await createProject(cookies, admin.organizationId, {
      name: "Source App",
      slug: "source-app",
    });

    const fixtures = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/gitlab/repositories`,
      headers: { cookie: cookies.cookie },
    });
    expect(fixtures.statusCode).toBe(200);
    expect(fixtures.json().repositories).toHaveLength(3);
    expect(fixtures.json().repositories[0].repositoryName).toBe("app-a");

    const link = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/repository`,
      headers: authenticatedHeaders(cookies),
      payload: { externalProjectId: "1001", openapiFilePath: "api/openapi.yaml" },
    });
    expect(link.statusCode).toBe(201);
    const repository = link.json<ProjectRepository>();
    expect(repository.mock).toBe(true);
    expect(repository.connection.authMode).toBe("mock");
    expect(repository.repositoryName).toBe("app-a");
    expect(repository.openapiFilePath).toBe("api/openapi.yaml");

    const secondProject = await createProject(cookies, admin.organizationId, {
      name: "Other App",
      slug: "other-app",
    });
    const available = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${secondProject.id}/gitlab/repositories`,
      headers: { cookie: cookies.cookie },
    });
    expect(
      (available.json().repositories as Array<{ externalProjectId: string }>).some(
        (candidate) => candidate.externalProjectId === "1001",
      ),
    ).toBe(false);

    const duplicate = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${secondProject.id}/repository`,
      headers: authenticatedHeaders(cookies),
      payload: { externalProjectId: "1001" },
    });
    expect(duplicate.statusCode).toBe(409);

    const updated = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/repository`,
      headers: authenticatedHeaders(cookies),
      payload: { openapiFilePath: "spec/openapi.yaml" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<ProjectRepository>().openapiFilePath).toBe("spec/openapi.yaml");

    const unlinked = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/repository`,
      headers: authenticatedHeaders(cookies),
    });
    expect(unlinked.statusCode).toBe(204);

    const none = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/repository`,
      headers: { cookie: cookies.cookie },
    });
    expect(none.json().repository).toBeNull();

    const audit = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/audit-events`,
      headers: { cookie: cookies.cookie },
    });
    const actions = (audit.json().events as Array<{ action: string }>).map((event) => event.action);
    expect(actions).toContain("project.repository_linked");
    expect(actions).toContain("project.repository_updated");
    expect(actions).toContain("project.repository_unlinked");
  });

  it("rejects repository paths that could escape the repository", async () => {
    const admin = await seedOrganization();
    const { cookies } = await login(context.app, admin.email);
    const project = await createProject(cookies, admin.organizationId, {
      name: "Path Guard",
      slug: "path-guard",
    });

    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/repository`,
      headers: authenticatedHeaders(cookies),
      payload: { externalProjectId: "1001", openapiFilePath: "../secrets.yaml" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("allows project admins and organization admins to manage a project", async () => {
    const admin = await seedOrganization();
    const projectAdminId = await addUser(admin.slug, "project-admin@example.test", "member");
    const orgAdminId = await addUser(admin.slug, "org-admin-2@example.test", "org_admin");
    expect(projectAdminId).not.toBe(orgAdminId);

    const adminLogin = await login(context.app, admin.email);
    const project = await createProject(adminLogin.cookies, admin.organizationId, {
      name: "Shared",
      slug: "shared",
    });

    const addProjectAdmin = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: authenticatedHeaders(adminLogin.cookies),
      payload: { email: "project-admin@example.test", role: "project_admin" },
    });
    expect(addProjectAdmin.statusCode).toBe(201);

    const projectAdminLogin = await login(context.app, "project-admin@example.test");
    const update = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: authenticatedHeaders(projectAdminLogin.cookies),
      payload: { description: "Updated by project admin" },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json<ProjectDetail>().description).toBe("Updated by project admin");

    const orgAdminLogin = await login(context.app, "org-admin-2@example.test");
    const orgAdminView = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie: orgAdminLogin.cookies.cookie },
    });
    expect(orgAdminView.statusCode).toBe(200);
    expect(orgAdminView.json<ProjectDetail>().role).toBe("project_admin");
  });

  it("removes project memberships when an organization member is removed", async () => {
    const admin = await seedOrganization();
    const memberId = await addUser(admin.slug, "removed-member@example.test", "member");
    const adminLogin = await login(context.app, admin.email);
    const project = await createProject(adminLogin.cookies, admin.organizationId, {
      name: "Membership Cleanup",
      slug: "membership-cleanup",
    });
    const added = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: authenticatedHeaders(adminLogin.cookies),
      payload: { email: "removed-member@example.test", role: "viewer" },
    });
    expect(added.statusCode).toBe(201);

    const removed = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/organizations/${admin.organizationId}/members/${memberId}`,
      headers: authenticatedHeaders(adminLogin.cookies),
    });
    expect(removed.statusCode).toBe(204);

    const members = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/members`,
      headers: { cookie: adminLogin.cookies.cookie },
    });
    expect(
      (members.json().members as Array<{ user: { email: string } }>).some(
        (member) => member.user.email === "removed-member@example.test",
      ),
    ).toBe(false);
  });

  it("prevents organization read-only users from using project write access", async () => {
    const admin = await seedOrganization();
    await addUser(admin.slug, "read-only-project-admin@example.test", "read_only");
    const adminLogin = await login(context.app, admin.email);
    const project = await createProject(adminLogin.cookies, admin.organizationId, {
      name: "Read Only Guard",
      slug: "read-only-guard",
    });
    const added = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: authenticatedHeaders(adminLogin.cookies),
      payload: { email: "read-only-project-admin@example.test", role: "project_admin" },
    });
    expect(added.statusCode).toBe(201);

    const readOnlyLogin = await login(context.app, "read-only-project-admin@example.test");
    const update = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: authenticatedHeaders(readOnlyLogin.cookies),
      payload: { description: "Not allowed" },
    });
    expect(update.statusCode).toBe(403);
  });

  it("blocks organization removal when the member is a project's last administrator", async () => {
    const admin = await seedOrganization();
    const memberId = await addUser(admin.slug, "last-project-admin@example.test", "member");
    const adminLogin = await login(context.app, admin.email);
    const project = await createProject(adminLogin.cookies, admin.organizationId, {
      name: "Last Admin Guard",
      slug: "last-admin-guard",
    });
    const added = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: authenticatedHeaders(adminLogin.cookies),
      payload: { email: "last-project-admin@example.test", role: "project_admin" },
    });
    expect(added.statusCode).toBe(201);

    const removeCreatorFromProject = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/members/${admin.userId}`,
      headers: authenticatedHeaders(adminLogin.cookies),
    });
    expect(removeCreatorFromProject.statusCode).toBe(204);

    const removeFromOrg = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/organizations/${admin.organizationId}/members/${memberId}`,
      headers: authenticatedHeaders(adminLogin.cookies),
    });
    expect(removeFromOrg.statusCode).toBe(409);
  });

  it("rejects adding a user who is not an organization member", async () => {
    const adminA = await seedOrganization("a");
    const adminB = await seedOrganization("b");
    const loginA = await login(context.app, adminA.email);
    const project = await createProject(loginA.cookies, adminA.organizationId, {
      name: "Membership Guard",
      slug: "membership-guard",
    });

    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: authenticatedHeaders(loginA.cookies),
      payload: { email: adminB.email, role: "viewer" },
    });
    expect(response.statusCode).toBe(409);
  });
});

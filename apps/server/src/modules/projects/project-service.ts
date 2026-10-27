import {
  ApiError,
  type CreateProjectRequest,
  type MockRepository,
  type ProjectDetail,
  type ProjectMember,
  type ProjectRepository,
  type ProjectRole,
  type ProjectStatusFilter,
  type ProjectSummary,
  type UpdateProjectRequest,
} from "@hitman/contracts";
import {
  gitlabConnections,
  gitlabRepositories,
  organizationMemberships,
  projectMemberships,
  projects,
  teams,
  users,
} from "@hitman/database/schema";
import { and, asc, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { AuditService } from "../audit/audit-service.js";
import type {
  AuthorizationService,
  ProjectAccess,
} from "../authorization/authorization-service.js";
import type { GitLabProvider } from "../gitlab/gitlab-provider.js";
import type { Db, DbExecutor } from "../shared/db.js";
import { isUniqueViolation } from "../shared/db.js";
import { normalizeEmail } from "../shared/validation.js";

const MOCK_CONNECTION_URL = "https://gitlab.com";
const MOCK_SECRET_REF = "env://GITLAB_MOCK_TOKEN";
export class ProjectService {
  constructor(
    private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly gitlab: GitLabProvider,
  ) {}

  async createProject(
    actorUserId: string,
    organizationId: string,
    input: CreateProjectRequest,
    correlationId: string | null,
  ): Promise<ProjectDetail> {
    await this.authorization.requireOrganizationAdmin(actorUserId, organizationId);
    await this.assertOwnerTeam(organizationId, input.ownerTeamId ?? null);

    try {
      const project = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(projects)
          .values({
            organizationId,
            ownerTeamId: input.ownerTeamId ?? null,
            name: input.name.trim(),
            slug: input.slug,
            description: normalizeDescription(input.description),
            createdBy: actorUserId,
          })
          .returning();
        const created = rows[0];
        if (!created) throw new Error("project insert returned no row");

        await tx.insert(projectMemberships).values({
          projectId: created.id,
          userId: actorUserId,
          role: "project_admin",
        });

        await this.audit.record(tx, {
          organizationId,
          actorUserId,
          actorType: "user",
          action: "project.created",
          resourceType: "project",
          resourceId: created.id,
          projectId: created.id,
          outcome: "success",
          correlationId,
          metadata: { slug: created.slug },
        });

        return created;
      });

      return this.getProject(actorUserId, project.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("A project with this slug already exists in the organization");
      }
      throw error;
    }
  }

  async listProjects(
    userId: string,
    organizationId: string,
    filters: { search?: string; status?: ProjectStatusFilter; limit?: number } = {},
  ): Promise<ProjectSummary[]> {
    const organizationRole = await this.authorization.requireOrganizationRead(
      userId,
      organizationId,
    );
    const isAdmin = organizationRole === "org_admin";
    const status = filters.status ?? "active";
    const conditions: SQL[] = [eq(projects.organizationId, organizationId)];
    if (status !== "all") conditions.push(eq(projects.status, status));
    const search = filters.search?.trim();
    if (search) {
      const term = `%${search.replace(/[%_]/g, "\\$&")}%`;
      const searchCondition = or(
        ilike(projects.name, term),
        ilike(projects.slug, term),
        ilike(projects.description, term),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);

    if (isAdmin) {
      const rows = await this.db
        .select({
          project: projects,
          ownerTeamName: teams.name,
          memberCount: sql<number>`(select count(*)::int from ${projectMemberships} where ${projectMemberships.projectId} = ${projects.id})`,
          repositoryLinked: sql<boolean>`exists (select 1 from ${gitlabRepositories} where ${gitlabRepositories.projectId} = ${projects.id})`,
        })
        .from(projects)
        .leftJoin(teams, eq(teams.id, projects.ownerTeamId))
        .where(and(...conditions))
        .orderBy(desc(projects.updatedAt))
        .limit(limit);

      return rows.map((row) =>
        toSummary(
          row.project,
          "project_admin",
          row.ownerTeamName,
          Number(row.memberCount),
          Boolean(row.repositoryLinked),
        ),
      );
    }

    const rows = await this.db
      .select({
        project: projects,
        ownerTeamName: teams.name,
        role: projectMemberships.role,
        memberCount: sql<number>`(select count(*)::int from ${projectMemberships} where ${projectMemberships.projectId} = ${projects.id})`,
        repositoryLinked: sql<boolean>`exists (select 1 from ${gitlabRepositories} where ${gitlabRepositories.projectId} = ${projects.id})`,
      })
      .from(projects)
      .innerJoin(
        projectMemberships,
        and(eq(projectMemberships.projectId, projects.id), eq(projectMemberships.userId, userId)),
      )
      .leftJoin(teams, eq(teams.id, projects.ownerTeamId))
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt))
      .limit(limit);

    return rows.map((row) =>
      toSummary(
        row.project,
        row.role,
        row.ownerTeamName,
        Number(row.memberCount),
        Boolean(row.repositoryLinked),
      ),
    );
  }

  async getProject(userId: string, projectId: string): Promise<ProjectDetail> {
    const access = await this.authorization.requireProjectRead(userId, projectId);
    return this.toDetail(access);
  }

  async updateProject(
    actorUserId: string,
    projectId: string,
    input: UpdateProjectRequest,
    correlationId: string | null,
  ): Promise<ProjectDetail> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    if (input.ownerTeamId !== undefined) {
      await this.assertOwnerTeam(access.project.organizationId, input.ownerTeamId);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: normalizeDescription(input.description) }
            : {}),
          ...(input.ownerTeamId !== undefined ? { ownerTeamId: input.ownerTeamId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.updated",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
      });
    });

    return this.getProject(actorUserId, projectId);
  }

  async archiveProject(
    actorUserId: string,
    projectId: string,
    correlationId: string | null,
  ): Promise<ProjectDetail> {
    await this.authorization.requireProjectManage(actorUserId, projectId);
    const current = await this.getProject(actorUserId, projectId);
    if (current.status === "archived") return current;

    await this.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId: current.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.archived",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
      });
    });

    return this.getProject(actorUserId, projectId);
  }

  async restoreProject(
    actorUserId: string,
    projectId: string,
    correlationId: string | null,
  ): Promise<ProjectDetail> {
    await this.authorization.requireProjectManage(actorUserId, projectId);
    const current = await this.getProject(actorUserId, projectId);
    if (current.status === "active") return current;

    await this.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ status: "active", archivedAt: null, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId: current.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.restored",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
      });
    });

    return this.getProject(actorUserId, projectId);
  }

  async listMembers(userId: string, projectId: string): Promise<ProjectMember[]> {
    const access = await this.authorization.requireProjectRead(userId, projectId);
    return this.membersForProject(access.project.id);
  }

  async addMember(
    actorUserId: string,
    projectId: string,
    emailInput: string,
    role: ProjectRole,
    correlationId: string | null,
  ): Promise<ProjectMember> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    const email = normalizeEmail(emailInput);
    const userRows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = userRows[0];
    if (!user) throw ApiError.notFound("User not found");

    const organizationMembership = await this.db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, access.project.organizationId),
          eq(organizationMemberships.userId, user.id),
        ),
      )
      .limit(1);
    if (!organizationMembership[0]) {
      throw ApiError.conflict("User must be an organization member before joining a project");
    }

    try {
      const membership = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(projectMemberships)
          .values({ projectId, userId: user.id, role })
          .returning({ createdAt: projectMemberships.createdAt });
        const created = rows[0];
        if (!created) throw new Error("project membership insert returned no row");
        await this.audit.record(tx, {
          organizationId: access.project.organizationId,
          actorUserId,
          actorType: "user",
          action: "project.member_added",
          resourceType: "project",
          resourceId: projectId,
          projectId,
          outcome: "success",
          correlationId,
          metadata: { userId: user.id, role },
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
        throw ApiError.conflict("User is already a project member");
      }
      throw error;
    }
  }

  async updateMemberRole(
    actorUserId: string,
    projectId: string,
    targetUserId: string,
    role: ProjectRole,
    correlationId: string | null,
  ): Promise<void> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    await this.db.transaction(async (tx) => {
      await this.lockMemberships(tx, projectId);
      const target = await this.findMembership(tx, projectId, targetUserId);
      if (!target) throw ApiError.notFound("Project member not found");
      if (target.role === "project_admin" && role !== "project_admin") {
        await this.ensureNotLastAdmin(tx, projectId);
      }
      await tx
        .update(projectMemberships)
        .set({ role })
        .where(
          and(
            eq(projectMemberships.projectId, projectId),
            eq(projectMemberships.userId, targetUserId),
          ),
        );
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.member_role_changed",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { userId: targetUserId, from: target.role, to: role },
      });
    });
  }

  async removeMember(
    actorUserId: string,
    projectId: string,
    targetUserId: string,
    correlationId: string | null,
  ): Promise<void> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    await this.db.transaction(async (tx) => {
      await this.lockMemberships(tx, projectId);
      const target = await this.findMembership(tx, projectId, targetUserId);
      if (!target) throw ApiError.notFound("Project member not found");
      if (target.role === "project_admin") {
        await this.ensureNotLastAdmin(tx, projectId);
      }
      await tx
        .delete(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, projectId),
            eq(projectMemberships.userId, targetUserId),
          ),
        );
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.member_removed",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { userId: targetUserId, role: target.role },
      });
    });
  }

  async getRepository(userId: string, projectId: string): Promise<ProjectRepository | null> {
    await this.authorization.requireProjectRead(userId, projectId);
    return this.repositoryForProject(projectId);
  }

  async listMockRepositories(userId: string, projectId: string): Promise<MockRepository[]> {
    const access = await this.authorization.requireProjectManage(userId, projectId);
    this.ensureActive(access);
    const connection = await this.ensureMockConnection(
      this.db,
      access.project.organizationId,
      userId,
    );
    const linked = await this.db
      .select({ externalProjectId: gitlabRepositories.externalProjectId })
      .from(gitlabRepositories)
      .where(eq(gitlabRepositories.gitlabConnectionId, connection.id));
    const linkedIds = new Set(linked.map((row) => row.externalProjectId));
    const repositories = await this.gitlab.listRepositories();
    return repositories.filter((repository) => !linkedIds.has(repository.externalProjectId));
  }

  async linkRepository(
    actorUserId: string,
    projectId: string,
    externalProjectId: string,
    openapiFilePath: string | undefined,
    correlationId: string | null,
  ): Promise<ProjectRepository> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    const fixture = await this.gitlab.getRepository(externalProjectId);
    if (!fixture) throw ApiError.notFound("Repository not found in the mock GitLab catalog");

    try {
      await this.db.transaction(async (tx) => {
        const connection = await this.ensureMockConnection(
          tx,
          access.project.organizationId,
          actorUserId,
        );
        await tx.insert(gitlabRepositories).values({
          projectId,
          gitlabConnectionId: connection.id,
          externalProjectId: fixture.externalProjectId,
          namespacePath: fixture.namespacePath,
          repositoryName: fixture.repositoryName,
          repositoryUrl: fixture.repositoryUrl,
          defaultBranch: fixture.defaultBranch,
          openapiFilePath: openapiFilePath ?? fixture.openapiFilePath,
          webhookStatus: "mock",
        });
        await this.audit.record(tx, {
          organizationId: access.project.organizationId,
          actorUserId,
          actorType: "user",
          action: "project.repository_linked",
          resourceType: "project",
          resourceId: projectId,
          projectId,
          outcome: "success",
          correlationId,
          metadata: {
            externalProjectId: fixture.externalProjectId,
            namespacePath: fixture.namespacePath,
            repositoryName: fixture.repositoryName,
            mocked: true,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict(
          "This project already has a repository, or the repository is linked to another project",
        );
      }
      throw error;
    }

    const repository = await this.repositoryForProject(projectId);
    if (!repository) throw new Error("repository link disappeared after create");
    return repository;
  }

  async updateRepository(
    actorUserId: string,
    projectId: string,
    openapiFilePath: string | null,
    correlationId: string | null,
  ): Promise<ProjectRepository> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(gitlabRepositories)
        .set({ openapiFilePath, updatedAt: new Date() })
        .where(eq(gitlabRepositories.projectId, projectId))
        .returning({ id: gitlabRepositories.id });
      if (rows.length === 0) throw ApiError.notFound("Project repository not found");
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.repository_updated",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { openapiFilePath },
      });
      return rows[0];
    });

    if (!updated) throw new Error("repository update returned no row");

    const repository = await this.repositoryForProject(projectId);
    if (!repository) throw new Error("repository disappeared after update");
    return repository;
  }

  async unlinkRepository(
    actorUserId: string,
    projectId: string,
    correlationId: string | null,
  ): Promise<void> {
    const access = await this.authorization.requireProjectManage(actorUserId, projectId);
    this.ensureActive(access);
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(gitlabRepositories)
        .where(eq(gitlabRepositories.projectId, projectId))
        .returning({ id: gitlabRepositories.id });
      if (removed.length === 0) throw ApiError.notFound("Project repository not found");
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId,
        actorType: "user",
        action: "project.repository_unlinked",
        resourceType: "project",
        resourceId: projectId,
        projectId,
        outcome: "success",
        correlationId,
      });
    });
  }

  private async toDetail(access: ProjectAccess): Promise<ProjectDetail> {
    const project = access.project;
    const [counts, owner, creator, repository] = await Promise.all([
      this.db
        .select({ memberCount: sql<number>`count(*)::int` })
        .from(projectMemberships)
        .where(eq(projectMemberships.projectId, project.id)),
      project.ownerTeamId
        ? this.db
            .select({ name: teams.name })
            .from(teams)
            .where(eq(teams.id, project.ownerTeamId))
            .limit(1)
        : Promise.resolve([]),
      this.db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, project.createdBy))
        .limit(1),
      this.repositoryForProject(project.id),
    ]);

    return {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      role: access.effectiveRole,
      ownerTeamId: project.ownerTeamId,
      ownerTeamName: owner[0]?.name ?? null,
      memberCount: Number(counts[0]?.memberCount ?? 0),
      repositoryLinked: repository !== null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      archivedAt: project.archivedAt?.toISOString() ?? null,
      settings: project.settings,
      createdBy: project.createdBy,
      createdByName: creator[0]?.displayName ?? null,
    };
  }

  private async membersForProject(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        role: projectMemberships.role,
        createdAt: projectMemberships.createdAt,
      })
      .from(projectMemberships)
      .innerJoin(users, eq(users.id, projectMemberships.userId))
      .where(eq(projectMemberships.projectId, projectId))
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

  private async repositoryForProject(projectId: string): Promise<ProjectRepository | null> {
    const rows = await this.db
      .select({
        repository: gitlabRepositories,
        connection: gitlabConnections,
      })
      .from(gitlabRepositories)
      .innerJoin(gitlabConnections, eq(gitlabConnections.id, gitlabRepositories.gitlabConnectionId))
      .where(eq(gitlabRepositories.projectId, projectId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.repository.id,
      projectId: row.repository.projectId,
      externalProjectId: row.repository.externalProjectId,
      namespacePath: row.repository.namespacePath,
      repositoryName: row.repository.repositoryName,
      repositoryUrl: row.repository.repositoryUrl,
      defaultBranch: row.repository.defaultBranch,
      openapiFilePath: row.repository.openapiFilePath,
      webhookStatus: row.repository.webhookStatus,
      lastReconciledAt: row.repository.lastReconciledAt?.toISOString() ?? null,
      mock: row.connection.authMode === "mock",
      connection: {
        id: row.connection.id,
        instanceUrl: row.connection.gitlabInstanceUrl,
        authMode: row.connection.authMode,
        status: row.connection.status,
        lastVerifiedAt: row.connection.lastVerifiedAt?.toISOString() ?? null,
      },
      createdAt: row.repository.createdAt.toISOString(),
      updatedAt: row.repository.updatedAt.toISOString(),
    };
  }

  private async ensureMockConnection(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<typeof gitlabConnections.$inferSelect> {
    const existing = await executor
      .select()
      .from(gitlabConnections)
      .where(
        and(
          eq(gitlabConnections.organizationId, organizationId),
          eq(gitlabConnections.authMode, "mock"),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const rows = await executor
      .insert(gitlabConnections)
      .values({
        organizationId,
        gitlabInstanceUrl: MOCK_CONNECTION_URL,
        authMode: "mock",
        credentialSecretRef: MOCK_SECRET_REF,
        status: "mock",
        lastVerifiedAt: new Date(),
        createdBy: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0];

    const existingRows = await executor
      .select()
      .from(gitlabConnections)
      .where(
        and(
          eq(gitlabConnections.organizationId, organizationId),
          eq(gitlabConnections.authMode, "mock"),
        ),
      )
      .limit(1);
    const existingConnection = existingRows[0];
    if (!existingConnection) throw new Error("mock GitLab connection could not be created");
    return existingConnection;
  }

  private async assertOwnerTeam(organizationId: string, ownerTeamId: string | null): Promise<void> {
    if (!ownerTeamId) return;
    const rows = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, ownerTeamId), eq(teams.organizationId, organizationId)))
      .limit(1);
    if (!rows[0]) throw ApiError.validation("Owner team does not belong to this organization");
  }

  private ensureActive(access: ProjectAccess): void {
    if (access.project.status === "archived") {
      throw ApiError.conflict("Project is archived; restore it before making changes");
    }
  }

  private async lockMemberships(
    executor: DbExecutor,
    projectId: string,
  ): Promise<Array<{ userId: string; role: ProjectRole }>> {
    return executor
      .select({ userId: projectMemberships.userId, role: projectMemberships.role })
      .from(projectMemberships)
      .where(eq(projectMemberships.projectId, projectId))
      .for("update");
  }

  private async findMembership(
    executor: DbExecutor,
    projectId: string,
    userId: string,
  ): Promise<{ role: ProjectRole } | undefined> {
    const rows = await executor
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(
        and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)),
      )
      .limit(1);
    return rows[0];
  }

  private async ensureNotLastAdmin(executor: DbExecutor, projectId: string): Promise<void> {
    const rows = await executor
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(eq(projectMemberships.projectId, projectId));
    const admins = rows.filter((row) => row.role === "project_admin").length;
    if (admins <= 1) {
      throw ApiError.conflict("Cannot remove or demote the last project administrator");
    }
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSummary(
  project: typeof projects.$inferSelect,
  role: ProjectRole,
  ownerTeamName: string | null,
  memberCount: number,
  repositoryLinked: boolean,
): ProjectSummary {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    status: project.status,
    role,
    ownerTeamId: project.ownerTeamId,
    ownerTeamName,
    memberCount,
    repositoryLinked,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    archivedAt: project.archivedAt?.toISOString() ?? null,
  };
}

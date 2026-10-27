import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Infrastructure-only table that proves the migration pipeline works before
 * the Phase 4 domain migrations land. It stores the baseline marker and is not
 * a product-domain entity.
 */
export const platformSchemaState = pgTable(
  "platform_schema_state",
  {
    id: boolean("id").primaryKey().default(true),
    baselineVersion: text("baseline_version").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("platform_schema_state_singleton", sql`${table.id}`)],
);

export const userStatusEnum = pgEnum("user_status", ["active", "disabled", "pending"]);
export const organizationRoleEnum = pgEnum("organization_role", [
  "org_admin",
  "member",
  "read_only",
]);
export const teamRoleEnum = pgEnum("team_role", ["team_admin", "member", "viewer"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const projectRoleEnum = pgEnum("project_role", [
  "project_admin",
  "editor",
  "executor",
  "viewer",
]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "device", "system"]);
export const auditOutcomeEnum = pgEnum("audit_outcome", ["success", "failure"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    identityProviderKey: text("identity_provider_key"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("organizations_created_at_idx").on(table.createdAt)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalSubject: text("external_subject").notNull().unique(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    passwordHash: text("password_hash"),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_status_idx").on(table.status)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_memberships_user_idx").on(table.userId),
    index("organization_memberships_org_role_idx").on(table.organizationId, table.role),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("teams_org_slug_unique").on(table.organizationId, table.slug),
    index("teams_org_idx").on(table.organizationId),
  ],
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_memberships_user_idx").on(table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerTeamId: uuid("owner_team_id").references(() => teams.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("projects_org_slug_unique").on(table.organizationId, table.slug),
    index("projects_org_status_idx").on(table.organizationId, table.status),
    index("projects_owner_team_idx").on(table.ownerTeamId),
  ],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_memberships_user_idx").on(table.userId),
    index("project_memberships_project_role_idx").on(table.projectId, table.role),
  ],
);

export const gitlabConnections = pgTable(
  "gitlab_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    gitlabInstanceUrl: text("gitlab_instance_url").notNull(),
    authMode: text("auth_mode").notNull(),
    credentialSecretRef: text("credential_secret_ref").notNull(),
    status: text("status").notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gitlab_connections_org_idx").on(table.organizationId),
    uniqueIndex("gitlab_connections_mock_org_unique")
      .on(table.organizationId)
      .where(sql`${table.authMode} = 'mock'`),
  ],
);

export const gitlabRepositories = pgTable(
  "gitlab_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    gitlabConnectionId: uuid("gitlab_connection_id")
      .notNull()
      .references(() => gitlabConnections.id, { onDelete: "cascade" }),
    externalProjectId: text("external_project_id").notNull(),
    namespacePath: text("namespace_path").notNull(),
    repositoryName: text("repository_name").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    defaultBranch: text("default_branch"),
    openapiFilePath: text("openapi_file_path"),
    webhookStatus: text("webhook_status").notNull(),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gitlab_repositories_project_unique").on(table.projectId),
    uniqueIndex("gitlab_repositories_connection_external_unique").on(
      table.gitlabConnectionId,
      table.externalProjectId,
    ),
    index("gitlab_repositories_connection_idx").on(table.gitlabConnectionId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    csrfHash: text("csrf_hash").notNull(),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorDeviceId: uuid("actor_device_id"),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    outcome: auditOutcomeEnum("outcome").notNull(),
    correlationId: text("correlation_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("audit_events_project_created_idx").on(table.projectId, table.createdAt),
    index("audit_events_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export const schema = {
  platformSchemaState,
  organizations,
  users,
  organizationMemberships,
  teams,
  teamMemberships,
  projects,
  projectMemberships,
  gitlabConnections,
  gitlabRepositories,
  sessions,
  auditEvents,
};

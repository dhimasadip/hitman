import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
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
export const requestLifecycleEnum = pgEnum("request_lifecycle", ["draft", "ready", "archived"]);
export const executionScopeEnum = pgEnum("execution_scope", [
  "development_only",
  "environment_policy",
]);
export const bodyKindEnum = pgEnum("body_kind", [
  "none",
  "json",
  "text",
  "urlencoded",
  "multipart",
  "binary",
]);
export const apiSpecSourceKindEnum = pgEnum("api_spec_source_kind", [
  "upload",
  "repository",
  "url",
]);
export const apiSpecValidationStatusEnum = pgEnum("api_spec_validation_status", [
  "valid",
  "invalid",
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

export const apiSpecifications = pgTable(
  "api_specifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => apiSpecificationVersions.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_specifications_project_idx").on(table.projectId)],
);

export const apiSpecificationVersions = pgTable(
  "api_specification_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiSpecificationId: uuid("api_specification_id")
      .notNull()
      .references(() => apiSpecifications.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    sourceKind: apiSpecSourceKindEnum("source_kind").notNull(),
    sourceRef: text("source_ref"),
    sourceCommitSha: text("source_commit_sha"),
    specVersion: text("spec_version"),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    rawDocumentText: text("raw_document_text").notNull(),
    contentHash: text("content_hash").notNull(),
    validationStatus: apiSpecValidationStatusEnum("validation_status").notNull(),
    validationReport: jsonb("validation_report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_specification_versions_number_unique").on(
      table.apiSpecificationId,
      table.versionNumber,
    ),
    uniqueIndex("api_specification_versions_content_unique").on(
      table.apiSpecificationId,
      table.contentHash,
    ),
    index("api_specification_versions_spec_idx").on(table.apiSpecificationId, table.createdAt),
  ],
);

export const apiOperations = pgTable(
  "api_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    apiSpecificationId: uuid("api_specification_id")
      .notNull()
      .references(() => apiSpecifications.id, { onDelete: "cascade" }),
    apiSpecificationVersionId: uuid("api_specification_version_id")
      .notNull()
      .references(() => apiSpecificationVersions.id, { onDelete: "cascade" }),
    operationKey: text("operation_key").notNull(),
    method: text("method").notNull(),
    pathTemplate: text("path_template").notNull(),
    summary: text("summary"),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    operationDocument: jsonb("operation_document").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_operations_version_key_unique").on(
      table.apiSpecificationVersionId,
      table.operationKey,
    ),
    index("api_operations_project_method_path_idx").on(
      table.projectId,
      table.method,
      table.pathTemplate,
    ),
    index("api_operations_spec_version_idx").on(table.apiSpecificationVersionId),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("collections_project_sort_idx").on(table.projectId, table.sortOrder)],
);

export const collectionFolders = pgTable(
  "collection_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    parentFolderId: uuid("parent_folder_id").references((): AnyPgColumn => collectionFolders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("collection_folders_collection_parent_idx").on(table.collectionId, table.parentFolderId),
  ],
);

export const apiRequests = pgTable(
  "api_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").references(() => collections.id, {
      onDelete: "set null",
    }),
    folderId: uuid("folder_id").references(() => collectionFolders.id, {
      onDelete: "set null",
    }),
    apiOperationId: uuid("api_operation_id").references(() => apiOperations.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    requestLifecycle: requestLifecycleEnum("request_lifecycle").notNull().default("draft"),
    executionScope: executionScopeEnum("execution_scope").notNull().default("environment_policy"),
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => apiRequestVersions.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("api_requests_project_lifecycle_idx").on(table.projectId, table.requestLifecycle),
    index("api_requests_project_collection_idx").on(table.projectId, table.collectionId),
    index("api_requests_operation_idx").on(table.apiOperationId),
  ],
);

export const apiRequestVersions = pgTable(
  "api_request_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiRequestId: uuid("api_request_id")
      .notNull()
      .references(() => apiRequests.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    queryParams: jsonb("query_params").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    headers: jsonb("headers").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    authConfig: jsonb("auth_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    bodyKind: bodyKindEnum("body_kind").notNull(),
    bodyJson: jsonb("body_json"),
    bodyText: text("body_text"),
    bodyObjectKey: text("body_object_key"),
    bodyContentType: text("body_content_type"),
    bodyEncoding: text("body_encoding"),
    requestOptions: jsonb("request_options")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    responseAssertions: jsonb("response_assertions")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    changeSummary: text("change_summary"),
    sourceObservationAtCreation: text("source_observation_at_creation")
      .notNull()
      .default("unknown"),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_request_versions_number_unique").on(table.apiRequestId, table.versionNumber),
    index("api_request_versions_request_idx").on(table.apiRequestId, table.createdAt),
  ],
);

export const apiRequestSourceObservations = pgTable(
  "api_request_source_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiRequestId: uuid("api_request_id")
      .notNull()
      .references(() => apiRequests.id, { onDelete: "cascade" }),
    apiRequestVersionId: uuid("api_request_version_id").references(() => apiRequestVersions.id, {
      onDelete: "set null",
    }),
    sourceKind: text("source_kind").notNull(),
    observedState: text("observed_state").notNull(),
    verificationStatus: text("verification_status").notNull(),
    repositoryId: uuid("repository_id").references(() => gitlabRepositories.id, {
      onDelete: "set null",
    }),
    repositoryPath: text("repository_path"),
    branchName: text("branch_name"),
    commitSha: text("commit_sha"),
    mergeRequestIid: text("merge_request_iid"),
    sourceStartLine: integer("source_start_line"),
    sourceEndLine: integer("source_end_line"),
    matchMethod: text("match_method").notNull(),
    confidence: numeric("confidence"),
    observedByUserId: uuid("observed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    observedByDeviceId: uuid("observed_by_device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_request_source_observations_request_idx").on(table.apiRequestId, table.createdAt),
    index("api_request_source_observations_repo_commit_idx").on(
      table.repositoryId,
      table.commitSha,
    ),
  ],
);

export const apiRequestSourceLinks = pgTable(
  "api_request_source_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiRequestId: uuid("api_request_id")
      .notNull()
      .references(() => apiRequests.id, { onDelete: "cascade" }),
    apiRequestVersionId: uuid("api_request_version_id").references(() => apiRequestVersions.id, {
      onDelete: "set null",
    }),
    gitlabRepositoryId: uuid("gitlab_repository_id")
      .notNull()
      .references(() => gitlabRepositories.id, { onDelete: "cascade" }),
    branchName: text("branch_name"),
    commitSha: text("commit_sha"),
    mergeRequestIid: text("merge_request_iid"),
    sourceFilePath: text("source_file_path"),
    sourceStartLine: integer("source_start_line"),
    sourceEndLine: integer("source_end_line"),
    sourceStatus: text("source_status").notNull(),
    matchMethod: text("match_method").notNull(),
    confidence: numeric("confidence"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_request_source_links_request_idx").on(table.apiRequestId),
    index("api_request_source_links_repo_commit_idx").on(table.gitlabRepositoryId, table.commitSha),
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
  apiSpecifications,
  apiSpecificationVersions,
  apiOperations,
  collections,
  collectionFolders,
  apiRequests,
  apiRequestVersions,
  apiRequestSourceObservations,
  apiRequestSourceLinks,
  sessions,
  auditEvents,
};

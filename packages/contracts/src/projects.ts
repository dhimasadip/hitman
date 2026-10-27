import { z } from "zod";
import { publicUserSchema, slugSchema } from "./identity.js";

export const projectRoleSchema = z.enum(["project_admin", "editor", "executor", "viewer"]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const projectStatusSchema = z.enum(["active", "archived"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectStatusFilterSchema = z.enum(["active", "archived", "all"]);
export type ProjectStatusFilter = z.infer<typeof projectStatusFilterSchema>;

export const openapiFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^(?!\/)(?!.*\.\.)(?!.*\\\\)[A-Za-z0-9._/-]+$/, {
    message: "Use a repository-relative path without '..' or backslashes",
  });

export const projectSummarySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  role: projectRoleSchema,
  ownerTeamId: z.uuid().nullable(),
  ownerTeamName: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  repositoryLinked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  settings: z.record(z.string(), z.unknown()),
  createdBy: z.uuid(),
  createdByName: z.string().nullable(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectMemberSchema = z.object({
  user: publicUserSchema,
  role: projectRoleSchema,
  createdAt: z.string(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const gitlabConnectionSummarySchema = z.object({
  id: z.uuid(),
  instanceUrl: z.string(),
  authMode: z.string(),
  status: z.string(),
  lastVerifiedAt: z.string().nullable(),
});
export type GitlabConnectionSummary = z.infer<typeof gitlabConnectionSummarySchema>;

export const projectRepositorySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  externalProjectId: z.string(),
  namespacePath: z.string(),
  repositoryName: z.string(),
  repositoryUrl: z.string(),
  defaultBranch: z.string().nullable(),
  openapiFilePath: z.string().nullable(),
  webhookStatus: z.string(),
  lastReconciledAt: z.string().nullable(),
  mock: z.boolean(),
  connection: gitlabConnectionSummarySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectRepository = z.infer<typeof projectRepositorySchema>;

export const mockRepositorySchema = z.object({
  externalProjectId: z.string(),
  namespacePath: z.string(),
  repositoryName: z.string(),
  repositoryUrl: z.string(),
  defaultBranch: z.string().nullable(),
  openapiFilePath: z.string().nullable(),
});
export type MockRepository = z.infer<typeof mockRepositorySchema>;

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(2_000).optional(),
  ownerTeamId: z.uuid().nullable().optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  ownerTeamId: z.uuid().nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const addProjectMemberRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: projectRoleSchema.default("viewer"),
});
export type AddProjectMemberRequest = z.infer<typeof addProjectMemberRequestSchema>;

export const updateProjectMemberRequestSchema = z.object({
  role: projectRoleSchema,
});
export type UpdateProjectMemberRequest = z.infer<typeof updateProjectMemberRequestSchema>;

export const linkRepositoryRequestSchema = z.object({
  externalProjectId: z.string().trim().min(1).max(100),
  openapiFilePath: openapiFilePathSchema.optional(),
});
export type LinkRepositoryRequest = z.infer<typeof linkRepositoryRequestSchema>;

export const updateRepositoryRequestSchema = z.object({
  openapiFilePath: openapiFilePathSchema.nullable(),
});
export type UpdateRepositoryRequest = z.infer<typeof updateRepositoryRequestSchema>;

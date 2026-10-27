import { z } from "zod";

export const organizationRoleSchema = z.enum(["org_admin", "member", "read_only"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const teamRoleSchema = z.enum(["team_admin", "member", "viewer"]);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const userStatusSchema = z.enum(["active", "disabled", "pending"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const auditActorTypeSchema = z.enum(["user", "device", "system"]);
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;

export const auditOutcomeSchema = z.enum(["success", "failure"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: "Use lowercase letters, numbers, and hyphens; start/end with a letter or number",
  });
export const displayNameSchema = z.string().trim().min(1).max(100);
export const passwordSchema = z.string().min(12).max(128);

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  status: userStatusSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: organizationRoleSchema,
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const sessionResponseSchema = z.object({
  user: publicUserSchema,
  organizations: z.array(organizationSummarySchema),
  activeOrganizationId: z.uuid().nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const organizationDetailSchema = organizationSummarySchema.extend({
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

export const organizationMemberSchema = z.object({
  user: publicUserSchema,
  role: organizationRoleSchema,
  createdAt: z.string(),
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const teamSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamMemberSchema = z.object({
  user: publicUserSchema,
  role: teamRoleSchema,
  createdAt: z.string(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamDetailSchema = teamSummarySchema.extend({
  members: z.array(teamMemberSchema),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;

export const auditEventSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.uuid().nullable(),
  actorType: auditActorTypeSchema,
  actorUserId: z.uuid().nullable(),
  actorDisplayName: z.string().nullable(),
  outcome: auditOutcomeSchema,
  correlationId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  organizationId: z.uuid().optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const switchOrganizationRequestSchema = z.object({
  organizationId: z.uuid(),
});
export type SwitchOrganizationRequest = z.infer<typeof switchOrganizationRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export const addOrganizationMemberRequestSchema = z.object({
  email: emailSchema,
  role: organizationRoleSchema.default("member"),
});
export type AddOrganizationMemberRequest = z.infer<typeof addOrganizationMemberRequestSchema>;

export const updateOrganizationMemberRequestSchema = z.object({
  role: organizationRoleSchema,
});
export type UpdateOrganizationMemberRequest = z.infer<typeof updateOrganizationMemberRequestSchema>;

export const createTeamRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema,
});
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

export const updateTeamRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type UpdateTeamRequest = z.infer<typeof updateTeamRequestSchema>;

export const addTeamMemberRequestSchema = z.object({
  email: emailSchema,
  role: teamRoleSchema.default("member"),
});
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberRequestSchema>;

export const updateTeamMemberRequestSchema = z.object({
  role: teamRoleSchema,
});
export type UpdateTeamMemberRequest = z.infer<typeof updateTeamMemberRequestSchema>;

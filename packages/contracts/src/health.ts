import { z } from "zod";

export const serviceRoleSchema = z.enum(["server", "worker"]);
export type ServiceRole = z.infer<typeof serviceRoleSchema>;

export const checkStatusSchema = z.enum(["ok", "degraded", "error"]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const healthCheckSchema = z.object({
  name: z.string(),
  status: checkStatusSchema,
  latencyMs: z.number().nonnegative().optional(),
  message: z.string().optional(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const healthResponseSchema = z.object({
  status: checkStatusSchema,
  service: z.string(),
  role: serviceRoleSchema,
  version: z.string(),
  commit: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.array(healthCheckSchema),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const buildInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  commit: z.string(),
  builtAt: z.iso.datetime().nullable(),
  nodeVersion: z.string(),
});
export type BuildInfo = z.infer<typeof buildInfoSchema>;

export const requestIdHeader = "x-request-id" as const;
export const requestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

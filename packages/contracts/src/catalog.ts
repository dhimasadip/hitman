import { z } from "zod";
import { openapiFilePathSchema } from "./projects.js";

export const requestLifecycleSchema = z.enum(["draft", "ready", "archived"]);
export type RequestLifecycle = z.infer<typeof requestLifecycleSchema>;

export const editableRequestLifecycleSchema = z.enum(["draft", "ready"]);
export type EditableRequestLifecycle = z.infer<typeof editableRequestLifecycleSchema>;

export const executionScopeSchema = z.enum(["development_only", "environment_policy"]);
export type ExecutionScope = z.infer<typeof executionScopeSchema>;

export const bodyKindSchema = z.enum(["none", "json", "text", "urlencoded", "multipart", "binary"]);
export type BodyKind = z.infer<typeof bodyKindSchema>;

export const apiSpecValidationStatusSchema = z.enum(["valid", "invalid"]);
export type ApiSpecValidationStatus = z.infer<typeof apiSpecValidationStatusSchema>;

export const apiSpecSourceKindSchema = z.enum(["upload", "repository", "url"]);
export type ApiSpecSourceKind = z.infer<typeof apiSpecSourceKindSchema>;

export const httpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

export const secretRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^(env|secret|vault):\/\/[A-Za-z0-9_./:-]+$/, {
    message: "Secret values must be references, not plaintext",
  });

export const keyValueEntrySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(16_384),
  enabled: z.boolean().default(true),
  description: z.string().max(500).optional(),
});
export type KeyValueEntry = z.infer<typeof keyValueEntrySchema>;

export const authConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), tokenSecretRef: secretRefSchema }),
  z.object({
    type: z.literal("basic"),
    usernameSecretRef: secretRefSchema,
    passwordSecretRef: secretRefSchema,
  }),
  z.object({
    type: z.literal("api_key"),
    in: z.enum(["header", "query"]),
    name: z.string().trim().min(1).max(100),
    secretRef: secretRefSchema,
  }),
]);
export type AuthConfig = z.infer<typeof authConfigSchema>;

export const multipartPartSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().max(16_384).optional(),
  fileName: z.string().max(255).optional(),
  contentType: z.string().max(200).optional(),
  enabled: z.boolean().default(true),
});
export type MultipartPart = z.infer<typeof multipartPartSchema>;

export const requestBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("json"),
    value: z.any().refine((value) => value !== undefined, "JSON body value is required"),
    contentType: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().max(5_000_000),
    contentType: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal("urlencoded"), entries: z.array(keyValueEntrySchema).max(500) }),
  z.object({ kind: z.literal("multipart"), parts: z.array(multipartPartSchema).max(200) }),
]);
export type RequestBody = z.infer<typeof requestBodySchema>;

export const requestOptionsSchema = z.object({
  timeoutMs: z.number().int().min(1).max(30_000).default(30_000),
  followRedirects: z.boolean().default(false),
  maxResponseBytes: z.number().int().min(1).max(1_048_576).default(1_048_576),
});
export type RequestOptions = z.infer<typeof requestOptionsSchema>;

export const requestPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.includes("://") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !/\s/.test(value),
    {
      message:
        "Path must be relative to the environment base URL, start with '/', and exclude query/fragment",
    },
  );

export const requestDefinitionSchema = z.object({
  method: httpMethodSchema,
  path: requestPathSchema,
  queryParams: z.array(keyValueEntrySchema).max(500).default([]),
  headers: z.array(keyValueEntrySchema).max(500).default([]),
  authConfig: authConfigSchema.default({ type: "none" }),
  body: requestBodySchema.default({ kind: "none" }),
  requestOptions: requestOptionsSchema.default({
    timeoutMs: 30_000,
    followRedirects: false,
    maxResponseBytes: 1_048_576,
  }),
});
export type RequestDefinition = z.infer<typeof requestDefinitionSchema>;

export const apiSpecificationSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  label: z.string(),
  description: z.string().nullable(),
  currentVersionId: z.uuid().nullable(),
  versionCount: z.number().int().nonnegative(),
  currentVersionNumber: z.number().int().positive().nullable(),
  openapiVersion: z.string().nullable(),
  validationStatus: apiSpecValidationStatusSchema.nullable(),
  sourceKind: apiSpecSourceKindSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApiSpecificationSummary = z.infer<typeof apiSpecificationSummarySchema>;

export const apiSpecificationVersionSummarySchema = z.object({
  id: z.uuid(),
  specificationId: z.uuid(),
  versionNumber: z.number().int().positive(),
  sourceKind: apiSpecSourceKindSchema,
  sourceRef: z.string().nullable(),
  sourceCommitSha: z.string().nullable(),
  specVersion: z.string().nullable(),
  validationStatus: apiSpecValidationStatusSchema,
  contentHash: z.string(),
  validationReport: z.record(z.string(), z.unknown()),
  operationCount: z.number().int().nonnegative(),
  createdBy: z.uuid(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiSpecificationVersionSummary = z.infer<typeof apiSpecificationVersionSummarySchema>;

export const apiSpecificationDetailSchema = apiSpecificationSummarySchema.extend({
  versions: z.array(apiSpecificationVersionSummarySchema),
});
export type ApiSpecificationDetail = z.infer<typeof apiSpecificationDetailSchema>;

export const importSpecificationRequestSchema = z
  .object({
    specificationId: z.uuid().optional(),
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).optional(),
    sourceKind: z.enum(["upload", "repository"]),
    content: z.string().max(5_000_000).optional(),
    fileName: z.string().trim().max(255).optional(),
    repositoryPath: openapiFilePathSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceKind === "upload" && !value.content) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "OpenAPI content is required for upload imports",
      });
    }
    if (value.sourceKind === "repository" && value.content) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "Repository imports read content from the linked repository",
      });
    }
  });
export type ImportSpecificationRequest = z.infer<typeof importSpecificationRequestSchema>;

export const importSpecificationResponseSchema = z.object({
  specification: apiSpecificationSummarySchema,
  version: apiSpecificationVersionSummarySchema,
  operationCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  deduplicated: z.boolean(),
});
export type ImportSpecificationResponse = z.infer<typeof importSpecificationResponseSchema>;

export const apiOperationSummarySchema = z.object({
  id: z.uuid(),
  specificationId: z.uuid(),
  versionId: z.uuid(),
  versionNumber: z.number().int().positive(),
  operationKey: z.string(),
  method: z.string(),
  pathTemplate: z.string(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
});
export type ApiOperationSummary = z.infer<typeof apiOperationSummarySchema>;

export const collectionSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  requestCount: z.number().int().nonnegative(),
  folderCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export const collectionFolderSummarySchema = z.object({
  id: z.uuid(),
  collectionId: z.uuid(),
  parentFolderId: z.uuid().nullable(),
  name: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CollectionFolderSummary = z.infer<typeof collectionFolderSummarySchema>;

export const collectionDetailSchema = collectionSummarySchema.extend({
  folders: z.array(collectionFolderSummarySchema),
});
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;

export const createCollectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
});
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;

export const updateCollectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequestSchema>;

export const createCollectionFolderRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentFolderId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
});
export type CreateCollectionFolderRequest = z.infer<typeof createCollectionFolderRequestSchema>;

export const updateCollectionFolderRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentFolderId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
export type UpdateCollectionFolderRequest = z.infer<typeof updateCollectionFolderRequestSchema>;

export const createRequestRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  collectionId: z.uuid().nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  apiOperationId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  executionScope: executionScopeSchema.default("environment_policy"),
  request: requestDefinitionSchema,
  changeSummary: z.string().trim().max(500).optional(),
});
export type CreateRequestRequest = z.infer<typeof createRequestRequestSchema>;

export const updateRequestRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  collectionId: z.uuid().nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  apiOperationId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  requestLifecycle: editableRequestLifecycleSchema.optional(),
  executionScope: executionScopeSchema.optional(),
  expectedVersionNumber: z.number().int().positive().optional(),
  request: requestDefinitionSchema.optional(),
  changeSummary: z.string().trim().max(500).optional(),
});
export type UpdateRequestRequest = z.infer<typeof updateRequestRequestSchema>;

export const apiRequestVersionSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  versionNumber: z.number().int().positive(),
  ...requestDefinitionSchema.shape,
  responseAssertions: z.array(z.unknown()),
  changeSummary: z.string().nullable(),
  sourceObservationAtCreation: z.string(),
  sourceMetadata: z.record(z.string(), z.unknown()),
  createdBy: z.uuid(),
  createdAt: z.string(),
});
export type ApiRequestVersion = z.infer<typeof apiRequestVersionSchema>;

export const apiRequestVersionSummarySchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  versionNumber: z.number().int().positive(),
  method: z.string(),
  path: z.string(),
  changeSummary: z.string().nullable(),
  createdBy: z.uuid(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiRequestVersionSummary = z.infer<typeof apiRequestVersionSummarySchema>;

export const apiRequestSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  collectionId: z.uuid().nullable(),
  folderId: z.uuid().nullable(),
  apiOperationId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  requestLifecycle: requestLifecycleSchema,
  executionScope: executionScopeSchema,
  currentVersionId: z.uuid().nullable(),
  currentVersionNumber: z.number().int().positive().nullable(),
  method: z.string(),
  path: z.string(),
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type ApiRequestSummary = z.infer<typeof apiRequestSummarySchema>;

export const apiRequestDetailSchema = apiRequestSummarySchema.extend({
  version: apiRequestVersionSchema,
});
export type ApiRequestDetail = z.infer<typeof apiRequestDetailSchema>;

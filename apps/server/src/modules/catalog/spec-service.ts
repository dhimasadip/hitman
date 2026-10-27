import { createHash } from "node:crypto";
import {
  ApiError,
  type ApiOperationSummary,
  type ApiSpecificationDetail,
  type ApiSpecificationSummary,
  type ApiSpecificationVersionSummary,
  type ImportSpecificationRequest,
  type ImportSpecificationResponse,
} from "@hitman/contracts";
import {
  apiOperations,
  apiSpecifications,
  apiSpecificationVersions,
  gitlabRepositories,
  users,
} from "@hitman/database/schema";
import { type Config, createConfig, lintFromString } from "@redocly/openapi-core";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { parse as parseYaml } from "yaml";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthorizationService } from "../authorization/authorization-service.js";
import type { GitLabProvider } from "../gitlab/gitlab-provider.js";
import type { Db, DbExecutor } from "../shared/db.js";
import { isUniqueViolation } from "../shared/db.js";

const MAX_SPEC_BYTES = 5_000_000;
const MAX_OPERATIONS = 5_000;

interface ParsedSpec {
  document: Record<string, unknown>;
  raw: string;
  specVersion: string | null;
  errors: string[];
  warnings: string[];
  externalRefs: string[];
  operations: ParsedOperation[];
  contentHash: string;
  valid: boolean;
  unsupportedVersion: boolean;
}

interface ParsedOperation {
  operationKey: string;
  method: string;
  pathTemplate: string;
  summary: string | null;
  tags: string[];
  operationDocument: Record<string, unknown>;
  contentHash: string;
}

let redoclyConfigPromise: Promise<Config> | undefined;

function redoclyConfig(): Promise<Config> {
  redoclyConfigPromise ??= createConfig({ rules: { struct: "error" } });
  return redoclyConfigPromise;
}

function collectExternalRefs(value: unknown, path = "$", found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectExternalRefs(item, `${path}[${index}]`, found);
    });
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key === "$ref" && typeof child === "string" && !child.startsWith("#/")) {
      found.push(`${childPath}: ${child}`);
    } else {
      collectExternalRefs(child, childPath, found);
    }
  }
  return found;
}

function hashDocument(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function extractOperations(document: Record<string, unknown>): ParsedOperation[] {
  const paths = document.paths;
  if (!paths || typeof paths !== "object") return [];
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  const operations: ParsedOperation[] = [];
  const keys = new Set<string>();

  for (const [pathTemplate, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, value] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!methods.has(method.toLowerCase()) || !value || typeof value !== "object") continue;
      const operation = value as Record<string, unknown>;
      const operationId = text(operation.operationId);
      const operationKey = operationId ?? `${method.toUpperCase()} ${pathTemplate}`;
      if (keys.has(operationKey)) continue;
      keys.add(operationKey);
      const tags = Array.isArray(operation.tags)
        ? operation.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      operations.push({
        operationKey,
        method: method.toUpperCase(),
        pathTemplate,
        summary: text(operation.summary),
        tags,
        operationDocument: operation,
        contentHash: hashDocument(operation),
      });
    }
  }
  return operations;
}

async function parseSpecification(raw: string): Promise<ParsedSpec> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let document: Record<string, unknown> = {};
  let parsed = false;

  try {
    const value = parseYaml(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("OpenAPI document must be a mapping/object");
    } else {
      document = value as Record<string, unknown>;
      parsed = true;
    }
  } catch (error) {
    errors.push(`YAML/JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
  }

  const specVersion = text(document.openapi);
  const unsupportedVersion = Boolean(specVersion && !/^3\.(0|1)\./.test(specVersion));
  if (specVersion && !/^3\.(0|1)\./.test(specVersion)) {
    errors.push(`OpenAPI version ${specVersion} is not supported; use 3.0.x or 3.1.x`);
  } else if (!specVersion) {
    errors.push("Missing `openapi` version field");
  }

  const externalRefs = collectExternalRefs(document);
  for (const reference of externalRefs) {
    errors.push(`External $ref is not allowed: ${reference}`);
  }

  if (parsed && externalRefs.length === 0 && !unsupportedVersion) {
    try {
      const config = await redoclyConfig();
      const problems = await lintFromString({
        source: raw,
        absoluteRef: "openapi.yaml",
        config,
      });
      for (const problem of problems) {
        const message = `${problem.ruleId}: ${problem.message}`;
        if (problem.severity === "error") errors.push(message);
        else if (problem.severity === "warn") warnings.push(message);
      }
    } catch (error) {
      errors.push(
        `OpenAPI validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const operations = parsed && errors.length === 0 ? extractOperations(document) : [];
  if (operations.length > MAX_OPERATIONS) {
    errors.push(`Document contains more than ${MAX_OPERATIONS} operations`);
  }

  return {
    document,
    raw,
    specVersion,
    errors,
    warnings,
    externalRefs,
    operations: errors.length === 0 ? operations : [],
    contentHash: parsed ? hashDocument(document) : hashDocument(raw),
    valid: errors.length === 0,
    unsupportedVersion,
  };
}

export class SpecificationService {
  constructor(
    private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly gitlab: GitLabProvider,
  ) {}

  async listSpecifications(userId: string, projectId: string): Promise<ApiSpecificationSummary[]> {
    await this.authorization.requireProjectRead(userId, projectId);
    const specs = await this.db
      .select()
      .from(apiSpecifications)
      .where(eq(apiSpecifications.projectId, projectId))
      .orderBy(desc(apiSpecifications.updatedAt));
    return this.summariesForSpecs(specs);
  }

  async getSpecification(
    userId: string,
    projectId: string,
    specificationId: string,
  ): Promise<ApiSpecificationDetail> {
    await this.authorization.requireProjectRead(userId, projectId);
    const specRows = await this.db
      .select()
      .from(apiSpecifications)
      .where(
        and(eq(apiSpecifications.id, specificationId), eq(apiSpecifications.projectId, projectId)),
      )
      .limit(1);
    const spec = specRows[0];
    if (!spec) throw ApiError.notFound("Specification not found");

    const versions = await this.versionsForSpec(spec.id);
    const summary = (await this.summariesForSpecs([spec]))[0];
    if (!summary) throw new Error("specification summary missing");
    return { ...summary, versions };
  }

  async listOperations(
    userId: string,
    projectId: string,
    filters: { specificationId?: string; search?: string; method?: string } = {},
  ): Promise<ApiOperationSummary[]> {
    await this.authorization.requireProjectRead(userId, projectId);
    const conditions = [
      eq(apiOperations.projectId, projectId),
      eq(apiSpecifications.currentVersionId, apiOperations.apiSpecificationVersionId),
    ];
    if (filters.specificationId) {
      conditions.push(eq(apiOperations.apiSpecificationId, filters.specificationId));
    }
    if (filters.method) conditions.push(eq(apiOperations.method, filters.method.toUpperCase()));
    const search = filters.search?.trim();
    if (search) {
      const term = `%${search.replace(/[%_]/g, "\\$&")}%`;
      const searchCondition = or(
        ilike(apiOperations.pathTemplate, term),
        ilike(apiOperations.operationKey, term),
        ilike(apiOperations.summary, term),
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    const rows = await this.db
      .select({
        id: apiOperations.id,
        specificationId: apiOperations.apiSpecificationId,
        versionId: apiOperations.apiSpecificationVersionId,
        versionNumber: apiSpecificationVersions.versionNumber,
        operationKey: apiOperations.operationKey,
        method: apiOperations.method,
        pathTemplate: apiOperations.pathTemplate,
        summary: apiOperations.summary,
        tags: apiOperations.tags,
      })
      .from(apiOperations)
      .innerJoin(
        apiSpecificationVersions,
        eq(apiSpecificationVersions.id, apiOperations.apiSpecificationVersionId),
      )
      .innerJoin(apiSpecifications, eq(apiSpecifications.id, apiOperations.apiSpecificationId))
      .where(and(...conditions))
      .orderBy(apiOperations.pathTemplate, apiOperations.method)
      .limit(1_000);

    return rows;
  }

  async importSpecification(
    userId: string,
    projectId: string,
    input: ImportSpecificationRequest,
    correlationId: string | null,
  ): Promise<ImportSpecificationResponse> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    if (access.project.status === "archived") {
      throw ApiError.conflict("Project is archived; restore it before importing a specification");
    }

    let raw: string;
    let sourceRef: string | null = null;
    let sourceCommitSha: string | null = null;
    let sourceKind: "upload" | "repository";

    if (input.sourceKind === "upload") {
      raw = input.content ?? "";
      sourceRef = input.fileName ?? "upload";
      sourceKind = "upload";
    } else {
      const repoRows = await this.db
        .select()
        .from(gitlabRepositories)
        .where(eq(gitlabRepositories.projectId, projectId))
        .limit(1);
      const repository = repoRows[0];
      if (!repository) throw ApiError.conflict("Project has no linked repository");
      const path = input.repositoryPath ?? repository.openapiFilePath;
      if (!path) throw ApiError.validation("Project repository has no configured OpenAPI path");
      const content = await this.gitlab.getFile(repository.externalProjectId, path);
      if (content === undefined) {
        throw ApiError.notFound("OpenAPI file not found in the mock repository");
      }
      raw = content;
      sourceRef = path;
      sourceCommitSha = null;
      sourceKind = "repository";
    }

    if (Buffer.byteLength(raw, "utf8") > MAX_SPEC_BYTES) {
      throw ApiError.validation(`OpenAPI document exceeds the ${MAX_SPEC_BYTES} byte limit`);
    }

    const parsed = await parseSpecification(raw);
    if (parsed.unsupportedVersion) {
      throw ApiError.validation(
        "OpenAPI 3.2.x is not supported in this release; use 3.0.x or 3.1.x",
        { errors: parsed.errors },
      );
    }

    const existingSpec = input.specificationId
      ? (
          await this.db
            .select()
            .from(apiSpecifications)
            .where(
              and(
                eq(apiSpecifications.id, input.specificationId),
                eq(apiSpecifications.projectId, projectId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
    if (input.specificationId && !existingSpec) {
      throw ApiError.notFound("Specification not found");
    }

    try {
      const result = await this.db.transaction(async (tx) => {
        const spec = existingSpec
          ? (
              await tx
                .select()
                .from(apiSpecifications)
                .where(eq(apiSpecifications.id, existingSpec.id))
                .for("update")
            )[0]
          : await this.createSpecification(tx, {
              projectId,
              userId,
              label: input.label ?? infoTitle(parsed.document) ?? "Untitled API",
              description: input.description ?? null,
            });
        if (!spec) throw new Error("specification could not be created");

        if (input.label || input.description !== undefined) {
          await tx
            .update(apiSpecifications)
            .set({
              ...(input.label ? { label: input.label.trim() } : {}),
              ...(input.description !== undefined
                ? { description: input.description.trim() || null }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(apiSpecifications.id, spec.id));
        }

        const duplicate = await tx
          .select()
          .from(apiSpecificationVersions)
          .where(
            and(
              eq(apiSpecificationVersions.apiSpecificationId, spec.id),
              eq(apiSpecificationVersions.contentHash, parsed.contentHash),
            ),
          )
          .limit(1);
        if (duplicate[0]) {
          return {
            specificationId: spec.id,
            versionId: duplicate[0].id,
            versionNumber: duplicate[0].versionNumber,
            deduplicated: true,
            operationCount: await this.operationCount(tx, duplicate[0].id),
          };
        }

        const latest = await tx
          .select({ versionNumber: apiSpecificationVersions.versionNumber })
          .from(apiSpecificationVersions)
          .where(eq(apiSpecificationVersions.apiSpecificationId, spec.id))
          .orderBy(desc(apiSpecificationVersions.versionNumber))
          .limit(1);
        const versionNumber = (latest[0]?.versionNumber ?? 0) + 1;

        const versionRows = await tx
          .insert(apiSpecificationVersions)
          .values({
            apiSpecificationId: spec.id,
            versionNumber,
            sourceKind,
            sourceRef,
            sourceCommitSha,
            specVersion: parsed.specVersion,
            document: parsed.document,
            rawDocumentText: parsed.raw,
            contentHash: parsed.contentHash,
            validationStatus: parsed.valid ? "valid" : "invalid",
            validationReport: {
              errors: parsed.errors,
              warnings: parsed.warnings,
              externalRefs: parsed.externalRefs,
            },
            createdBy: userId,
          })
          .returning({ id: apiSpecificationVersions.id });
        const version = versionRows[0];
        if (!version) throw new Error("specification version insert returned no row");

        if (parsed.valid) {
          await tx.insert(apiOperations).values(
            parsed.operations.map((operation) => ({
              projectId,
              apiSpecificationId: spec.id,
              apiSpecificationVersionId: version.id,
              operationKey: operation.operationKey,
              method: operation.method,
              pathTemplate: operation.pathTemplate,
              summary: operation.summary,
              tags: operation.tags,
              operationDocument: operation.operationDocument,
              contentHash: operation.contentHash,
            })),
          );
          await tx
            .update(apiSpecifications)
            .set({ currentVersionId: version.id, updatedAt: new Date() })
            .where(eq(apiSpecifications.id, spec.id));
        } else {
          await tx
            .update(apiSpecifications)
            .set({ updatedAt: new Date() })
            .where(eq(apiSpecifications.id, spec.id));
        }

        await this.audit.record(tx, {
          organizationId: access.project.organizationId,
          actorUserId: userId,
          actorType: "user",
          action: parsed.valid ? "api_specification.imported" : "api_specification.import_failed",
          resourceType: "api_specification",
          resourceId: spec.id,
          projectId,
          outcome: parsed.valid ? "success" : "failure",
          correlationId,
          metadata: {
            versionNumber,
            sourceKind,
            sourceRef,
            specVersion: parsed.specVersion,
            operationCount: parsed.operations.length,
          },
        });

        return {
          specificationId: spec.id,
          versionId: version.id,
          versionNumber,
          deduplicated: false,
          operationCount: parsed.operations.length,
        };
      });

      const spec = (
        await this.db
          .select()
          .from(apiSpecifications)
          .where(eq(apiSpecifications.id, result.specificationId))
          .limit(1)
      )[0];
      if (!spec) throw new Error("specification disappeared after import");
      const summary = (await this.summariesForSpecs([spec]))[0];
      if (!summary) throw new Error("specification summary missing");
      const versions = await this.versionsForSpec(spec.id);
      const version = versions.find((candidate) => candidate.id === result.versionId);
      if (!version) throw new Error("specification version disappeared after import");

      return {
        specification: summary,
        version: { ...version, operationCount: result.operationCount },
        operationCount: result.operationCount,
        warnings: parsed.warnings,
        deduplicated: result.deduplicated,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict("Specification content already exists for this document");
      }
      throw error;
    }
  }

  private async summariesForSpecs(
    specs: Array<typeof apiSpecifications.$inferSelect>,
  ): Promise<ApiSpecificationSummary[]> {
    if (specs.length === 0) return [];
    const ids = specs.map((spec) => spec.id);
    const versions = await this.db
      .select()
      .from(apiSpecificationVersions)
      .where(inArray(apiSpecificationVersions.apiSpecificationId, ids));
    const counts = await this.db
      .select({
        specificationId: apiSpecificationVersions.apiSpecificationId,
        count: sql<number>`count(*)::int`,
      })
      .from(apiSpecificationVersions)
      .where(inArray(apiSpecificationVersions.apiSpecificationId, ids))
      .groupBy(apiSpecificationVersions.apiSpecificationId);
    const countMap = new Map(counts.map((entry) => [entry.specificationId, Number(entry.count)]));
    const versionMap = new Map(versions.map((version) => [version.id, version]));

    return specs.map((spec) => {
      const current = spec.currentVersionId ? versionMap.get(spec.currentVersionId) : undefined;
      return {
        id: spec.id,
        projectId: spec.projectId,
        label: spec.label,
        description: spec.description,
        currentVersionId: spec.currentVersionId,
        versionCount: countMap.get(spec.id) ?? 0,
        currentVersionNumber: current?.versionNumber ?? null,
        openapiVersion: current?.specVersion ?? null,
        validationStatus: current?.validationStatus ?? null,
        sourceKind: current?.sourceKind ?? null,
        createdAt: spec.createdAt.toISOString(),
        updatedAt: spec.updatedAt.toISOString(),
      };
    });
  }

  private async versionsForSpec(
    specificationId: string,
  ): Promise<ApiSpecificationVersionSummary[]> {
    const rows = await this.db
      .select({
        version: apiSpecificationVersions,
        createdByName: users.displayName,
        operationCount: sql<number>`(select count(*)::int from ${apiOperations} where ${apiOperations.apiSpecificationVersionId} = ${apiSpecificationVersions.id})`,
      })
      .from(apiSpecificationVersions)
      .leftJoin(users, eq(users.id, apiSpecificationVersions.createdBy))
      .where(eq(apiSpecificationVersions.apiSpecificationId, specificationId))
      .orderBy(desc(apiSpecificationVersions.versionNumber));

    return rows.map((row) => ({
      id: row.version.id,
      specificationId: row.version.apiSpecificationId,
      versionNumber: row.version.versionNumber,
      sourceKind: row.version.sourceKind,
      sourceRef: row.version.sourceRef,
      sourceCommitSha: row.version.sourceCommitSha,
      specVersion: row.version.specVersion,
      validationStatus: row.version.validationStatus,
      contentHash: row.version.contentHash,
      validationReport: row.version.validationReport,
      operationCount: Number(row.operationCount),
      createdBy: row.version.createdBy,
      createdByName: row.createdByName,
      createdAt: row.version.createdAt.toISOString(),
    }));
  }

  private async createSpecification(
    executor: DbExecutor,
    input: {
      projectId: string;
      userId: string;
      label: string;
      description: string | null;
    },
  ): Promise<typeof apiSpecifications.$inferSelect> {
    const rows = await executor
      .insert(apiSpecifications)
      .values({
        projectId: input.projectId,
        label: input.label,
        description: input.description,
        createdBy: input.userId,
      })
      .returning();
    const created = rows[0];
    if (!created) throw new Error("specification insert returned no row");
    return created;
  }

  private async operationCount(executor: DbExecutor, versionId: string): Promise<number> {
    const rows = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(apiOperations)
      .where(eq(apiOperations.apiSpecificationVersionId, versionId));
    return Number(rows[0]?.count ?? 0);
  }
}

function infoTitle(document: Record<string, unknown>): string | undefined {
  const info = document.info;
  if (!info || typeof info !== "object") return undefined;
  const title = (info as Record<string, unknown>).title;
  return typeof title === "string" ? title : undefined;
}

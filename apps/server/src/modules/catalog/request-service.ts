import {
  ApiError,
  type ApiRequestDetail,
  type ApiRequestSummary,
  type ApiRequestVersion,
  type ApiRequestVersionSummary,
  type AuthConfig,
  type CreateRequestRequest,
  type HttpMethod,
  type KeyValueEntry,
  type MultipartPart,
  type RequestBody,
  type RequestDefinition,
  type RequestLifecycle,
  type RequestOptions,
  type UpdateRequestRequest,
} from "@hitman/contracts";
import {
  apiOperations,
  apiRequests,
  apiRequestVersions,
  collectionFolders,
  collections,
  users,
} from "@hitman/database/schema";
import { and, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthorizationService } from "../authorization/authorization-service.js";
import type { Db } from "../shared/db.js";

export interface RequestListFilters {
  search?: string;
  method?: string;
  path?: string;
  lifecycle?: RequestLifecycle;
  collectionId?: string;
  folderId?: string;
  tag?: string;
  limit?: number;
}

interface RequestRow {
  request: typeof apiRequests.$inferSelect;
  version: typeof apiRequestVersions.$inferSelect | null;
}

export class RequestService {
  constructor(
    private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async createRequest(
    userId: string,
    projectId: string,
    input: CreateRequestRequest,
    correlationId: string | null,
  ): Promise<ApiRequestDetail> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    if (access.project.status === "archived") {
      throw ApiError.conflict("Project is archived; restore it before creating requests");
    }

    const placement = await this.resolvePlacement(projectId, input.collectionId, input.folderId);
    await this.validateOperation(projectId, input.apiOperationId ?? null);
    const definition = input.request;

    const request = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(apiRequests)
        .values({
          projectId,
          collectionId: placement.collectionId,
          folderId: placement.folderId,
          apiOperationId: input.apiOperationId ?? null,
          name: input.name.trim(),
          description: normalizeDescription(input.description),
          tags: normalizeTags(input.tags),
          requestLifecycle: "draft",
          executionScope: input.executionScope,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      const created = rows[0];
      if (!created) throw new Error("request insert returned no row");

      const versionRows = await tx
        .insert(apiRequestVersions)
        .values({
          apiRequestId: created.id,
          versionNumber: 1,
          ...versionValues(definition, userId, input.changeSummary ?? "Initial version"),
        })
        .returning({ id: apiRequestVersions.id });
      const version = versionRows[0];
      if (!version) throw new Error("request version insert returned no row");

      await tx
        .update(apiRequests)
        .set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(apiRequests.id, created.id));

      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "api_request.created",
        resourceType: "api_request",
        resourceId: created.id,
        projectId,
        outcome: "success",
        correlationId,
        metadata: {
          method: definition.method,
          path: definition.path,
          lifecycle: "draft",
          versionNumber: 1,
        },
      });
      return created;
    });

    return this.getRequest(userId, request.id);
  }

  async listRequests(
    userId: string,
    projectId: string,
    filters: RequestListFilters = {},
  ): Promise<ApiRequestSummary[]> {
    await this.authorization.requireProjectRead(userId, projectId);
    const conditions: SQL[] = [eq(apiRequests.projectId, projectId)];
    if (filters.lifecycle) conditions.push(eq(apiRequests.requestLifecycle, filters.lifecycle));
    if (filters.collectionId) conditions.push(eq(apiRequests.collectionId, filters.collectionId));
    if (filters.folderId) conditions.push(eq(apiRequests.folderId, filters.folderId));
    if (filters.method)
      conditions.push(eq(apiRequestVersions.method, filters.method.toUpperCase()));
    if (filters.path) {
      conditions.push(ilike(apiRequestVersions.path, `%${escapeLike(filters.path)}%`));
    }
    if (filters.tag) {
      conditions.push(sql`${apiRequests.tags} @> ARRAY[${filters.tag}]::text[]`);
    }
    const search = filters.search?.trim();
    if (search) {
      const term = `%${escapeLike(search)}%`;
      const condition = or(
        ilike(apiRequests.name, term),
        ilike(apiRequests.description, term),
        ilike(apiRequestVersions.path, term),
      );
      if (condition) conditions.push(condition);
    }

    const rows = await this.db
      .select({ request: apiRequests, version: apiRequestVersions })
      .from(apiRequests)
      .leftJoin(apiRequestVersions, eq(apiRequestVersions.id, apiRequests.currentVersionId))
      .where(and(...conditions))
      .orderBy(desc(apiRequests.updatedAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));

    return rows.map((row) => toSummary(row.request, row.version));
  }

  async getRequest(userId: string, requestId: string): Promise<ApiRequestDetail> {
    const row = await this.findRequestRow(requestId);
    await this.authorization.requireProjectRead(userId, row.request.projectId);
    if (!row.version) throw new Error("request has no current version");
    return {
      ...toSummary(row.request, row.version),
      version: toVersion(row.version),
    };
  }

  async listVersions(userId: string, requestId: string): Promise<ApiRequestVersionSummary[]> {
    const request = await this.findRequest(requestId);
    await this.authorization.requireProjectRead(userId, request.projectId);
    const rows = await this.db
      .select({ version: apiRequestVersions, createdByName: users.displayName })
      .from(apiRequestVersions)
      .leftJoin(users, eq(users.id, apiRequestVersions.createdBy))
      .where(eq(apiRequestVersions.apiRequestId, requestId))
      .orderBy(desc(apiRequestVersions.versionNumber));
    return rows.map((row) => ({
      id: row.version.id,
      requestId: row.version.apiRequestId,
      versionNumber: row.version.versionNumber,
      method: row.version.method,
      path: row.version.path,
      changeSummary: row.version.changeSummary,
      createdBy: row.version.createdBy,
      createdByName: row.createdByName,
      createdAt: row.version.createdAt.toISOString(),
    }));
  }

  async getVersion(
    userId: string,
    requestId: string,
    versionId: string,
  ): Promise<ApiRequestVersion> {
    const request = await this.findRequest(requestId);
    await this.authorization.requireProjectRead(userId, request.projectId);
    const rows = await this.db
      .select()
      .from(apiRequestVersions)
      .where(
        and(eq(apiRequestVersions.id, versionId), eq(apiRequestVersions.apiRequestId, requestId)),
      )
      .limit(1);
    const version = rows[0];
    if (!version) throw ApiError.notFound("Request version not found");
    return toVersion(version);
  }

  async updateRequest(
    userId: string,
    requestId: string,
    input: UpdateRequestRequest,
    correlationId: string | null,
  ): Promise<ApiRequestDetail> {
    const existing = await this.findRequest(requestId);
    const access = await this.authorization.requireProjectEdit(userId, existing.projectId);
    if (access.project.status === "archived") {
      throw ApiError.conflict("Project is archived; restore it before editing requests");
    }
    if (existing.requestLifecycle === "archived") {
      throw ApiError.conflict("Request is archived and cannot be edited");
    }

    const placement = await this.resolvePlacement(
      existing.projectId,
      input.collectionId === undefined ? existing.collectionId : input.collectionId,
      input.folderId === undefined ? existing.folderId : input.folderId,
      input.collectionId === null && input.folderId === undefined,
    );
    if (input.apiOperationId !== undefined) {
      await this.validateOperation(existing.projectId, input.apiOperationId);
    }

    const updated = await this.db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(apiRequests)
        .where(eq(apiRequests.id, requestId))
        .for("update");
      const currentRequest = currentRows[0];
      if (!currentRequest) throw ApiError.notFound("Request not found");
      if (input.expectedVersionNumber !== undefined && currentRequest.currentVersionId !== null) {
        const currentVersionRows = await tx
          .select({ versionNumber: apiRequestVersions.versionNumber })
          .from(apiRequestVersions)
          .where(eq(apiRequestVersions.id, currentRequest.currentVersionId))
          .limit(1);
        if (currentVersionRows[0]?.versionNumber !== input.expectedVersionNumber) {
          throw ApiError.conflict("Request has changed since it was loaded");
        }
      }

      let newVersionId: string | null = null;
      if (input.request) {
        const latest = await tx
          .select({ versionNumber: apiRequestVersions.versionNumber })
          .from(apiRequestVersions)
          .where(eq(apiRequestVersions.apiRequestId, requestId))
          .orderBy(desc(apiRequestVersions.versionNumber))
          .limit(1);
        const versionNumber = (latest[0]?.versionNumber ?? 0) + 1;
        const versionRows = await tx
          .insert(apiRequestVersions)
          .values({
            apiRequestId: requestId,
            versionNumber,
            ...versionValues(
              input.request,
              userId,
              input.changeSummary ?? `Version ${versionNumber}`,
            ),
          })
          .returning({ id: apiRequestVersions.id });
        newVersionId = versionRows[0]?.id ?? null;
        if (!newVersionId) throw new Error("request version insert returned no row");
      }

      await tx
        .update(apiRequests)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: normalizeDescription(input.description) }
            : {}),
          ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
          ...(input.collectionId !== undefined || input.folderId !== undefined
            ? { collectionId: placement.collectionId, folderId: placement.folderId }
            : {}),
          ...(input.apiOperationId !== undefined ? { apiOperationId: input.apiOperationId } : {}),
          ...(input.requestLifecycle !== undefined
            ? { requestLifecycle: input.requestLifecycle }
            : {}),
          ...(input.executionScope !== undefined ? { executionScope: input.executionScope } : {}),
          ...(newVersionId ? { currentVersionId: newVersionId } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(apiRequests.id, requestId));

      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "api_request.updated",
        resourceType: "api_request",
        resourceId: requestId,
        projectId: existing.projectId,
        outcome: "success",
        correlationId,
        metadata: {
          versionCreated: newVersionId !== null,
          lifecycle: input.requestLifecycle ?? currentRequest.requestLifecycle,
        },
      });
      return currentRequest;
    });

    return this.getRequest(userId, updated.id);
  }

  async archiveRequest(
    userId: string,
    requestId: string,
    correlationId: string | null,
  ): Promise<ApiRequestDetail> {
    const existing = await this.findRequest(requestId);
    const access = await this.authorization.requireProjectEdit(userId, existing.projectId);
    if (access.project.status === "archived") {
      throw ApiError.conflict("Project is archived; restore it before archiving requests");
    }
    if (existing.requestLifecycle !== "archived") {
      await this.db.transaction(async (tx) => {
        await tx
          .update(apiRequests)
          .set({
            requestLifecycle: "archived",
            archivedAt: new Date(),
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(apiRequests.id, requestId));
        await this.audit.record(tx, {
          organizationId: access.project.organizationId,
          actorUserId: userId,
          actorType: "user",
          action: "api_request.archived",
          resourceType: "api_request",
          resourceId: requestId,
          projectId: existing.projectId,
          outcome: "success",
          correlationId,
        });
      });
    }
    return this.getRequest(userId, requestId);
  }

  private async findRequest(requestId: string): Promise<typeof apiRequests.$inferSelect> {
    const rows = await this.db
      .select()
      .from(apiRequests)
      .where(eq(apiRequests.id, requestId))
      .limit(1);
    const request = rows[0];
    if (!request) throw ApiError.notFound("Request not found");
    return request;
  }

  private async findRequestRow(requestId: string): Promise<RequestRow> {
    const rows = await this.db
      .select({ request: apiRequests, version: apiRequestVersions })
      .from(apiRequests)
      .leftJoin(apiRequestVersions, eq(apiRequestVersions.id, apiRequests.currentVersionId))
      .where(eq(apiRequests.id, requestId))
      .limit(1);
    const row = rows[0];
    if (!row) throw ApiError.notFound("Request not found");
    return row;
  }

  private async resolvePlacement(
    projectId: string,
    collectionId: string | null | undefined,
    folderId: string | null | undefined,
    forceClear = false,
  ): Promise<{ collectionId: string | null; folderId: string | null }> {
    if (forceClear) return { collectionId: null, folderId: null };
    let resolvedCollectionId = collectionId ?? null;
    const resolvedFolderId = folderId ?? null;

    if (resolvedFolderId) {
      const folderRows = await this.db
        .select()
        .from(collectionFolders)
        .where(eq(collectionFolders.id, resolvedFolderId))
        .limit(1);
      const folder = folderRows[0];
      if (!folder) throw ApiError.notFound("Folder not found");
      if (resolvedCollectionId && resolvedCollectionId !== folder.collectionId) {
        throw ApiError.validation("Folder does not belong to the selected collection");
      }
      resolvedCollectionId = folder.collectionId;
    }

    if (resolvedCollectionId) {
      const collectionRows = await this.db
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, resolvedCollectionId), eq(collections.projectId, projectId)))
        .limit(1);
      if (!collectionRows[0]) throw ApiError.notFound("Collection not found");
      if (resolvedFolderId) {
        const folderRows = await this.db
          .select({ collectionId: collectionFolders.collectionId })
          .from(collectionFolders)
          .where(eq(collectionFolders.id, resolvedFolderId))
          .limit(1);
        if (folderRows[0]?.collectionId !== resolvedCollectionId) {
          throw ApiError.validation("Folder does not belong to the selected collection");
        }
      }
    }

    return { collectionId: resolvedCollectionId, folderId: resolvedFolderId };
  }

  private async validateOperation(projectId: string, operationId: string | null): Promise<void> {
    if (!operationId) return;
    const rows = await this.db
      .select({ id: apiOperations.id })
      .from(apiOperations)
      .where(and(eq(apiOperations.id, operationId), eq(apiOperations.projectId, projectId)))
      .limit(1);
    if (!rows[0]) throw ApiError.notFound("API operation not found");
  }
}

function versionValues(
  definition: RequestDefinition,
  userId: string,
  changeSummary: string,
): Omit<typeof apiRequestVersions.$inferInsert, "apiRequestId" | "versionNumber"> {
  const body = definition.body;
  return {
    method: definition.method,
    path: definition.path,
    queryParams: definition.queryParams,
    headers: definition.headers,
    authConfig: definition.authConfig,
    bodyKind: body.kind,
    bodyJson:
      body.kind === "json"
        ? (body.value as object)
        : body.kind === "urlencoded"
          ? body.entries
          : body.kind === "multipart"
            ? body.parts
            : null,
    bodyText: body.kind === "text" ? body.text : null,
    bodyObjectKey: null,
    bodyContentType:
      body.kind === "json" || body.kind === "text"
        ? (body.contentType ?? (body.kind === "json" ? "application/json" : "text/plain"))
        : body.kind === "urlencoded"
          ? "application/x-www-form-urlencoded"
          : body.kind === "multipart"
            ? "multipart/form-data"
            : null,
    bodyEncoding: null,
    requestOptions: definition.requestOptions,
    responseAssertions: [],
    changeSummary,
    sourceObservationAtCreation: "unknown",
    sourceMetadata: { origin: "manual" },
    createdBy: userId,
  };
}

function toSummary(
  request: typeof apiRequests.$inferSelect,
  version: typeof apiRequestVersions.$inferSelect | null,
): ApiRequestSummary {
  return {
    id: request.id,
    projectId: request.projectId,
    collectionId: request.collectionId,
    folderId: request.folderId,
    apiOperationId: request.apiOperationId,
    name: request.name,
    description: request.description,
    tags: request.tags,
    requestLifecycle: request.requestLifecycle,
    executionScope: request.executionScope,
    currentVersionId: request.currentVersionId,
    currentVersionNumber: version?.versionNumber ?? null,
    method: version?.method ?? "",
    path: version?.path ?? "",
    createdBy: request.createdBy,
    updatedBy: request.updatedBy,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    archivedAt: request.archivedAt?.toISOString() ?? null,
  };
}

function toVersion(version: typeof apiRequestVersions.$inferSelect): ApiRequestVersion {
  const body = bodyFromRow(version);
  return {
    id: version.id,
    requestId: version.apiRequestId,
    versionNumber: version.versionNumber,
    method: version.method as HttpMethod,
    path: version.path,
    queryParams: version.queryParams as KeyValueEntry[],
    headers: version.headers as KeyValueEntry[],
    authConfig: version.authConfig as AuthConfig,
    body,
    requestOptions: version.requestOptions as RequestOptions,
    responseAssertions: version.responseAssertions,
    changeSummary: version.changeSummary,
    sourceObservationAtCreation: version.sourceObservationAtCreation,
    sourceMetadata: version.sourceMetadata,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  };
}

function bodyFromRow(version: typeof apiRequestVersions.$inferSelect): RequestBody {
  switch (version.bodyKind) {
    case "none":
      return { kind: "none" };
    case "json":
      return {
        kind: "json",
        value: version.bodyJson,
        ...(version.bodyContentType ? { contentType: version.bodyContentType } : {}),
      };
    case "text":
      return {
        kind: "text",
        text: version.bodyText ?? "",
        ...(version.bodyContentType ? { contentType: version.bodyContentType } : {}),
      };
    case "urlencoded":
      return {
        kind: "urlencoded",
        entries: (version.bodyJson as KeyValueEntry[] | null) ?? [],
      };
    case "multipart":
      return {
        kind: "multipart",
        parts: (version.bodyJson as MultipartPart[] | null) ?? [],
      };
    case "binary":
      return { kind: "none" };
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, "\\$&");
}

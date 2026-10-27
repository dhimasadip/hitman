import {
  ApiError,
  type CollectionDetail,
  type CollectionFolderSummary,
  type CollectionSummary,
  type CreateCollectionFolderRequest,
  type CreateCollectionRequest,
  type UpdateCollectionFolderRequest,
  type UpdateCollectionRequest,
} from "@hitman/contracts";
import { apiRequests, collectionFolders, collections } from "@hitman/database/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthorizationService } from "../authorization/authorization-service.js";
import type { Db } from "../shared/db.js";

export class CollectionService {
  constructor(
    private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async listCollections(userId: string, projectId: string): Promise<CollectionDetail[]> {
    await this.authorization.requireProjectRead(userId, projectId);
    const collectionRows = await this.db
      .select()
      .from(collections)
      .where(eq(collections.projectId, projectId))
      .orderBy(asc(collections.sortOrder), asc(collections.name));
    if (collectionRows.length === 0) return [];

    const ids = collectionRows.map((collection) => collection.id);
    const folderRows = await this.db
      .select()
      .from(collectionFolders)
      .where(inArray(collectionFolders.collectionId, ids))
      .orderBy(asc(collectionFolders.sortOrder), asc(collectionFolders.name));
    const requestCounts = await this.db
      .select({
        collectionId: apiRequests.collectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(apiRequests)
      .where(and(eq(apiRequests.projectId, projectId), inArray(apiRequests.collectionId, ids)))
      .groupBy(apiRequests.collectionId);
    const countMap = new Map(
      requestCounts
        .filter((row): row is { collectionId: string; count: number } => row.collectionId !== null)
        .map((row) => [row.collectionId, Number(row.count)]),
    );

    return collectionRows.map((collection) => {
      const folders = folderRows.filter((folder) => folder.collectionId === collection.id);
      return {
        id: collection.id,
        projectId: collection.projectId,
        name: collection.name,
        description: collection.description,
        sortOrder: collection.sortOrder,
        requestCount: countMap.get(collection.id) ?? 0,
        folderCount: folders.length,
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt.toISOString(),
        folders: folders.map(toFolderSummary),
      };
    });
  }

  async createCollection(
    userId: string,
    projectId: string,
    input: CreateCollectionRequest,
    correlationId: string | null,
  ): Promise<CollectionSummary> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    this.ensureActive(access.project);
    const collection = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(collections)
        .values({
          projectId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          sortOrder: input.sortOrder,
          createdBy: userId,
        })
        .returning();
      const created = rows[0];
      if (!created) throw new Error("collection insert returned no row");
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "collection.created",
        resourceType: "collection",
        resourceId: created.id,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { name: created.name },
      });
      return created;
    });

    return {
      id: collection.id,
      projectId,
      name: collection.name,
      description: collection.description,
      sortOrder: collection.sortOrder,
      requestCount: 0,
      folderCount: 0,
      createdAt: collection.createdAt.toISOString(),
      updatedAt: collection.updatedAt.toISOString(),
    };
  }

  async updateCollection(
    userId: string,
    projectId: string,
    collectionId: string,
    input: UpdateCollectionRequest,
    correlationId: string | null,
  ): Promise<CollectionSummary> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    this.ensureActive(access.project);
    const collection = await this.findCollection(collectionId, projectId);
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(collections)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collections.id, collectionId))
        .returning();
      const row = rows[0];
      if (!row) throw ApiError.notFound("Collection not found");
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "collection.updated",
        resourceType: "collection",
        resourceId: collectionId,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { name: row.name },
      });
      return row;
    });

    const counts = await this.collectionCounts(collection.id);
    return {
      id: updated.id,
      projectId,
      name: updated.name,
      description: updated.description,
      sortOrder: updated.sortOrder,
      ...counts,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteCollection(
    userId: string,
    projectId: string,
    collectionId: string,
    correlationId: string | null,
  ): Promise<void> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    this.ensureActive(access.project);
    await this.findCollection(collectionId, projectId);
    const folders = await this.db
      .select({ id: collectionFolders.id })
      .from(collectionFolders)
      .where(eq(collectionFolders.collectionId, collectionId))
      .limit(1);
    const requests = await this.db
      .select({ id: apiRequests.id })
      .from(apiRequests)
      .where(eq(apiRequests.collectionId, collectionId))
      .limit(1);
    if (folders[0] || requests[0]) {
      throw ApiError.conflict("Collection must be empty before deletion");
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(collections).where(eq(collections.id, collectionId));
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "collection.deleted",
        resourceType: "collection",
        resourceId: collectionId,
        projectId,
        outcome: "success",
        correlationId,
      });
    });
  }

  async createFolder(
    userId: string,
    projectId: string,
    collectionId: string,
    input: CreateCollectionFolderRequest,
    correlationId: string | null,
  ): Promise<CollectionFolderSummary> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    this.ensureActive(access.project);
    await this.findCollection(collectionId, projectId);
    if (input.parentFolderId) {
      await this.assertFolder(input.parentFolderId, collectionId);
    }

    const folder = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(collectionFolders)
        .values({
          collectionId,
          parentFolderId: input.parentFolderId ?? null,
          name: input.name.trim(),
          sortOrder: input.sortOrder,
        })
        .returning();
      const created = rows[0];
      if (!created) throw new Error("folder insert returned no row");
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "collection_folder.created",
        resourceType: "collection_folder",
        resourceId: created.id,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { collectionId, name: created.name },
      });
      return created;
    });

    return toFolderSummary(folder);
  }

  async updateFolder(
    userId: string,
    projectId: string,
    collectionId: string,
    folderId: string,
    input: UpdateCollectionFolderRequest,
    correlationId: string | null,
  ): Promise<CollectionFolderSummary> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    this.ensureActive(access.project);
    await this.findCollection(collectionId, projectId);
    const folder = await this.assertFolder(folderId, collectionId);
    if (input.parentFolderId !== undefined) {
      if (input.parentFolderId === folderId) {
        throw ApiError.validation("A folder cannot be its own parent");
      }
      if (input.parentFolderId) {
        await this.assertFolder(input.parentFolderId, collectionId);
        await this.assertNotDescendant(folderId, input.parentFolderId);
      }
    }

    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(collectionFolders)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.parentFolderId !== undefined ? { parentFolderId: input.parentFolderId } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collectionFolders.id, folder.id))
        .returning();
      const row = rows[0];
      if (!row) throw ApiError.notFound("Folder not found");
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "collection_folder.updated",
        resourceType: "collection_folder",
        resourceId: folderId,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { name: row.name },
      });
      return row;
    });

    return toFolderSummary(updated);
  }

  async deleteFolder(
    userId: string,
    projectId: string,
    collectionId: string,
    folderId: string,
    correlationId: string | null,
  ): Promise<void> {
    const access = await this.authorization.requireProjectEdit(userId, projectId);
    this.ensureActive(access.project);
    await this.findCollection(collectionId, projectId);
    await this.assertFolder(folderId, collectionId);
    const children = await this.db
      .select({ id: collectionFolders.id })
      .from(collectionFolders)
      .where(eq(collectionFolders.parentFolderId, folderId))
      .limit(1);
    const requests = await this.db
      .select({ id: apiRequests.id })
      .from(apiRequests)
      .where(eq(apiRequests.folderId, folderId))
      .limit(1);
    if (children[0] || requests[0]) {
      throw ApiError.conflict("Folder must be empty before deletion");
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(collectionFolders).where(eq(collectionFolders.id, folderId));
      await this.audit.record(tx, {
        organizationId: access.project.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "collection_folder.deleted",
        resourceType: "collection_folder",
        resourceId: folderId,
        projectId,
        outcome: "success",
        correlationId,
        metadata: { collectionId },
      });
    });
  }

  private async findCollection(
    collectionId: string,
    projectId: string,
  ): Promise<typeof collections.$inferSelect> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.projectId, projectId)))
      .limit(1);
    const collection = rows[0];
    if (!collection) throw ApiError.notFound("Collection not found");
    return collection;
  }

  private async assertFolder(
    folderId: string,
    collectionId: string,
  ): Promise<typeof collectionFolders.$inferSelect> {
    const rows = await this.db
      .select()
      .from(collectionFolders)
      .where(
        and(eq(collectionFolders.id, folderId), eq(collectionFolders.collectionId, collectionId)),
      )
      .limit(1);
    const folder = rows[0];
    if (!folder) throw ApiError.notFound("Folder not found");
    return folder;
  }

  private async assertNotDescendant(folderId: string, candidateParentId: string): Promise<void> {
    let current: string | null = candidateParentId;
    const seen = new Set<string>();
    while (current) {
      if (current === folderId) {
        throw ApiError.conflict("A folder cannot be moved beneath one of its descendants");
      }
      if (seen.has(current)) return;
      seen.add(current);
      const rows = await this.db
        .select({ parentFolderId: collectionFolders.parentFolderId })
        .from(collectionFolders)
        .where(eq(collectionFolders.id, current))
        .limit(1);
      current = rows[0]?.parentFolderId ?? null;
    }
  }

  private async collectionCounts(
    collectionId: string,
  ): Promise<{ requestCount: number; folderCount: number }> {
    const requestRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiRequests)
      .where(eq(apiRequests.collectionId, collectionId));
    const folderRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(collectionFolders)
      .where(eq(collectionFolders.collectionId, collectionId));
    return {
      requestCount: Number(requestRows[0]?.count ?? 0),
      folderCount: Number(folderRows[0]?.count ?? 0),
    };
  }

  private ensureActive(project: { status: string }): void {
    if (project.status === "archived") {
      throw ApiError.conflict("Project is archived; restore it before making changes");
    }
  }
}

function toFolderSummary(folder: typeof collectionFolders.$inferSelect): CollectionFolderSummary {
  return {
    id: folder.id,
    collectionId: folder.collectionId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    sortOrder: folder.sortOrder,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

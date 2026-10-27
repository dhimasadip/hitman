import type { AuditActorType, AuditOutcome } from "@hitman/contracts";
import { auditEvents } from "@hitman/database/schema";
import type { DbExecutor } from "../shared/db.js";

export interface AuditInput {
  organizationId: string;
  actorUserId?: string | null;
  actorDeviceId?: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  projectId?: string | null;
  outcome: AuditOutcome;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  async record(executor: DbExecutor, input: AuditInput): Promise<void> {
    await executor.insert(auditEvents).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorDeviceId: input.actorDeviceId ?? null,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      projectId: input.projectId ?? null,
      outcome: input.outcome,
      correlationId: input.correlationId ?? null,
      metadata: input.metadata ?? {},
    });
  }
}

import type { Logger, ServerConfig } from "@hitman/config";
import { AuditService } from "../audit/audit-service.js";
import { AuthorizationService } from "../authorization/authorization-service.js";
import { OrganizationService } from "../organizations/organization-service.js";
import type { Db } from "../shared/db.js";
import { AuthService } from "./auth-service.js";
import { ProvisioningService } from "./provisioning-service.js";
import { SessionService } from "./session-service.js";

export interface IdentityServices {
  audit: AuditService;
  authorization: AuthorizationService;
  sessions: SessionService;
  auth: AuthService;
  organizations: OrganizationService;
  provisioning: ProvisioningService;
}

export function createIdentityServices(
  db: Db,
  config: ServerConfig,
  logger: Logger,
): IdentityServices {
  const audit = new AuditService();
  const authorization = new AuthorizationService(db);
  const sessions = new SessionService(db, config);
  const auth = new AuthService(db, sessions, authorization, audit, logger);
  const organizations = new OrganizationService(db, authorization, audit, sessions);
  const provisioning = new ProvisioningService(db, audit, sessions);
  return { audit, authorization, sessions, auth, organizations, provisioning };
}

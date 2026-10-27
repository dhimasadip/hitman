import type { Logger, ServerConfig } from "@hitman/config";
import { AuditService } from "../audit/audit-service.js";
import { AuthorizationService } from "../authorization/authorization-service.js";
import { CollectionService } from "../catalog/collection-service.js";
import { RequestService } from "../catalog/request-service.js";
import { SpecificationService } from "../catalog/spec-service.js";
import { MockGitLabProvider } from "../gitlab/gitlab-provider.js";
import { OrganizationService } from "../organizations/organization-service.js";
import { ProjectService } from "../projects/project-service.js";
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
  projects: ProjectService;
  specifications: SpecificationService;
  collections: CollectionService;
  requests: RequestService;
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
  const gitlab = new MockGitLabProvider();
  const projects = new ProjectService(db, authorization, audit, gitlab);
  const specifications = new SpecificationService(db, authorization, audit, gitlab);
  const collections = new CollectionService(db, authorization, audit);
  const requests = new RequestService(db, authorization, audit);
  const provisioning = new ProvisioningService(db, audit, sessions);
  return {
    audit,
    authorization,
    sessions,
    auth,
    organizations,
    projects,
    specifications,
    collections,
    requests,
    provisioning,
  };
}

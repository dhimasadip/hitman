# Hitman architecture overview

**Status:** Phase 3 runtime baseline
**Source of truth:** `Hitman-PRD.md`

## Shape

Hitman starts as a modular monolith with separate runtime entrypoints:

```text
apps/web (React/Vite) ──HTTPS──┐
                               ├──> apps/server (Fastify REST + MCP, Phase 9)
AI client ──MCP/Streamable HTTP┘         │
                                        ├──> PostgreSQL (authoritative)
                                        ├──> SecretProvider (env now, manager later)
                                        ├──> ObjectStorage interface (disabled now)
                                        └──> worker boundary (apps/worker)

runner-go (Windows/WSL2) ──outbound WSS + HTTPS (Phase 11+)──> server
```

Business state, idempotency records, jobs, leases, and results live in
PostgreSQL. WebSocket messages are notifications only (ADR 0005).

## Code boundaries

```text
apps/
  server/       Fastify app factory, health, metrics, correlation/error envelope
  worker/       health server + scheduler boundary (durable loops in Phase 13)
  web/          React shell, readiness/version view, TanStack Query
packages/
  contracts/    public error/health schemas and shared error class
  config/       env validation, structured logger, redaction, secrets, storage
  database/     Drizzle client, schema baseline, migration runner
database/       checked-in SQL migrations and seeds
runner-go/      independent Go module: version, config, destination policy
spikes/         disposable Phase 2 evidence (MCP, OpenAPI, WSL2, durable jobs)
infra/          Dockerfiles, staging compose/proxy, observability starters
docs/           ADRs, policies, architecture, runbooks, phase evidence
```

Future domain modules (`identity-access`, `projects`, `api-requests`,
`execution-jobs`, etc.) are application-service packages/imports inside
`apps/server`, not separate services. REST and MCP must call the same services.

## Identity and access (Phase 4)

- Native accounts use password + Argon2id; opaque sessions are stored hashed in
  PostgreSQL. Cookie-bound CSRF is required for unsafe methods.
- `AuthorizationService` is the single organization/team/project authorization
  boundary. Routes call it before any query that returns data.
- Missing membership returns 404; insufficient role within a known resource
  returns 403. Last organization and project administrators are protected.
- Privileged actions and failed logins write `audit_events`.
- Administrator provisioning is CLI-only; there is no self-registration.
- Hitman OAuth 2.1 authorization-server endpoints and MCP resource-server
  validation ship with the MCP endpoint in Phase 9. Production MCP never uses a
  static-token-only path.

## Projects and repository registration (Phase 5)

- Projects are organization-scoped and creatable without a repository, OpenAPI
  document, or runner.
- Only organization admins create projects; the creator becomes the initial
  project administrator.
- Project access is explicit membership (`project_admin`, `editor`, `executor`,
  `viewer`). Organization admins have implicit project-admin access.
- `owner_team_id` is ownership metadata, not an access grant.
- A project always retains at least one explicit project administrator.
- One project has one repository; one GitLab repository maps to one project per
  organization.
- GitLab is a `MockGitLabProvider` in Phase 5. The connection uses
  `auth_mode=mock` and a secret reference; no token is stored. Live API/OAuth,
  webhooks, and reconciliation are Phase 15.
- OpenAPI file paths are stored but not parsed until Phase 6.

## Cross-cutting rules

- **Authorization is server-side** and centralized (Phases 4–5).
- **Request versions are immutable**; edits create a new version (Phase 6).
- **Creation is not execution**; execution is not deployment; merge is not
  deployment (Phases 10, 13–16).
- **Source observations are unverified hints** until GitLab reconciliation
  (Phase 15).
- **No secrets** in logs, audit metadata, MCP output, or request snapshots.
- **No shell/arbitrary code** in the runner; approved HTTP only.
- **Outcome-unknown** is a first-class result, not a retry prompt.

## Runtime topology (Phase 3)

| Component      | Local                                                | Staging manifests                 |
| -------------- | ---------------------------------------------------- | --------------------------------- |
| Web            | Vite dev server `127.0.0.1:5173` proxying API        | Nginx static container            |
| Server         | Node process `127.0.0.1:8080`; auth/org/project APIs | container :8080 behind TLS proxy  |
| Worker         | Node process `127.0.0.1:8081`                        | container :8081, internal only    |
| PostgreSQL     | user-owned cluster `127.0.0.1:5433`                  | container, internal network       |
| Migrations     | `pnpm db:migrate`                                    | one-shot `migrate` service        |
| Metrics        | `/metrics` bearer token                              | internal scrape only; ingress 404 |
| Object storage | disabled interface                                   | disabled until Phase 14           |

## Projects

- `GET/POST /api/v1/organizations/:organizationId/projects`
- `GET/PATCH /api/v1/projects/:projectId`
- `POST /api/v1/projects/:projectId/archive|restore`
- project members and mocked repository sub-resources

Project access is explicit membership; organization admins manage all projects
in their organization. `owner_team_id` is metadata only. The Phase 5 GitLab
provider is mocked and labeled in the UI; live integration is Phase 15.

## Data flow for a future request execution (Phases 10, 13–14)

1. UI/MCP calls the shared `start_execution` service.
2. Service authorizes project/device/environment, resolves the request version
   and target, and inserts a durable job with an idempotency key and snapshot
   hash.
3. Server commits, then notifies the online runner over WSS.
4. Runner claims over authenticated HTTPS, receives a lease token, starts, and
   executes against the pre-authorized target with policy revalidation.
5. Runner reports a sanitized result; stale/wrong-device reports are rejected.
6. Server persists the result, audit event, and terminal state; UI/MCP reads it.
7. Lost lease/result becomes `outcome_unknown`; no blind retry.

## Known Phase 3–5 gaps (intentional)

- No request collections, request editor, environments, or execution tables/APIs
  yet (Phases 6–14).
- No `/mcp` route in the production server yet (Phase 9; spike is separate).
- Worker has no job loops yet (Phase 13).
- Staging compose is not deployed (no infrastructure/Docker available).
- Object storage is an interface only.
- GitLab is mocked; live API/OAuth, webhooks, and reconciliation are Phase 15.
- OpenAPI parsing/import is Phase 6.
- OAuth AS/MCP token endpoints, SAML/OIDC federation, MFA, and self-service
  invitations are not implemented yet.

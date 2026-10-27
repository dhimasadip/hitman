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
- `AuthorizationService` is the single org/team authorization boundary.
  Organization/team routes call it before any query that returns data.
- Missing membership returns 404; insufficient role within a known organization
  returns 403. The last organization administrator is protected.
- Privileged actions and failed logins write `audit_events`.
- Administrator provisioning is CLI-only; there is no self-registration.
- Hitman OAuth 2.1 authorization-server endpoints and MCP resource-server
  validation ship with the MCP endpoint in Phase 9. Production MCP never uses a
  static-token-only path.

## Cross-cutting rules

- **Authorization is server-side** and centralized (Phase 4).
- **Request versions are immutable**; edits create a new version (Phase 6).
- **Creation is not execution**; execution is not deployment; merge is not
  deployment (Phases 10, 13–16).
- **Source observations are unverified hints** until GitLab reconciliation
  (Phase 15).
- **No secrets** in logs, audit metadata, MCP output, or request snapshots.
- **No shell/arbitrary code** in the runner; approved HTTP only.
- **Outcome-unknown** is a first-class result, not a retry prompt.

## Runtime topology (Phase 3)

| Component      | Local                                         | Staging manifests                 |
| -------------- | --------------------------------------------- | --------------------------------- |
| Web            | Vite dev server `127.0.0.1:5173` proxying API | Nginx static container            |
| Server         | Node process `127.0.0.1:8080`; auth/org APIs  | container :8080 behind TLS proxy  |
| Worker         | Node process `127.0.0.1:8081`                 | container :8081, internal only    |
| PostgreSQL     | user-owned cluster `127.0.0.1:5433`           | container, internal network       |
| Migrations     | `pnpm db:migrate`                             | one-shot `migrate` service        |
| Metrics        | `/metrics` bearer token                       | internal scrape only; ingress 404 |
| Object storage | disabled interface                            | disabled until Phase 14           |

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

## Known Phase 3/4 gaps (intentional)

- No project/request/execution tables or APIs yet (Phases 5–14).
- No `/mcp` route in the production server yet (Phase 9; spike is separate).
- Worker has no job loops yet (Phase 13).
- Staging compose is not deployed (no infrastructure/Docker available).
- Object storage is an interface only.
- OAuth AS/MCP token endpoints, SAML/OIDC federation, MFA, and self-service
  invitations are not implemented yet.

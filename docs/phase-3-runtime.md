# Phase 3 — Runtime and infrastructure baseline

**Date:** 2026-10-27
**Status:** Local runtime verified; staging manifests produced but not deployed
(no Docker CLI, staging host, or company infrastructure in this environment).

## Delivered

### Reproducible local runtime

- Node.js 24.22.0 + pnpm 12.14.0 workspace.
- User-owned PostgreSQL 16.15 cluster on `127.0.0.1:5433` via
  `scripts/dev-db.sh`; creates `hitman_dev` and `hitman_test`; trust auth is
  loopback-only and development-only.
- `.env.example` + local `.env`; startup validation fails fast without echoing
  values.
- Separate API and worker entrypoints from one codebase.
- Web SPA shell with readiness/version cards.

### Runtime endpoints

| Endpoint        | Server                                             | Worker                        |
| --------------- | -------------------------------------------------- | ----------------------------- |
| `/health/live`  | 200                                                | 200                           |
| `/health/ready` | 200/503 with PostgreSQL check                      | 200/503 with PostgreSQL check |
| `/metrics`      | Prometheus; bearer-token protected when configured | same                          |
| `/version`      | build metadata                                     | build metadata                |
| `/api/v1/meta`  | product/provider metadata                          | —                             |

`/metrics` returns 404 through the staging ingress; Prometheus scrapes the
internal service addresses with a mounted token. HSTS and security headers are
set by the app and proxy.

### Migrations

- Drizzle schema/migration pipeline with a checked-in baseline
  `database/migrations/0000_platform_baseline.sql`.
- Migration runner `packages/database/src/migrate.ts`.
- Local apply verified: `platform_schema_state` exists in `hitman_dev`.
- CI migration job applies twice (idempotency) to a disposable PostgreSQL.
- Migrations are a separate deployment step; app instances never race them.

### Secrets, storage, observability

- `SecretProvider` interface with `env://` local provider.
- `ObjectStorage` interface with disabled adapter; provisioning deferred.
- Pino structured JSON logs with redaction paths and safe error serialization.
- Request correlation IDs (`x-request-id`) propagated into logs/error envelopes.
- Prometheus process/HTTP metrics; worker liveness/poll metrics.
- Prometheus scrape and starter alert rules under `infra/observability/`.
- Health/readiness checks and graceful shutdown with timeout.

### Deployment artifacts

- `infra/deployment/Dockerfile.node` (server/worker/migrate runtime).
- `infra/deployment/Dockerfile.web` + Nginx static config.
- `infra/deployment/docker-compose.staging.yml`: PostgreSQL, one-shot migration,
  server, worker, web, TLS proxy with rate limiting, size limits, `/metrics`
  denial, `/ws` upgrade reserved.
- `.env.staging.example` and TLS generation notes; no secrets/certs committed.
- GitLab CI stages: validate, test, build, security, manual staging deploy;
  Compose validation job.
- Runbooks: staging deploy/rollback, database backup/restore, local runtime.

## Verification evidence

Local commands:

```bash
pnpm db:dev start
pnpm db:migrate
node --env-file=.env apps/server/dist/index.js
node --env-file=.env apps/worker/dist/index.js
```

Observed:

- API `/health/ready` → `200`, `{"status":"ok", ... "checks":[{"name":"postgres","status":"ok",...}]}`
- API `/metrics` without token → `401`; with dev token → Prometheus text.
- Worker `/health/ready` → `200`, PostgreSQL ok.
- Worker `/metrics` → `hitman_worker_up 1` and poll counter.
- `pnpm build` → API/worker/contracts/packages compile; web production build
  succeeds.
- `pnpm test` with `TEST_DATABASE_URL` → all TypeScript tests pass, including
  migration + database integration and spikes.
- Go tests pass for runner config/policy; runner `version` prints build metadata.
- No Docker command exists on this host, so container builds and Compose were not
  executed. CI definitions validate them when a runner is available.

## Exit criteria assessment

| Criterion                                              | Status                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Development/staging deployments reproducible           | Local **verified**; staging **manifests ready, not executed** |
| Operators can see logs, health, errors without secrets | **Verified locally**; alert rules provided                    |
| Separate server/worker entrypoints                     | **Verified**                                                  |
| Migration ordering safe                                | **Verified locally and in CI definition**                     |
| Secrets not baked into images/config                   | Design + examples; production secret manager still required   |
| Object storage                                         | Interface only, intentionally deferred                        |

## Required follow-ups

1. Provision real staging (or an approved orchestrator) and run the compose/CI
   deployment at least once.
2. Add the company secret-manager provider in Phase 4/8; `env` remains local-only.
3. Add OpenTelemetry export and alert routing in Phase 17.
4. Add runner endpoints/WSS gateway in Phase 11; the proxy route is reserved.
5. Run the backup/restore drill against the chosen platform in Phase 17.

# ADR 0008 — Runtime and deployment baseline

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Platform, engineering lead
- **PRD references:** §6, §7, §16, §22, Phase 3

## Decision

1. **Modular monolith** with independent runtime entrypoints:
   - `apps/server` — Fastify REST + hosted MCP endpoint (MCP route arrives in
     Phase 9; Phase 3 server has health/metrics/meta).
   - `apps/worker` — health server and scheduling boundary; durable work arrives
     in Phase 13.
   - `apps/web` — React/Vite static SPA.
   - `runner-go` — separate Go module, no shared TypeScript implementation.
2. **Local development** runs on the WSL2 host directly:
   - Node.js 24.22.0, pnpm 12.14.0, Go 1.27.3.
   - A user-owned PostgreSQL 16.15 cluster on `127.0.0.1:5433`, created by
     `scripts/dev-db.sh`, using trust auth for local development only.
   - No Docker dependency for Phase 3 local development.
3. **Staging delivery** is represented by container manifests:
   - `infra/deployment/Dockerfile.node` for server/worker/migrate.
   - `infra/deployment/Dockerfile.web` plus Nginx for static assets.
   - `infra/deployment/docker-compose.staging.yml` with PostgreSQL, migration
     job, server, worker, web, and TLS reverse proxy.
   - A manual GitLab CI `deploy:staging` job targets a staging runner when one
     is provisioned. It was not executed in Phase 3 because no staging host,
     Docker runtime, or company infrastructure is available in this
     environment.
4. **Configuration** is validated at process startup with Zod. Required values
   fail fast; error messages never echo secret values.
5. **Secrets** use a `SecretProvider` interface. Phase 3 ships the `env://`
   provider for local development. Production must use the company secret
   manager through an added provider, not plaintext database columns.
6. **Object storage** is an interface only. `OBJECT_STORAGE_DRIVER=disabled`;
   S3-compatible provisioning is deferred until large/binary bodies are in scope.
7. **Health endpoints:** `/health/live` and `/health/ready` on both server and
   worker. Readiness checks PostgreSQL. Metrics are exposed at `/metrics`,
   protected by `METRICS_TOKEN` in staging/production and hidden at the ingress.
8. **Migrations** run as a separate job (`packages/database/src/migrate.ts`)
   before application rollout. Drizzle-kit generates checked-in SQL; a database
   advisory lock prevents concurrent migration races through the migrator's
   ordering and deployment sequencing.
9. **Rollback** is forward-fix first. Application rollback uses the previous
   image tag; destructive schema rollback requires a reviewed backup/restore
   plan. See `docs/runbooks/staging-deploy-rollback.md`.

## Consequences

- The local development loop is fast and does not require Docker, but container
  images are validated only in CI until a Docker runtime is available.
- Staging remains reproducible-as-code, not actually provisioned.
- Phase 4 can add identity without changing runtime topology.

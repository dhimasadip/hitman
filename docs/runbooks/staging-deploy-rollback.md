# Runbook — staging deployment and rollback

> Phase 3 produces manifests, not a provisioned staging environment. This
> runbook is the intended procedure once a staging host/runner exists.

## Prerequisites

- Docker Engine + Compose plugin on the staging host (or an equivalent
  orchestrator using the same images).
- `infra/deployment/.env.staging` populated from the secret manager. Never commit
  it.
- TLS key/cert under `infra/deployment/tls/` from the organization PKI, or an
  ingress that terminates TLS.
- PostgreSQL reachable from the migration job and app containers.
- A container registry containing the built node/web images.

## Deploy

1. Freeze the release and record `SERVICE_VERSION`, `GIT_COMMIT`, `BUILD_TIME`,
   and image digests.
2. Back up PostgreSQL and verify the backup before a destructive migration.
3. Build/publish images from the reviewed commit. The GitLab CI pipeline runs
   lint/typecheck/tests/migration validation/build before the manual deploy job.
4. Run the **one-shot migration service** first. It must complete successfully
   before server or worker starts (`service_completed_successfully`).
5. Start server, worker, web, and proxy with health checks.
6. Verify:
   - `GET /health/live` 200;
   - `GET /health/ready` 200 with `postgres` check ok;
   - worker readiness 200;
   - `/metrics` requires the token internally and returns 404 through ingress;
   - web shell loads and reports readiness;
   - no secret appears in logs.
7. Bootstrap the first organization/administrator if this is the initial
   deployment. Run the admin CLI with the staging `DATABASE_URL` and inject the
   password from the secret manager; never pass it as an argument or leave it in
   shell history.
8. Record the deployment and retain the previous image tags.

## Rollback

Application rollback (preferred for non-schema failures):

1. Set the previous `HITMAN_NODE_IMAGE`/`HITMAN_WEB_IMAGE` tags in
   `.env.staging`.
2. Run `docker compose ... up -d --no-deps server worker web proxy`.
3. Verify health and error rate.
4. Do not roll back migrations destructively without a reviewed plan. Prefer a
   forward-fix migration.

Database restore (only for destructive failure):

1. Stop server and worker.
2. Restore the verified backup using the platform procedure.
3. Run migrations if the backup predates the current schema.
4. Start services and verify readiness/audit integrity.
5. Record incident, data-loss window, and approval.

## Staging secrets

Required: `POSTGRES_PASSWORD`, `METRICS_TOKEN`, and any future GitLab/OAuth
credentials. Inject from the platform secret manager; do not bake into images or
commit `.env.staging`. Rotate on suspected exposure and audit the change.

## Known limitations

- The compose stack has not been executed in this environment (no Docker CLI,
  no staging host).
- Deployment evidence, webhook infrastructure, and runner endpoints are future
  phases. The proxy already reserves `/ws` for Phase 11.
- A real orchestrator may replace Compose; preserve the migration ordering,
  health checks, internal metrics, and secret injection rules.

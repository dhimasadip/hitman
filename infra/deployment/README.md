# Deployment

- `Dockerfile.node` — build once, run as server, worker, or migration job via
  `APP` build arg.
- `Dockerfile.web` — static web asset builder + Nginx runtime.
- `docker-compose.staging.yml` — PostgreSQL, one-shot migration, server, worker,
  web, TLS proxy. This is a reference deployment; see the runbook.
- `nginx.conf` — TLS termination, rate limiting, size limits, `/metrics` denial,
  `/ws` upgrade reservation.
- `nginx-web.conf` — static asset serving and SPA fallback.
- `.env.staging.example` — required variable names; values come from the secret
  manager.
- `tls/` — local generation instructions only; no certificates committed.

Read `docs/runbooks/staging-deploy-rollback.md` before using this stack. It has
not been executed in the Phase 3 environment (no Docker/staging host).

**TLS caveat:** the Compose PostgreSQL service is a local-parity container on an
internal bridge network and sets `DATABASE_SSL=false`. A real staging/production
deployment must use a managed/approved PostgreSQL endpoint with TLS enforced
(`DATABASE_SSL=true`) and a verified CA. Do not treat the Compose database as a
production security model.

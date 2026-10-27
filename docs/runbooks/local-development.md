# Runbook — local development runtime

## Start/stop

```bash
pnpm db:dev start
pnpm db:dev status
pnpm db:dev stop
```

Logs: `.dev/postgres.log` (`pnpm db:dev logs`).
Connect: `pnpm db:dev psql`.

The cluster uses port **5433** intentionally so it does not collide with a system
PostgreSQL on 5432. Trust auth is bound to loopback only.

## API/worker

```bash
pnpm dev
```

Both processes log JSON to stdout. Readiness failures return HTTP 503 with a
sanitized check object. Metrics are exposed on the API/worker health servers and
are protected by `METRICS_TOKEN` when configured.

## Identity bootstrap and provisioning

There is no self-registration. Use the administrator CLI:

```bash
HITMAN_BOOTSTRAP_PASSWORD='...' pnpm admin bootstrap \
  --org-name "Local" --org-slug local --email admin@local.test --display-name "Local Admin"

HITMAN_USER_PASSWORD='...' pnpm admin add-member \
  --org-slug local --email user@local.test --display-name "User" --role member

HITMAN_NEW_PASSWORD='...' pnpm admin reset-password --email user@local.test
```

Passwords are read from environment variables, never arguments, and are never
printed. Prefer injecting them from a secret manager or a quiet prompt rather
than typing them into shell history. Login attempts are rate-limited (10 per 60
seconds per IP by default). Sessions live in the database; deleting
`.dev/postgres` removes them.

## Projects and mock GitLab

Organization admins create projects from the UI. Project access is explicit;
organization admins can manage every project. The Source tab uses the Phase 5
mock GitLab catalog (`acme/app-a`, `acme/app-b`, `platform/shared-api`). Linking
a repository stores metadata only in development; it does not call GitLab or
store a token. OpenAPI paths are stored but not parsed until Phase 6.

## Recover from a bad local database

```bash
pnpm db:dev stop
HITMAN_RESET_CONFIRM=1 pnpm db:dev reset
pnpm db:dev start
pnpm db:migrate
```

This destroys local development data only. Never point `HITMAN_RESET_CONFIRM=1`
at a shared cluster.

## Migrations

- Generate after schema changes: `pnpm db:generate`.
- Review generated SQL before committing.
- Apply: `pnpm db:migrate`.
- Never edit an applied migration; add a new forward migration.
- For rolling deploys, use expand/contract migrations; do not drop columns in
  the same release that stops reading them.

## Secret handling

`.env` is ignored. `.env.example` contains placeholders. `SecretProvider` in
Phase 3 only supports `env://NAME`; production must add a secret-manager
provider. Do not put values in request definitions, audit metadata, or logs.

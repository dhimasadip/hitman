# Hitman — Internal API Hub

Hitman is an internal API catalog and execution hub for developers and AI coding
agents. It combines a Postman-like web workspace, a hosted MCP endpoint, and
persistent local runners for Windows and WSL2.

**Current status:** Phases 0–6 of `implementation-plan.md` are implemented:
decisions/ADRs, repository and CI foundations, technical validation spikes, the
local/runtime baseline, identity/organization/RBAC, projects with mock GitLab,
and the API catalog with OpenAPI import, operations, collections, and immutable
request versions. The request editor, environments, production MCP tools,
runners, and live GitLab reconciliation start in Phase 7.

- Product source of truth: [`Hitman-PRD.md`](Hitman-PRD.md)
- Delivery plan: [`implementation-plan.md`](implementation-plan.md)
- Phase status: [`docs/implementation-status.md`](docs/implementation-status.md)
- Phase 0 decisions: [`docs/phase-0-signoff.md`](docs/phase-0-signoff.md)
- Phase 2 evidence: [`docs/phase-2-spike-results.md`](docs/phase-2-spike-results.md)
- Phase 3 runtime: [`docs/phase-3-runtime.md`](docs/phase-3-runtime.md)
- Phase 4 identity: [`docs/phase-4-identity.md`](docs/phase-4-identity.md)
- Phase 5 projects: [`docs/phase-5-projects.md`](docs/phase-5-projects.md)
- Phase 6 catalog: [`docs/phase-6-catalog.md`](docs/phase-6-catalog.md)

## Quick start

```bash
pnpm install
bash scripts/install-go.sh      # local Go 1.27.3, no sudo
cp .env.example .env            # if needed; a local .env is already present
pnpm db:dev start               # PostgreSQL 16 on 127.0.0.1:5433
pnpm db:migrate

# Create the first organization and administrator (password via env):
HITMAN_BOOTSTRAP_PASSWORD='choose-a-long-password' pnpm admin bootstrap \
  --org-name "Acme" --org-slug acme \
  --email admin@example.com --display-name "Admin"

pnpm dev                        # API :8080 + worker :8081
pnpm dev:web                    # web :5173 (second terminal)
```

Open http://127.0.0.1:5173 and sign in. Additional users are provisioned with
`pnpm admin add-member`; see [`docs/phase-4-identity.md`](docs/phase-4-identity.md).

Verify:

```bash
pnpm verify
```

Full guide: [`docs/developer-guide/getting-started.md`](docs/developer-guide/getting-started.md).

## What exists now

```text
apps/
  server/    Fastify API, auth/org/team services, health, metrics, errors
  worker/    worker health server + scheduling boundary
  web/       React/Vite auth, project catalog, members, teams, audit views
packages/
  contracts/ shared error/health/identity/project/catalog schemas
  config/    env validation, logging, redaction, secret/storage interfaces
  database/  Drizzle client, migration runner, identity/project/catalog schema
database/    checked-in migrations and seeds
runner-go/   Go runner foundation: version, config, destination policy
spikes/      MCP, OpenAPI, WSL2 networking, durable-job proofs
infra/       Dockerfiles, staging compose/TLS proxy, observability starters
docs/        ADRs, policies, architecture, runbooks, phase evidence
```

### Runtime endpoints

- API: `GET /health/live`, `GET /health/ready`, `GET /version`, `GET /metrics`
- Auth: `/api/v1/auth/login|session|logout|switch-organization|change-password`
- Organizations: `/api/v1/organizations/...` (members, teams, audit, projects)
- Projects: `/api/v1/projects/...` (members, mocked repository, archive)
- Catalog: specifications/import, operations, collections, requests/versions
- Worker: same health/metrics surface on port 8081
- Web: authenticated workspace at `http://127.0.0.1:5173`

`/metrics` requires `Authorization: Bearer $METRICS_TOKEN` when configured; the
staging ingress blocks external `/metrics`.

## Key decisions

- Native Hitman accounts use password + Argon2id with secure server-side
  sessions and CSRF protection. Break-glass login is disabled. SAML federation
  is later; Hitman's OAuth 2.1 authorization-server endpoints ship with the MCP
  endpoint in Phase 9.
- Project access is explicit membership only; organization admins manage all
  projects. Owner teams are metadata, not an access grant.
- GitLab repository registration is mocked in Phase 5; live API/OAuth/webhooks
  arrive in Phase 15.
- OpenAPI 3.0/3.1 imports are validated with Redocly; 3.2 is rejected. Request
  versions are immutable and manual request creation starts as a draft.
- MCP uses the official TypeScript SDK v2 over Streamable HTTP; business/job
  state is always in PostgreSQL, never in MCP sessions.
- Requests are created before commit; creation never implies execution, merge,
  or deployment.
- Runners use Ed25519 device identities and short-lived tokens, connect outbound
  only, and execute approved HTTP only—no shell.
- Jobs are durable PostgreSQL records with leases; lost responses become
  `outcome_unknown`, never blind retries.
- OpenAPI 3.0.x/3.1.x are supported; 3.2.x is experimental.
- Windows/WSL2 are independent devices.

See [`docs/adr/`](docs/adr/) for rationale.

## Commands

| Command                                           | Purpose                                                |
| ------------------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                        | Build packages, start API + worker                     |
| `pnpm dev:web`                                    | Vite web dev server                                    |
| `pnpm build`                                      | TypeScript build + production web bundle               |
| `pnpm lint` / `pnpm format`                       | Biome check / safe fixes                               |
| `pnpm typecheck`                                  | TypeScript project build/typecheck                     |
| `pnpm test`                                       | Vitest (includes database integration when configured) |
| `pnpm test:go` / `pnpm vet:go`                    | Go tests/vet                                           |
| `pnpm db:dev start\|stop\|status\|reset`          | Local PostgreSQL cluster                               |
| `pnpm db:generate` / `db:migrate` / `db:check`    | Migrations                                             |
| `pnpm admin ...`                                  | Bootstrap/provision users, teams, password resets      |
| `pnpm spike:mcp` / `spike:openapi` / `spike:jobs` | Phase 2 spikes                                         |
| `pnpm verify`                                     | All local gates                                        |

## Environment and security notes

- Node 24.22.0, pnpm 12.14.0, Go 1.27.3, PostgreSQL 16.15.
- The local PostgreSQL cluster on **5433** uses trust auth bound to loopback and
  is development-only.
- `.env` is ignored. Never commit secrets. Use `env://` references locally and a
  secret manager for shared environments.
- Redaction is defensive, not a substitute for not logging bodies/secrets.
- Staging manifests are present but **not deployed** here: this environment has
  no Docker CLI or staging host.
- The repository has a local `main` branch and no remote by choice; the GitLab CI
  definition has not been executed on a remote runner.

## Next phase

Phase 7 — request editor and core API Hub UX. Execution and live GitLab remain
later phases.

# Developer quick start

## Prerequisites

- Node.js **24.22.0** (`.nvmrc`) with pnpm **12.14.0** (`corepack enable`).
- Go **1.27.3** for runner work (`bash scripts/install-go.sh`).
- PostgreSQL **16** server binaries (`initdb`, `pg_ctl`). No Docker required.
- Linux/WSL2 or another Unix-like development host for the current baseline.

## 1. Install dependencies

```bash
pnpm install
bash scripts/install-go.sh   # installs Go under ~/.local/go, no sudo
```

## 2. Start the development database

```bash
pnpm db:dev start
```

This initializes `.dev/postgres` and `.dev/postgres-socket`, listens on
`127.0.0.1:5433`, and creates `hitman_dev` and `hitman_test`. It uses trust
authentication for the local OS user and is **development only**.

Copy `.env.example` to `.env` if it does not exist (this working copy already has
a local `.env`).

## 3. Apply migrations

```bash
pnpm db:migrate
```

Migrations are checked-in SQL under `database/migrations/`; see
`database/migrations/README.md`.

## 4. Bootstrap the first organization and administrator

```bash
HITMAN_BOOTSTRAP_PASSWORD='choose-a-long-password' pnpm admin bootstrap \
  --org-name "Acme" --org-slug acme \
  --email admin@example.com --display-name "Admin"
```

Passwords are read from environment variables and are never printed. The CLI
also supports `add-member`, `reset-password`, `create-team`, and
`add-team-member`; see `docs/phase-4-identity.md`.

## 5. Run API and worker

```bash
pnpm dev
```

- API: http://127.0.0.1:8080
- API liveness: `/health/live`
- API readiness: `/health/ready`
- Auth: `/api/v1/auth/...`
- Worker health: http://127.0.0.1:8081/health/ready
- Metrics require `Authorization: Bearer $METRICS_TOKEN` in shared environments;
  local `.env` sets a development token.

## 6. Run the web UI

In a second terminal:

```bash
pnpm dev:web
```

Open http://127.0.0.1:5173 and sign in. Vite proxies `/health`, `/version`, and
`/api` to the API. The Phase 4 shell provides login/logout, organization
switching, member/team administration, audit viewing, and password change.
Projects and the request editor arrive in Phases 5–7.

## 7. Run checks

```bash
pnpm verify          # Biome, typecheck, ts/vitest, Go tests, production build
pnpm test            # Vitest including spikes
pnpm test:go         # Go tests
pnpm lint            # Biome check
pnpm typecheck
```

`pnpm verify` starts the local database if it is not running and stops it
afterwards if it started it. Integration tests use `TEST_DATABASE_URL`; they skip
if it is unset when running `pnpm test` directly.

## 8. MCP and spikes

```bash
SPIKE_MCP_TOKEN=... pnpm spike:mcp       # disposable MCP server :8787
pnpm spike:openapi                        # parser compatibility test
pnpm spike:jobs                           # durable job invariants (needs test DB)
```

See `spikes/02-mcp-compatibility/README.md` for OpenCode/Claude Code configs.

## Troubleshooting

| Symptom                                   | Check                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Invalid server configuration`            | Required env vars are missing; error lists variable names only.                                                       |
| Readiness 503                             | `pnpm db:dev status`; PostgreSQL on 127.0.0.1:5433.                                                                   |
| Migration fails                           | Ensure `DATABASE_URL` is set and the database exists.                                                                 |
| Port in use                               | 8080 API, 8081 worker, 5173 web, 8787 MCP spike, 5433 database.                                                       |
| `psql: role "..." does not exist`         | Use the cluster script (`pnpm db:dev psql`) rather than the system cluster.                                           |
| Login returns `Invalid email or password` | Confirm the account exists and is active; reset with `HITMAN_NEW_PASSWORD=... pnpm admin reset-password --email ...`. |
| Login returns `No organization access`    | The user is valid but has no organization membership; add one with the admin CLI.                                     |
| Login returns `RATE_LIMITED`              | Wait for the configured window; default is 10 attempts per 60 seconds per IP.                                         |
| Go not found                              | Run `bash scripts/install-go.sh` or use `bash scripts/run-go.sh`.                                                     |

## Development database reset

```bash
HITMAN_RESET_CONFIRM=1 pnpm db:dev reset
pnpm db:dev start
pnpm db:migrate
```

This deletes **only** `.dev/postgres`.

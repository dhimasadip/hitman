# Implementation status — Phases 0–4

**Date:** 2026-10-27
**Map:** `implementation-plan.md` Phases 0–4.
**Important:** This is an engineering status record, not a rewrite of the plan.
Later phases are intentionally not started.

## Phase 0 — Product decisions and acceptance baseline: complete

- [x] P0-01 scope/non-goals confirmed
- [x] P0-02 supported MCP clients documented (Claude invocation pending model fix)
- [x] P0-03 identity path decided (Hitman-native, OAuth AS, SAML later)
- [x] P0-04 roles defined
- [x] P0-05 GitLab auth modes decided
- [x] P0-06 OpenAPI parser/versions decided after spike
- [x] P0-07 secret storage path decided
- [x] P0-08 runner policy decided
- [x] P0-09 `DEV ONLY` semantics decided
- [x] P0-10 limits/approvals decided
- [x] P0-11 pilot scale decided
- [x] P0-12 acceptance matrix created
- ADRs 0001–0008, execution policy, compatibility matrix, sign-off record.

## Phase 1 — Repository and engineering foundations: complete

- [x] Git repository on `main`, no remote (user choice)
- [x] TypeScript strict, Biome, import organization
- [x] Pinned Node/pnpm/Go/PostgreSQL and tool versions
- [x] Startup env validation; fail fast without values
- [x] Vitest setup, Postgres integration test, Go tests
- [x] GitLab CI: format/lint/typecheck/tests/migrations/build/security scans
- [x] Shared error envelope + correlation IDs
- [x] Structured logging + redaction helper
- [x] Config templates only; `.env` ignored
- [x] README/developer guide, migration policy
- [x] Server/worker/runner version metadata

**Caveat:** “one green CI pipeline on a remote” cannot be run because no remote
was created by choice. `pnpm verify` is the local equivalent; CI config is ready.
Default-branch protection must be enabled when the repository is pushed to
GitLab.

## Phase 2 — Technical validation spikes: complete with documented limits

- [x] Spike A MCP SDK v2 / Streamable HTTP / SDK client / OpenCode
- [~] Claude Code connected; model invocation blocked by external model provider
- [x] Spike B OpenAPI 3.0/3.1/3.2 fixture matrix + large document
- [x] Spike C WSL2 loopback HTTP + WSS + reconnection
- [~] Windows-host / VPN / sleep validation documented, not executable here
- [x] Spike D PostgreSQL claim/lease/outcome-unknown/stale-result semantics
- Evidence: `docs/phase-2-spike-results.md`, `spikes/*/results/`.

## Phase 3 — Runtime and infrastructure baseline: local complete; staging manifests only

- [x] Local dependency orchestration (PostgreSQL script, no Docker needed)
- [x] Dev/test databases; TLS/network/backup guidance
- [x] Separate server/worker entrypoints
- [x] TLS/ingress, health, request-size configuration in manifests
- [x] Secret provider interface + env local provider
- [x] Logs, request metrics, health endpoints, error handling
- [x] Object storage interface; provisioning deferred
- [x] Network/secret boundaries documented
- [x] Staged deployment manifests + rollback runbook
- [x] Migration job ordering
- [~] Reproducible staging deployment not executed (no staging/Docker available)

## Phase 4 — Identity, organizations, teams, and authorization: complete

- [x] Native password authentication with Argon2id (user decision)
- [x] Secure opaque sessions, cookie attributes, CSRF binding
- [x] Login rate limiting and generic authentication errors
- [x] Organizations, users, organization memberships, teams, team memberships
- [x] Centralized authorization service and cross-organization 404 behavior
- [x] Last-organization-administrator protection
- [x] Audit events for login failures, sessions, organization/team changes
- [x] Administrator CLI for bootstrap, user provisioning, password reset, teams
- [x] Login/logout, authenticated app shell, organization switcher, user menu
- [x] Member management and team management UI
- [x] Audit viewer, password change, loading/empty/error/forbidden states
- [x] PostgreSQL-backed auth integration tests (login, CSRF, RBAC, sessions,
  expiry, disabled users, password rotation, team lifecycle, rate limit)
- [~] MCP OAuth authorization-server/resource-server endpoints sequenced with
  Phase 9 (no MCP production route exists yet); architecture unchanged
- [x] Break-glass login deliberately disabled; recovery is an audited admin CLI
  password reset
- Evidence: `docs/phase-4-identity.md`, `apps/server/tests/auth.integration.test.ts`.

## Explicitly not started

Project CRUD, request collections/editor, production MCP endpoint/tools, Go
runner enrollment/protocol/execution, GitLab webhooks, deployment evidence,
hardening, pilot. OAuth AS/MCP token endpoints remain Phase 9 work.

## Next gate

Phase 5 — project creation, project memberships, and optional GitLab repository
registration. Projects must remain creatable without a repository, specification,
or runner.

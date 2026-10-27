# Phase 0 sign-off record

**Date:** 2026-10-27
**Status:** Approved for Phases 1–3. Production decisions are recorded; any
change to execution authority or identity boundaries needs a new ADR.
**Reference:** `Hitman-PRD.md` (§22 open decisions) and
`implementation-plan.md` (Phase 0).

| ID    | Decision / task              | Resolution                                                                                                                                                                  | Evidence                       |
| ----- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| P0-01 | MVP scope and non-goals      | Confirmed. Phases 0–3 build foundations only; no request execution or GitLab writes yet.                                                                                    | PRD §3.2, implementation plan  |
| P0-02 | Supported MCP clients        | OpenCode 2.1.4 and Claude Code 2.1.278; official SDK client for CI.                                                                                                         | `docs/compatibility-matrix.md` |
| P0-03 | Identity provider            | Hitman-native auth now; Hitman acts as OAuth 2.1 AS; SAML federation later.                                                                                                 | ADR 0001                       |
| P0-04 | Roles and allowed actions    | Org roles `org_admin/member/read_only`; project roles `project_admin/editor/executor/viewer`.                                                                               | ADR 0001, execution policy     |
| P0-05 | GitLab auth                  | Both scoped access-token reference and OAuth app, configurable per connection.                                                                                              | ADR 0007                       |
| P0-06 | OpenAPI support              | 3.0.x/3.1.x supported with Redocly; 3.2.x experimental.                                                                                                                     | ADR 0006, spike results        |
| P0-07 | Secret storage               | `SecretProvider` interface; local `env://`; production must use secret manager.                                                                                             | ADR 0008                       |
| P0-08 | Runner policy                | No shell, no inbound listener, explicit enrollment, per-device revocation, allowlisted HTTP.                                                                                | ADR 0003/0004                  |
| P0-09 | `DEV ONLY`                   | Enforced `execution_scope=development_only`; denies staging/production.                                                                                                     | Execution policy               |
| P0-10 | Limits and approvals         | 30s timeout, 15m job expiry, 1MiB inline response, 10MiB request, 10m enrollment, 7d idempotency, 30d bodies, 1y audit; staging/production human approval; AI denied there. | Execution policy               |
| P0-11 | Expected scale               | Pilot: 25 users, 10 projects, 20 devices, 10k executions/day, 5MiB average.                                                                                                 | Execution policy               |
| P0-12 | Requirements-to-tests matrix | 17 PRD acceptance criteria mapped to phases, tests, owners.                                                                                                                 | `docs/acceptance-checklist.md` |

## Deliberately deferred, non-architectural details

- Native login factor resolved in Phase 4: password + Argon2id. No break-glass
  login; recovery is an audited administrator CLI reset.
- Final object-storage provider and bucket policy — Phase 14.
- Final runner signing key custody and artifact host — Phase 12.
- Named platform/security/pilot owners — before production rollout, not needed
  to freeze component boundaries.
- Windows and VPN/proxy/sleep validation — Phase 2/11 test gates, documented as
  pending rather than assumed.

## Exit criteria check

- [x] PRD MVP scope and non-goals confirmed.
- [x] Identity, MCP transport, runner credentials, HTTP policy, queue semantics,
  OpenAPI support, GitLab authentication, and runtime topology recorded in ADRs.
- [x] Acceptance matrix and execution/retention limits recorded.
- [x] No unresolved decision changes the main component boundaries or security
  model.
- [x] Product/engineering baseline approved in the Phase 0 decision session.

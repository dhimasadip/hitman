# Requirements-to-tests acceptance matrix

**Source:** PRD §21 first-production-release acceptance criteria.
**Owner convention:** The repository maintainer acts as product/engineering owner
during Phase 0–3. Platform, security, and pilot owners are assigned before
production release; no criterion is waived because an owner is unnamed.

| #   | Acceptance criterion                                                         | Phase     | Verification / test                                            | Accountable role  |
| --- | ---------------------------------------------------------------------------- | --------- | -------------------------------------------------------------- | ----------------- |
| 1   | Create a project without repository, spec, or runner                         | 5         | E2E Workflow A; API/UI test                                    | Product owner     |
| 2   | Connect GitLab and import an OpenAPI document                                | 5–6, 15   | E2E Workflow B; fixtures + mocked GitLab; live spike later     | Integration owner |
| 3   | Windows and WSL2 local targets with separate URLs/identities                 | 8, 11–12  | Device matrix; target policy tests; Windows validation pending | Platform owner    |
| 4   | MCP finds project, creates request from uncommitted code, omits commit/MR    | 9–10      | E2E Workflow C; idempotency and initial-state assertions       | MCP owner         |
| 5   | Request versioned, reviewable/editable in UI                                 | 6–7       | Immutable version tests; editor round-trip tests               | Web owner         |
| 6   | Execute against selected local target through runner                         | 13–14     | E2E Workflow D; Windows + WSL2                                 | Runner owner      |
| 7   | Runner remains usable after AI client closes                                 | 11–14     | Client-close scenario; independent service lifecycle           | Runner owner      |
| 8   | Job state/results survive API/worker restarts; missed WSS does not lose jobs | 13        | Durable-job spike + restart integration tests                  | Backend owner     |
| 9   | Ambiguous outcomes handled safely                                            | 13–14     | `outcome_unknown` tests; no blind POST retry                   | Backend owner     |
| 10  | Runner revocable independently of MCP access                                 | 11        | Revocation tests; per-device credentials                       | Security owner    |
| 11  | Block unauthorized targets, redirects, cross-project actions                 | 4–8, 17   | Policy unit tests + authz integration + penetration test       | Security owner    |
| 12  | Secrets absent from MCP output, logs, history                                | 4–17      | Redaction regression tests; log scan; secret-reference tests   | Security owner    |
| 13  | GitLab push/MR/merge state reconciled idempotently                           | 15        | Duplicate/out-of-order webhook tests; reconciliation recovery  | Integration owner |
| 14  | Merge never implies deployment                                               | 15–16     | Deployment state tests; merge-without-evidence scenario        | Product owner     |
| 15  | Deployment tied to environment and evidence source                           | 16        | Per-environment evidence tests                                 | Integration owner |
| 16  | Windows/WSL2 compatibility documented and tested                             | 11–12, 18 | Compatibility matrix; clean-install matrix                     | Platform owner    |
| 17  | Backup/restore, rollback, monitoring documented                              | 3, 17–18  | Runbooks + drills; Phase 3 docs are initial versions           | Platform owner    |

## Phase 0 evidence

- Decisions: `docs/phase-0-signoff.md`, `docs/adr/`.
- Execution policy: `docs/policies/execution-policy.md`.
- Compatibility: `docs/compatibility-matrix.md`.
- Phase 1 foundation: green local `pnpm verify`; GitLab CI definition.
- Phase 2 evidence: `docs/phase-2-spike-results.md`.
- Phase 3 runtime: `docs/phase-3-runtime.md`.
- Phase 4 identity: `docs/phase-4-identity.md` (13 PostgreSQL-backed auth/RBAC
  tests, including cross-organization denial, CSRF, last-admin protection,
  expiry, disabled accounts, password rotation, and rate limiting).

## Gates

- **Gate A (API Hub foundation):** criteria 1, 2, 5, 11, 12.
- **Gate B (MCP write):** criteria 4, 8, 10, 12; re-test OAuth client matrix.
- **Gate C (local execution):** criteria 3, 6, 7, 9, 10, 11, 12.
- **Gate D (GitLab/deployment):** criteria 2, 13, 14, 15.
- **Gate E (production):** all criteria + security review + backup drill +
  runner signing/rollback + pilot acceptance.

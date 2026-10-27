# Hitman — Implementation Plan

**Document status:** Proposed execution plan derived from `Hitman-PRD-updated.md`  
**Product:** Hitman — Internal API Hub  
**Last reviewed:** 2026-10-27  
**Audience:** Product, frontend, backend, platform, security, QA, and developer-experience teams  
**Purpose:** Break the PRD into a phased, testable implementation sequence from an empty repository to a production-ready service.

> **Source of truth:** The PRD defines product behavior and requirements. This file defines the recommended delivery order, engineering tasks, dependencies, test gates, and completion criteria. When implementation discovers an ambiguity, record the decision and update the PRD before building incompatible behavior.

---

## 1. Delivery principles

1. Build a modular monolith for the hosted application. Do not introduce microservices just to separate REST, MCP, and workers logically.
2. Keep React web, Fastify application, worker entrypoint, and Go runner as separate deployable/runtime concerns. The web and backend may be in one monorepo.
3. REST handlers and MCP tools must call the same application services. Authorization and lifecycle logic must not be reimplemented separately in MCP.
4. PostgreSQL is the source of truth for business records, execution jobs, and request history. WebSocket messages notify a runner that work may be available; they are not the job queue.
5. Windows and WSL2 installations are separate devices with independent credentials, service lifecycles, and target mappings.
6. A request created by an AI agent is not evidence that it has been executed, merged, deployed, or verified.
7. Keep API request versions immutable. An edit creates a new version; later GitLab activity updates source-link/reconciliation state, not old version contents.
8. Never blindly retry a potentially non-idempotent HTTP request if its result is uncertain.
9. Treat the local runner as a security boundary. The MVP supports approved HTTP execution only, not arbitrary shell commands or code execution.
10. Ship usable vertical slices. Each phase should end with a demonstrable workflow and automated tests.
11. Prefer one simple implementation until measurement or a concrete operational need justifies additional infrastructure.
12. Do not expose secrets or full sensitive payloads in logs, MCP results, audit metadata, or routine telemetry.

## 2. Product and technical decisions assumed by this plan

| Area                  | Decision                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend              | React, TypeScript, Vite, TanStack Query, Tailwind CSS, shadcn/ui or equivalent, CodeMirror 6                                         |
| Backend               | Node.js LTS, TypeScript, Fastify                                                                                                     |
| MCP                   | Official MCP TypeScript SDK v2; remote Streamable HTTP for supported clients; optional stdio adapter only when required              |
| Database              | PostgreSQL + Drizzle ORM and checked-in SQL migrations                                                                               |
| Runner                | Go; one codebase compiled for Windows and Linux/WSL2, separately installed per environment                                           |
| Runner communications | Authenticated outbound WSS connection plus authenticated HTTPS claim/heartbeat/result API                                            |
| Durable queue         | PostgreSQL-backed jobs first; Redis/BullMQ deferred until justified by measured load or scheduling needs                             |
| API contract          | OpenAPI, with parser support limited to tested versions; preserve raw specification versions                                         |
| Source integration    | GitLab API, webhooks, and periodic authoritative reconciliation                                                                      |
| Deployment            | Containerized backend/API and worker; managed PostgreSQL preferred; object storage and secret manager according to company standards |
| Architecture          | Modular monolith with independent API and worker entrypoints; no mandatory microservices or desktop shell in the first release       |

## 3. Phase map and dependency overview

| Phase | Name                                                        | Primary outcome                                                           | Depends on                                  |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| 0     | Product decisions and acceptance baseline                   | Decisions, scope, and success criteria are agreed                         | None                                        |
| 1     | Repository and engineering foundations                      | Build, lint, test, migration, and CI foundations work                     | 0                                           |
| 2     | Technical validation spikes                                 | Highest-risk SDK, OpenAPI, WSL2, and job semantics proven                 | 0–1                                         |
| 3     | Runtime and infrastructure baseline                         | Development/staging runtime, PostgreSQL, secrets, and observability exist | 1–2                                         |
| 4     | Identity, organization, teams, and authorization            | Users can sign in and access checks are enforced                          | 3                                           |
| 5     | Projects and GitLab repository registration                 | Project workspace can be created without required integrations            | 4                                           |
| 6     | API catalog, OpenAPI, collections, requests, and versioning | Core request model and persistence are usable                             | 5                                           |
| 7     | Request editor and catalog UI                               | Developers can manage requests without MCP                                | 6                                           |
| 8     | Environments, targets, and secret references                | Requests can resolve allowed environment configuration safely             | 5–7                                         |
| 9     | MCP read/search surface                                     | AI clients can discover projects and existing requests                    | 4–8                                         |
| 10    | MCP request creation/update lifecycle                       | AI clients can create requests with correct records/statuses/idempotency  | 6, 8–9                                      |
| 11    | Go runner protocol and device enrollment                    | Runner identity, authenticated connection, and device lifecycle work      | 3–4, protocol spike from 2                  |
| 12    | Windows and WSL2 runner packaging                           | Supported installers/startup flows are reproducible                       | 11                                          |
| 13    | Durable execution jobs and backend orchestration            | Jobs can be safely queued, claimed, leased, and tracked                   | 8, 10–12                                    |
| 14    | Runner HTTP execution and result experience                 | Saved requests execute locally and results are inspectable                | 13                                          |
| 15    | GitLab source provenance and reconciliation                 | Source/merge state updates from authoritative GitLab facts                | 5–6, 10                                     |
| 16    | Deployment evidence and status reconciliation               | Deployment is tracked separately from merge and execution                 | 15 and deployment evidence source available |
| 17    | Security, reliability, and performance hardening            | Required threat controls and recovery tests pass                          | 4–16; hardening begins earlier throughout   |
| 18    | Pilot, migration, production release, and operations        | Supportable rollout and operational runbooks exist                        | 0–17                                        |

Several phases can be performed in parallel after interfaces are agreed. Do not parallelize teams against an unstable database schema or runner protocol without first agreeing the relevant contracts.

---

# Phase 0 — Product decisions and acceptance baseline

**Goal:** Close the implementation decisions that could cause architectural rework.  
**Primary owner:** Product/tech lead, with backend, platform, and security input.

## Tasks

- [ ] P0-01: Confirm MVP scope and non-goals from the PRD.
- [ ] P0-02: Define the first supported MCP clients and versions (for example OpenCode and Claude Code). Make client support a tested matrix, not an assumption.
- [ ] P0-03: Confirm company identity provider and OIDC/SSO integration path.
- [ ] P0-04: Define organization, team, project, and environment roles and their allowed actions.
- [ ] P0-05: Decide GitLab integration authentication model: approved OAuth/application integration or least-privilege scoped token reference.
- [ ] P0-06: Agree the supported OpenAPI parser/validator versions. Use a tested compatibility matrix; do not promise support solely because a spec version is published.
- [ ] P0-07: Decide where secret values live (company secret manager preferred; encrypted store only if the company has no suitable service).
- [ ] P0-08: Define local runner policy: no shell execution, no inbound listener, explicit enrollment, per-device revocation, and approved target rules.
- [ ] P0-09: Define the meaning of `DEV ONLY` as an enforced execution-scope policy, not just a UI badge.
- [ ] P0-10: Define job expiry, maximum request duration, response limits, retention periods, and which HTTP methods/environments require approval.
- [ ] P0-11: Define expected scale: projects, active users, registered devices, peak connected devices, daily requests, maximum payload sizes, and request-history retention.
- [ ] P0-12: Create a requirements-to-tests matrix using the PRD acceptance criteria.

## Deliverables

- Architecture decision records (ADRs) for identity, MCP transport, runner credential model, HTTP target policy, queue semantics, and OpenAPI support.
- Product acceptance checklist with named owners.
- Supported client and operating-system matrix.
- Initial data-retention and execution-policy decisions.

## Exit criteria

- [ ] No unresolved decision remains that could change the main component boundaries or security model.
- [ ] Product owner and engineering lead approve the MVP acceptance baseline.

---

# Phase 1 — Repository and engineering foundations

**Goal:** Create a reproducible development environment and CI gates before feature development.

## Suggested repository layout

```text
hitman/
  apps/
    web/                 # React + TypeScript + Vite
    server/              # Fastify REST API + hosted MCP endpoint
    worker/              # job scheduling, webhook processing, reconciliation
  packages/
    contracts/           # runtime schemas and public protocol contracts
    api-client/          # typed client generated or derived from API schemas
    config/              # shared TypeScript/lint/test configuration
  runner-go/
    cmd/hitman-runner/    # Go application entrypoint
    internal/            # enrollment, connection, jobs, execution, policy
    protocol/            # versioned protocol types
  infra/
    local/               # local development dependencies
    deployment/          # container/deployment definitions
    observability/        # dashboard and alert definitions
  docs/
    adr/
    runbooks/
    developer-guide/
  .github/ or company-CI configuration
```

The exact package manager and workspace tooling can be selected by the team. Keep the Go runner independently buildable even when it lives in the same repository.

## Tasks

- [ ] P1-01: Create the repository and protect the default branch.
- [ ] P1-02: Configure TypeScript strict mode, formatting, linting, and import conventions.
- [ ] P1-03: Pin Node.js LTS, Go, PostgreSQL local image, package manager, and tool versions in documented files.
- [ ] P1-04: Add environment-variable validation at process startup; fail fast when required configuration is missing.
- [ ] P1-05: Add unit-test runners for TypeScript and Go.
- [ ] P1-06: Add an integration-test strategy using a disposable PostgreSQL instance.
- [ ] P1-07: Add CI jobs for formatting, lint, typecheck, unit tests, Go tests, migration validation, build, and dependency/security scanning.
- [ ] P1-08: Add shared error format and request correlation ID middleware.
- [ ] P1-09: Add structured logging rules and a safe logging helper that redacts configured sensitive fields.
- [ ] P1-10: Add configuration templates with placeholders only; never commit real secrets.
- [ ] P1-11: Add initial architecture and local development README.
- [ ] P1-12: Define migration naming and rollback/forward-fix policy.

## Tests and quality gates

- [ ] A new developer can clone the repository and run the documented checks.
- [ ] CI fails on lint/type/test/migration errors.
- [ ] Server, worker, and runner can print version/build metadata.
- [ ] Secrets are not printed by config validation failures.

## Exit criteria

- [ ] One green CI pipeline runs for a clean checkout.
- [ ] Application and Go runner build independently.

---

# Phase 2 — Technical validation spikes

**Goal:** Prove the high-risk technical decisions with small disposable prototypes. Do not develop production features in these spikes.

## Spike A — MCP client and transport compatibility

- [ ] P2-01: Create a minimal remote MCP server using the selected official TypeScript SDK v2 packages and Streamable HTTP transport.
- [ ] P2-02: Connect each supported MCP client using the actual company authentication model.
- [ ] P2-03: Verify tool listing, tool invocation, request timeout behavior, server errors, and reconnection behavior.
- [ ] P2-04: Test whether clients can reliably authenticate through company SSO/OAuth, including token expiration and refresh behavior.
- [ ] P2-05: Identify any client that requires a local stdio adapter and document its scope; do not make the adapter the primary architecture by default.

## Spike B — OpenAPI compatibility

- [ ] P2-06: Test import and validation for supported OpenAPI 3.0.x and 3.1.x documents.
- [ ] P2-07: Run a focused compatibility spike for OpenAPI 3.2.x before enabling it in the UI.
- [ ] P2-08: Test large specs, `$ref` resolution policy, invalid documents, and parser timeouts/memory limits.
- [ ] P2-09: Record parser/validator limitations and define behavior for invalid or unsupported specs.

## Spike C — Windows and WSL2 networking

- [ ] P2-10: Create sample App B endpoints on Windows localhost and inside WSL2.
- [ ] P2-11: Prove that the Windows runner can reach only the intended Windows target and the WSL2 runner can reach the intended WSL2 target.
- [ ] P2-12: Test WSL2 networking configurations used by the team, including localhost forwarding assumptions; document what is and is not supported.
- [ ] P2-13: Test sleep/resume, Wi-Fi changes, VPN changes, proxy settings, and firewall behavior for outbound WSS.

## Spike D — Durable jobs and uncertain HTTP outcomes

- [ ] P2-14: Prototype PostgreSQL job claiming with row locking or an equivalent safe claim strategy.
- [ ] P2-15: Prototype leases, lease expiration, claim ownership, retry limits, and stale result rejection.
- [ ] P2-16: Simulate a POST that succeeds on the target but whose response is dropped before the runner reports success. Verify the outcome becomes `outcome_unknown`, not an unsafe automatic retry.
- [ ] P2-17: Confirm whether notifications can be lost without losing the durable job.

## Deliverables

- Spike code or reproducible test harnesses.
- ADRs with results and chosen implementation.
- Compatibility test matrix and known limitations.

## Exit criteria

- [ ] All high-risk assumptions have demonstrated proof or a documented mitigation.
- [ ] No feature phase depends on an untested MCP transport, OpenAPI parser, or runner network assumption.

---

# Phase 3 — Runtime and infrastructure baseline

**Goal:** Have development and staging environments where the application can run predictably.

## Tasks

- [ ] P3-01: Choose local development dependency orchestration (for example, containers for PostgreSQL and optional object storage).
- [ ] P3-02: Provision a development PostgreSQL database and a staging database using the organization's standard infrastructure.
- [ ] P3-03: Configure database TLS, restricted network access, credentials, backups, and migration permissions.
- [ ] P3-04: Create separate deployment entrypoints for `server` and `worker` from the same codebase.
- [ ] P3-05: Configure TLS termination, HTTPS routing, health checks, and request-size limits.
- [ ] P3-06: Configure secret injection from the chosen secret manager; do not bake secrets into images.
- [ ] P3-07: Set up structured application logs, basic request metrics, health endpoints, and error tracking.
- [ ] P3-08: Configure a controlled file/object storage bucket if large/binary body support is in MVP; otherwise define the interface and defer provisioning.
- [ ] P3-09: Define network rules between API, worker, PostgreSQL, GitLab, and secret manager.
- [ ] P3-10: Create staged deployment pipeline and safe rollback procedure.
- [ ] P3-11: Define database migration job ordering so multiple application instances don't race migrations.

## Minimum runtime endpoints

- `/health/live`: process is alive.
- `/health/ready`: critical dependencies are usable for the instance's role.
- `/metrics` or approved metrics exporter: restricted to the monitoring network.

## Tests

- [ ] A deployment can be created from a clean pipeline.
- [ ] Service becomes unhealthy if required dependencies are unavailable where appropriate.
- [ ] Database credentials cannot be retrieved from public endpoints or logs.
- [ ] Staging can be restored/rebuilt using documented configuration and migrations.

## Exit criteria

- [ ] Development and staging deployments are reproducible.
- [ ] Operators can see logs, basic health, and errors without exposing secrets.

---

# Phase 4 — Identity, organizations, teams, memberships, and authorization

**Goal:** Establish safe identity and authorization before API/request or runner functionality is exposed.

## Database scope

Implement and migrate the PRD entities:

- `organizations`
- `users`
- `organization_memberships`
- `teams`
- `team_memberships`
- initial project membership model may be introduced with Phase 5
- `audit_events` baseline

Use foreign keys, unique constraints, timestamps, and appropriate indexes as specified in the PRD. Never use a client-provided organization ID as proof of membership.

## Backend tasks

- [ ] P4-01: Integrate the chosen OIDC/SSO identity provider.
- [ ] P4-02: Map the authenticated principal to a Hitman user and organization membership.
- [ ] P4-03: Implement session/token validation and secure cookie/header behavior for web and MCP clients.
- [ ] P4-04: Define authorization service interfaces (`canReadProject`, `canEditRequest`, `canExecute`, `canManageDevices`, etc.) and test them centrally.
- [ ] P4-05: Implement organization/team membership APIs and minimal admin workflows.
- [ ] P4-06: Add audit helpers for privileged writes and authorization-sensitive outcomes.
- [ ] P4-07: Ensure resource lookup does not reveal whether another organization's records exist.
- [ ] P4-08: Add correlation IDs across HTTP, service logs, and audit events.

## Frontend tasks

- [ ] P4-09: Implement login/logout and authenticated app shell.
- [ ] P4-10: Add basic organization/user menu and unauthorized/forbidden states.
- [ ] P4-11: Build minimal admin membership view if required for the pilot; otherwise provide a secure provisioning process documented for admins.

## Tests

- [ ] Organization A users cannot retrieve Organization B records by guessing IDs.
- [ ] User without project role cannot write requests or execute requests.
- [ ] Revoked/expired identity cannot call REST or MCP.
- [ ] Audit records contain actor/resource/action, not token values or secrets.

## Exit criteria

- [ ] All business operations are designed to call a centralized authorization service.
- [ ] Identity and organization access works in development and staging.

---

# Phase 5 — Project creation and repository registration

**Goal:** Let maintainers create a project before any repository, API spec, or runner is connected.

## Database scope

- `projects`
- `project_memberships`
- `gitlab_connections`
- `gitlab_repositories`
- project/team relations and repository uniqueness constraints

## Backend tasks

- [ ] P5-01: Implement project create/read/update/archive services and REST endpoints.
- [ ] P5-02: Validate project slug uniqueness within the required scope.
- [ ] P5-03: Implement project membership and role assignment.
- [ ] P5-04: Implement GitLab connection credential references without storing plaintext tokens in ordinary columns.
- [ ] P5-05: Support selecting a repository using stable GitLab external ID and storing URL/default branch metadata.
- [ ] P5-06: Fetch repository metadata under least privilege and record sync status/last-sync timestamps.
- [ ] P5-07: Support optional OpenAPI file path configuration without requiring a spec at project creation.
- [ ] P5-08: Record audit events for project/repository/membership changes.
- [ ] P5-09: Add idempotency or uniqueness behavior for repeated repository-link attempts.

## Frontend tasks

- [ ] P5-10: Build project list, search, empty state, create project form, and project overview.
- [ ] P5-11: Build project onboarding checklist: repository, OpenAPI, environments, MCP, and devices.
- [ ] P5-12: Build connect repository flow with accessible loading/success/error states.
- [ ] P5-13: Display repository identity, default branch, last successful sync, and actionable integration errors.

## Tests

- [ ] Project can be created with no repository, no OpenAPI spec, and no runner.
- [ ] Project access is limited to assigned users/teams.
- [ ] Same GitLab repository cannot be accidentally linked multiple times in conflicting ways unless explicit product policy allows it.
- [ ] GitLab outage does not prevent project creation; repository connection reports recoverable failure.

## Exit criteria

- [ ] A maintainer can create and manage a project and optionally link GitLab.

---

# Phase 6 — API specifications, catalog, collections, request definitions, and versioning

**Goal:** Build the canonical data layer for API operations and saved HTTP requests.

## Database scope

Implement:

- `api_specifications`
- `api_specification_versions`
- `api_operations`
- `collections`
- `collection_folders`
- `api_requests`
- `api_request_versions`
- `api_request_source_observations`
- `api_request_source_links`

Use the PRD schema as a baseline. Review constraints and indexes before finalizing migrations. Request versions are immutable snapshots; updates create a new version and move the current-version pointer on `api_requests`.

## Backend tasks

- [ ] P6-01: Define versioned runtime schemas for request methods, path, query parameters, ordered headers, auth references, body kinds, options, execution scope, and lifecycle.
- [ ] P6-02: Implement collection and folder CRUD, including project ownership validation.
- [ ] P6-03: Implement request create/read/update/archive services with mandatory authorization.
- [ ] P6-04: Implement immutable request-version creation, diff metadata, current-version pointer, and optimistic concurrency/version checks.
- [ ] P6-05: Preserve duplicate query/header keys and order where the request editor must replay them faithfully.
- [ ] P6-06: Support `none`, JSON, text/raw, URL-encoded, multipart metadata, and binary/object-storage body representations according to the agreed MVP scope.
- [ ] P6-07: Apply request/body/header size limits and reject malformed structures.
- [ ] P6-08: Implement API-spec import and parsing using the selected OpenAPI parser.
- [ ] P6-09: Preserve original OpenAPI document versions and the source commit SHA when applicable.
- [ ] P6-10: Parse operations into `api_operations` while retaining a link to the source specification/version.
- [ ] P6-11: Provide spec validation errors and warnings without discarding the original uploaded document.
- [ ] P6-12: Implement search/filter by project, collection, method, path, name, tags, and operation link.
- [ ] P6-13: Add indexes based on actual query patterns; validate query plans on representative data.
- [ ] P6-14: Implement deletion/archive rules so requests referenced by execution history or source evidence are not physically deleted casually.

## Frontend tasks

- [ ] P6-15: Build collection/folder navigation and API operations browser.
- [ ] P6-16: Build OpenAPI import flow: file selection, validation, preview, import summary, and errors.
- [ ] P6-17: Show operations separately from saved executable requests.
- [ ] P6-18: Show request version history and version metadata.
- [ ] P6-19: Implement search and filters with loading, empty, and error states.

## Tests

- [ ] Creating/updating a request creates a new immutable version as expected.
- [ ] Failed transactions do not leave an `api_requests` row without its required initial version.
- [ ] Duplicate headers/query parameters survive save-load-edit-replay.
- [ ] Invalid or unsupported OpenAPI documents yield actionable errors and do not corrupt previously imported specs.
- [ ] Unauthorized users cannot view request bodies or spec contents.

## Exit criteria

- [ ] Developers can create, organize, search, inspect, version, and archive requests in backend and UI.
- [ ] OpenAPI import works for the explicitly supported versions.

---

# Phase 7 — Request editor and core API Hub UX

**Goal:** Make Hitman useful as a Postman-like request workspace before adding local execution complexity.

## UI tasks

- [ ] P7-01: Implement method selector and URL/path editor.
- [ ] P7-02: Implement ordered query-parameter editor with enable/disable per row and duplicate-key support.
- [ ] P7-03: Implement ordered header editor with enable/disable per row and sensitive-field masking.
- [ ] P7-04: Implement auth configuration options supported by the MVP; store secret references, not reusable secret values in request snapshots.
- [ ] P7-05: Implement body-mode selector and editor for supported body kinds.
- [ ] P7-06: Use CodeMirror 6 for JSON/raw editing, syntax highlighting, indentation, and formatting controls.
- [ ] P7-07: Implement unsaved-change indicators and explicit save/update actions.
- [ ] P7-08: Implement request naming, description, tags, collection/folder assignment, and lifecycle editing.
- [ ] P7-09: Display source-provenance and execution-scope badges separately from request lifecycle.
- [ ] P7-10: Add response panel shell (real results are wired in Phase 14).
- [ ] P7-11: Build responsive loading/error/empty states and keyboard/accessibility behavior.

## Backend/API tasks

- [ ] P7-12: Add an API response contract for request detail, version history, and sanitized secret-reference metadata.
- [ ] P7-13: Ensure list responses don't return large bodies or secret material unless required and authorized.
- [ ] P7-14: Add request-level optimistic concurrency checks to avoid silently overwriting simultaneous edits.

## Tests

- [ ] Request round-trip preserves body type and ordered/duplicate headers/query values.
- [ ] Secret values never appear in fetched request details.
- [ ] UI warns about unsaved changes before navigation where appropriate.
- [ ] The editor works with keyboard-only navigation and large but permitted payloads.

## Exit criteria

- [ ] A developer can create and edit API requests using the web interface with predictable versioning.

---

# Phase 8 — Environments, device targets, and secret references

**Goal:** Separate a logical environment from the concrete endpoint a specific execution uses.

## Database scope

- `environments`
- `environment_targets`
- `environment_variables`
- secret references and optional object storage metadata

## Backend tasks

- [ ] P8-01: Implement logical environments such as `local`, `development`, `staging`, and `production`.
- [ ] P8-02: Add classification and execution policy to each environment.
- [ ] P8-03: Implement shared target URL configuration where allowed.
- [ ] P8-04: Implement per-device target mappings for local environments, separate for Windows and WSL2.
- [ ] P8-05: Validate URL syntax and policy on save, but also enforce destination policy again at execution time in the runner.
- [ ] P8-06: Define a variable resolution order and explicitly document allowed interpolation syntax.
- [ ] P8-07: Use secret references and access-controlled secret resolution; never return secret values in ordinary REST/MCP responses.
- [ ] P8-08: Ensure `development_only` execution scope cannot target staging/production, regardless of UI selection.
- [ ] P8-09: Implement approval policy fields for environments/methods that require human confirmation.

## Frontend tasks

- [ ] P8-10: Build environment list/detail/edit screens.
- [ ] P8-11: Build device-specific local target setup with connection/test diagnostics that do not leak credentials.
- [ ] P8-12: Show target classification, permitted runner devices, and policy restrictions.
- [ ] P8-13: Provide clear behavior when a request is missing a required variable or secret reference.

## Tests

- [ ] Windows and WSL2 can map the same logical `local` environment to different URLs.
- [ ] A `DEV ONLY` request cannot execute against a shared staging or production target.
- [ ] A user without secret permission cannot reveal secret values.
- [ ] Host/port/redirect policy is enforced at runtime, not only on configuration save.

## Exit criteria

- [ ] Requests can resolve logical environment values into a permitted target without embedding machine-specific URLs into shared request definitions.

---

# Phase 9 — MCP endpoint and read/search tools

**Goal:** Allow AI coding tools to discover authorized Hitman context before writing data.

## MCP implementation tasks

- [ ] P9-01: Implement the hosted MCP endpoint using the chosen official SDK v2 and supported Fastify adapter/transport.
- [ ] P9-02: Implement authentication for the target clients and validate the caller identity on every tool call.
- [ ] P9-03: Keep MCP tool handlers thin: parse/version-check inputs, call application services, and map outputs/errors.
- [ ] P9-04: Implement `list_projects` with access-limited results.
- [ ] P9-05: Implement `get_project_api_context` with bounded context and secret-free response fields.
- [ ] P9-06: Implement `search_api_requests` and operation search, with method/path normalization rules.
- [ ] P9-07: Implement `get_api_request` and `get_api_request_version` if they are needed by the chosen context workflow.
- [ ] P9-08: Add tool descriptions with required fields, side effects, permissions, and warnings.
- [ ] P9-09: Return concise results with stable IDs rather than dumping full catalog data by default.
- [ ] P9-10: Apply maximum result sizes, request timeouts, and pagination/limit controls.
- [ ] P9-11: Standardize safe MCP error mapping (validation, not found, forbidden, conflict, rate limit, internal error).
- [ ] P9-12: Add correlation IDs to MCP tool calls and server logs.

## Read/search MCP tests

- [ ] Each supported MCP client can connect using the documented setup.
- [ ] `list_projects` never includes unauthorized projects.
- [ ] Context responses exclude secret values and unrelated records.
- [ ] Large search results are bounded and deterministically paginated.
- [ ] A client with expired/revoked authorization cannot continue using tools.

## Exit criteria

- [ ] The AI agent can identify a project, understand relevant API context, and search for a matching request through MCP.

---

# Phase 10 — MCP request creation and update lifecycle

**Goal:** Implement the full AI-assisted workflow to create an API request from local code, including immutable versioning, source observations, idempotency, and exact initial statuses.

## Canonical workflow

1. Developer asks the coding agent to create a request and specifies the project/feature or asks the agent to infer the project from context.
2. The AI coding tool uses its own workspace capabilities to inspect routes, validation schemas, handlers, tests, and available API contracts. Hitman does not read the developer filesystem through the hosted MCP server, and the runner is not needed to create a request.
3. The agent calls `list_projects` or `get_project_api_context` to disambiguate the target project and examine existing requests/policies.
4. The agent calls `search_api_requests` for method/path/name candidates.
5. If an equivalent request exists, the agent reports it and asks whether to reuse/update it when intent is unclear. It should not create a duplicate just because a new prompt arrived.
6. The agent constructs a request from evidence and calls `create_api_request` with an idempotency key. Branch, commit SHA, and MR IID are optional.
7. Hitman validates input, authorizes the caller, validates collection/folder ownership, checks target scope and secret handling, and evaluates idempotency.
8. Hitman transactionally creates the request, immutable version 1, optional source observation, audit event, and idempotency response record.
9. Hitman returns request ID, version ID, initial statuses, warnings, and links where supported. It does not execute the request.
10. The AI tells the developer what was created and which details remain unverified. The developer may review or edit it in the UI or through MCP.

## Expected initial state

- `api_requests.request_lifecycle = 'draft'` by default for an AI-inferred request.
- `execution_scope = 'development_only'` when the developer requested `DEV ONLY`; this scope is enforced by execution policy.
- One immutable row exists in `api_request_versions` with version `1`.
- Zero execution jobs and zero execution results exist because creation does not execute.
- A source observation is created only if source hints were provided.
- `source_observation.verification_status = 'unverified'` for AI-reported local workspace state.
- No GitLab link is fabricated if repository/commit/MR correlation is not known.
- Authoritative source status remains unknown/unlinked until linked and reconciled with GitLab.
- Deployment state remains unknown; no deployment is implied.

## Backend/database tasks

- [ ] P10-01: Finalize versioned input schema for `create_api_request`.
- [ ] P10-02: Require project ID, name, method, and path for an executable request. Allow body to be absent when supported; if method/path cannot be established, require clarification instead of guessing.
- [ ] P10-03: Define canonical normalization for idempotency hashes; avoid hashing/logging secrets in a way that exposes them.
- [ ] P10-04: Implement authorization and project/collection/folder consistency validation.
- [ ] P10-05: Validate header/query array structure and preserve duplicate names/order.
- [ ] P10-06: Validate `execution_scope` against project policy and ensure `development_only` cannot be widened by an MCP caller without explicit authorized action.
- [ ] P10-07: Validate that the MCP caller cannot set authoritative GitLab or deployment states.
- [ ] P10-08: Use one PostgreSQL transaction to create `api_requests`, `api_request_versions`, optional `api_request_source_observations`, `audit_events`, and `idempotency_records`.
- [ ] P10-09: Add uniqueness constraints and handle concurrent duplicate creation without orphan rows.
- [ ] P10-10: Return the stored idempotent response for same key + same normalized payload; return conflict for same key + different payload.
- [ ] P10-11: Implement `update_api_request` so edits create a new immutable version and audit the change.
- [ ] P10-12: Implement a controlled way to add source provenance later without modifying prior immutable versions.
- [ ] P10-13: Ensure API request creation emits no execution job and does not claim test/merge/deployment success.
- [ ] P10-14: Support warnings for unresolved optional fields and an explicit draft state.

## Frontend tasks

- [ ] P10-15: Show `DRAFT`, `DEV ONLY`, and source-observation/verification state independently.
- [ ] P10-16: Show request creation actor, timestamp, version 1, and the source hints provided.
- [ ] P10-17: Provide review/edit actions and indicate the request has not been executed.

## Required end-to-end test

Given a project and an authenticated AI client, call `get_project_api_context`, `search_api_requests`, then `create_api_request` with `executionScope=development_only`, no commit SHA, no MR IID, and a local source observation. Verify:

- [ ] Exactly one request exists.
- [ ] Exactly one initial request version exists.
- [ ] At most one source observation exists, marked unverified.
- [ ] Audit and idempotency records exist.
- [ ] No execution job/result exists.
- [ ] Request lifecycle is `draft` and execution scope is `development_only`.
- [ ] Source link and deployment state are not falsely marked integrated/deployed.
- [ ] Repeating the same idempotency key/payload returns the original result without duplicate rows.
- [ ] Reusing that key with a materially different payload returns a conflict.

## Exit criteria

- [ ] AI agent can safely create a provisional request before commit using MCP, and the UI communicates exact resulting state.

---

# Phase 11 — Go runner protocol and device enrollment

**Goal:** Establish a secure, versioned control channel and per-device identity before allowing request execution.

## Protocol design

Define and version JSON messages for at least:

- runner hello / protocol negotiation
- authenticated heartbeat
- job-available notification
- job claim request/response
- job started acknowledgment
- result report
- job failure report
- cancel request / cancel acknowledgment (best effort)
- server policy/config refresh notification
- server disconnect/revocation response

Each message includes a protocol version and trace/correlation ID where applicable. Do not place long-lived secrets in job payloads, logs, or messages sent to the wrong device.

## Database scope

- `devices`
- `device_enrollment_codes`
- optional `device_sessions`
- audit events for enrollment, authentication failure, revocation, and credential rotation

## Backend tasks

- [ ] P11-01: Define runner protocol schema and compatibility policy.
- [ ] P11-02: Implement single-use, short-lived enrollment codes scoped to the intended user and organization.
- [ ] P11-03: Store only a hash of each enrollment code.
- [ ] P11-04: Implement exchange of an enrollment code for a device-scoped credential/key identity.
- [ ] P11-05: Ensure device private keys remain on device; finalize secure credential-storage design for Windows and Linux.
- [ ] P11-06: Implement device registration, last-seen, revocation, protocol version, platform, architecture, and runner version.
- [ ] P11-07: Implement WSS authentication and device-specific authorization.
- [ ] P11-08: Implement heartbeat processing and derived online/offline status.
- [ ] P11-09: Implement device listing and revocation endpoints/UI support.
- [ ] P11-10: Reject revoked devices and unsupported protocol versions according to policy.
- [ ] P11-11: Keep active sockets ephemeral; durable identity/status resides in PostgreSQL.

## Go runner tasks

- [ ] P11-12: Create Go modules, build metadata, configuration parser, and structured logging.
- [ ] P11-13: Implement enrollment CLI and device identity generation/storage.
- [ ] P11-14: Implement outbound WSS connection, authentication, heartbeat, reconnect with exponential backoff/jitter, and graceful shutdown.
- [ ] P11-15: Implement protocol-version negotiation and compatibility error handling.
- [ ] P11-16: Implement no-inbound-listener invariant.
- [ ] P11-17: Implement diagnostics/status command without printing credentials.

## Tests

- [ ] Enrollment code can be consumed only once and expires as configured.
- [ ] A Windows device and WSL2 device register independently.
- [ ] Revoked device cannot reconnect or claim jobs.
- [ ] Invalid protocol version is rejected safely.
- [ ] Sleep/network loss recovers with reconnect and does not lose jobs.
- [ ] Logs contain no tokens/private keys.

## Exit criteria

- [ ] A real Windows and WSL2 runner can enroll, authenticate, remain connected, heartbeat, and be revoked without executing requests yet.

---

# Phase 12 — Runner packaging, startup, update, and uninstall

**Goal:** Make the runner installable and supportable on real developer machines.

## Windows tasks

- [ ] P12-01: Build signed Windows artifacts for approved architectures.
- [ ] P12-02: Choose least-privilege startup mechanism (default to user-level startup/scheduled task; use a privileged service only if justified).
- [ ] P12-03: Add install, upgrade, status, stop, restart, and uninstall commands or installer actions.
- [ ] P12-04: Ensure logs/config paths follow Windows conventions and permissions.
- [ ] P12-05: Verify update rollback and behavior when the runner is in use.

## WSL2/Linux tasks

- [ ] P12-06: Build signed/versioned Linux artifacts for supported architecture.
- [ ] P12-07: Provide a setup command/script that runs inside the intended WSL2 distribution.
- [ ] P12-08: Use a user-level `systemd` service when supported; document the fallback startup mechanism.
- [ ] P12-09: Verify behavior across WSL2 shutdown, distribution restart, system sleep/resume, and network changes.
- [ ] P12-10: Ensure installation/uninstall does not require root unless explicitly chosen installation mode requires it.

## Shared tasks

- [ ] P12-11: Publish versioned release artifacts over HTTPS from an approved artifact host.
- [ ] P12-12: Verify signature/checksum before install/update; define signing-key custody and rotation.
- [ ] P12-13: Implement minimum supported runner version and protocol compatibility policy.
- [ ] P12-14: Add staged update channels (pilot/stable) and rollback procedure.
- [ ] P12-15: Add first-run wizard/CLI enrollment that requires explicit user approval; an MCP connection must not silently install software.
- [ ] P12-16: Build App A onboarding instructions that configure MCP and runner as clearly separate setup steps.

## Tests

- [ ] Clean install, upgrade, rollback, and uninstall pass on clean supported Windows/WSL images.
- [ ] Runner starts on login/startup as documented and runs after MCP client closes.
- [ ] Private credentials survive normal restart securely and are removed/revoked on approved uninstall/device deletion policy.
- [ ] Tampered artifact is rejected.

## Exit criteria

- [ ] Pilot developers can install, enroll, inspect, update, and remove either runner without manual source builds.

---

# Phase 13 — Durable execution jobs and backend orchestration

**Goal:** Create the durable execution lifecycle independent of whether a runner is currently connected.

## Database scope

- `execution_jobs`
- `execution_attempts`
- `execution_results`
- optional `transactional_outbox` if cross-process event publication needs delivery guarantees

## Job-state model

Implement the PRD statuses and transitions. At minimum:

- `queued` → `claimed` → `running` → `succeeded` / `failed` / `timed_out` / `outcome_unknown`
- `queued` may become `expired` before claim.
- `queued` may become `cancelled` before execution.
- `running` may receive `cancel_requested`; final `cancelled` is only recorded when cancellation is confirmed and no result ambiguity remains.
- A lease timeout permits safe re-claim only if policy determines execution has not begun; if a request may have reached the target, mark the outcome uncertain instead of replaying blindly.

## Backend tasks

- [ ] P13-01: Implement `start_execution` use case with auth, policy checks, request-version snapshot, target resolution, and approval checks.
- [ ] P13-02: Persist job before notifying a runner.
- [ ] P13-03: Store `request_snapshot_hash`, request version ID, target ID, device ID, requester, requested-via, correlation ID, idempotency key, expiry, and approval status.
- [ ] P13-04: Implement unique execution idempotency key per organization/actor or other approved namespace.
- [ ] P13-05: Implement safe job claiming with transaction/row locking and a lease.
- [ ] P13-06: Implement attempt rows and attempt numbering.
- [ ] P13-07: Implement start acknowledgment, lease renewal if needed, and stale-worker protection.
- [ ] P13-08: Implement job expiration and orphaned lease reconciliation.
- [ ] P13-09: Implement an authenticated wake-up notification through the runner connection gateway.
- [ ] P13-10: If the notification is missed, runner reconnect/periodic claim must still discover the durable job.
- [ ] P13-11: Implement result submission idempotency and reject reports from stale/revoked/wrong devices.
- [ ] P13-12: Implement policy for retries by failure type and HTTP method; default to no blind retry for ambiguous non-idempotent requests.
- [ ] P13-13: Implement user cancellation as best-effort and document limits after network dispatch.
- [ ] P13-14: Implement job status query and bounded wait/poll endpoint for MCP clients.
- [ ] P13-15: Ensure job payload excludes unnecessary secrets and does not include raw secret values in logs.

## Worker tasks

- [ ] P13-16: Poll/claim queued work using safe concurrency control.
- [ ] P13-17: Apply expiry and stale-lease cleanup.
- [ ] P13-18: Separate execution jobs from GitLab/reconciliation work in scheduling and metrics, even if they share one worker process initially.
- [ ] P13-19: Make periodic tasks safe across multiple worker replicas (leader/lease/advisory lock or idempotent processing).

## Tests

- [ ] Worker/API restart does not lose pending jobs.
- [ ] Duplicate notification does not produce duplicate execution attempts.
- [ ] Stale device cannot submit a result for a newer attempt.
- [ ] Lost WSS notification does not strand a job permanently.
- [ ] Expired lease follows the safe retry/unknown-outcome policy.
- [ ] Repeated `start_execution` idempotency key does not create duplicate jobs.

## Exit criteria

- [ ] Jobs remain durable and explainable through queued, claimed, running, and terminal outcomes, with unsafe replay prevented.

---

# Phase 14 — Local HTTP execution, response handling, and execution UI

**Goal:** Run saved requests from the correct developer network context and make outcomes easy to inspect.

## Go runner executor tasks

- [ ] P14-01: Implement HTTP client with connection/request timeouts, bounded redirects, bounded response capture, and cancellation support.
- [ ] P14-02: Resolve base URL from the assigned environment target; do not accept arbitrary base URLs directly from the MCP tool payload.
- [ ] P14-03: Resolve variables/secret references only through approved execution-time mechanisms and keep values in memory as much as practical.
- [ ] P14-04: Re-validate scheme, host, resolved IP/port, redirects, and destination policy at execution time.
- [ ] P14-05: Reject unsupported/disallowed destinations and return a sanitized policy error.
- [ ] P14-06: Add response capture for status, duration, selected/filtered headers, body kind, byte count, truncation marker, and sanitized errors.
- [ ] P14-07: Support JSON and text first; add multipart/binary cases only within defined MVP scope and size limits.
- [ ] P14-08: Never log authorization headers/cookies/tokens or body content by default.
- [ ] P14-09: Return an explicit outcome-unknown status when the request may have reached the target but the result cannot be established.
- [ ] P14-10: Report runner version, protocol version, job/attempt ID, and correlation ID with results.

## Backend tasks

- [ ] P14-11: Validate runner result schema and ownership.
- [ ] P14-12: Store response metadata and small allowed bodies in PostgreSQL; use object storage for large/binary data as configured.
- [ ] P14-13: Apply redaction before persistence and before returning results via UI/MCP.
- [ ] P14-14: Enforce response retention and delete associated object-storage items when retention policy requires it.
- [ ] P14-15: Implement result access checks independent of job ID secrecy.
- [ ] P14-16: Provide `get_execution_result` and `cancel_execution` MCP tools where approved.

## Frontend tasks

- [ ] P14-17: Add execution target selector (device + environment).
- [ ] P14-18: Add explicit confirmation/approval UX when policy requires it.
- [ ] P14-19: Add Run action and show queued/claimed/running/terminal status transitions.
- [ ] P14-20: Add response viewer: HTTP status, duration, headers, formatted body, truncation, and error summary.
- [ ] P14-21: Add execution history per request/version and provide clear link to the request snapshot that ran.
- [ ] P14-22: Distinguish `failed`, `timed_out`, `cancelled`, and `outcome_unknown` visually and textually.
- [ ] P14-23: Show offline/unsupported runner states with actionable guidance rather than indefinite spinners.

## Required end-to-end scenarios

- [ ] A Windows runner executes against Windows-local App B.
- [ ] A WSL2 runner executes against WSL2-local App B.
- [ ] A job queued while the device is offline runs only if still eligible when the device reconnects.
- [ ] Closing OpenCode/Claude Code does not stop the independently installed runner.
- [ ] A request response appears in the UI and can be retrieved by an authorized MCP caller.
- [ ] Large response is truncated/streamed/stored according to limits, never silently consumed without bound.
- [ ] A `POST` response lost after server-side success becomes `outcome_unknown`, not a blind second POST.

## Exit criteria

- [ ] Developer can create a request through MCP or UI, select a Windows/WSL2 device, execute against localhost, and inspect the persisted result while the AI client is closed.

---

# Phase 15 — GitLab provenance, webhooks, and source reconciliation

**Goal:** Track source evolution using authoritative GitLab data without treating agent assertions as truth.

## Database scope

- `gitlab_webhook_deliveries`
- `api_request_source_links`
- `api_request_source_observations`
- relevant GitLab repository/connection fields
- `transactional_outbox` if required for reliable downstream events

## Webhook tasks

- [ ] P15-01: Implement webhook endpoint authentication/signature/secret verification according to GitLab's supported mechanism.
- [ ] P15-02: Accept only configured repository events and enforce payload size limits.
- [ ] P15-03: Persist a webhook delivery record before asynchronous processing.
- [ ] P15-04: Implement idempotency for duplicate deliveries; handle events without a globally unique delivery ID using repository/event/payload metadata cautiously.
- [ ] P15-05: Process webhooks asynchronously, returning quickly to GitLab.
- [ ] P15-06: Re-query GitLab for authoritative state when event ordering or payload completeness makes direct application unsafe.
- [ ] P15-07: Implement retries and a failed-event visibility/replay workflow.

## Source-link and reconciliation tasks

- [ ] P15-08: Allow request versions/source links to be associated with repository, source path, branch, commit SHA, and MR IID when known.
- [ ] P15-09: Keep agent-provided local observations explicitly unverified until supported by authoritative evidence.
- [ ] P15-10: Add safe UI/MCP operation to attach a GitLab link after commit or MR creation.
- [ ] P15-11: Reconcile MR open/merged/closed state from authoritative GitLab API state.
- [ ] P15-12: Compare imported OpenAPI source version/commit and produce a reviewable specification diff.
- [ ] P15-13: Do not automatically map a request to a changed route solely because method/path appears similar; require explicit source link or supported high-confidence analysis with confirmation when ambiguous.
- [ ] P15-14: Preserve immutable request versions; update source links and current reconciliation data rather than rewriting historical versions.
- [ ] P15-15: Add periodic reconciliation to recover from missed webhooks and connection outages.
- [ ] P15-16: Expose last successful sync, pending reconciliation, and errors in the project UI.

## Tests

- [ ] Duplicate webhook delivery is processed idempotently.
- [ ] Out-of-order events cannot regress an MR from merged to in-review; current GitLab state wins.
- [ ] Lost webhook is repaired by periodic reconciliation.
- [ ] Agent-supplied `merged` or `deployed` values are rejected as authoritative writes.
- [ ] Matching route names without source evidence do not automatically link the wrong request.

## Exit criteria

- [ ] Commit/MR lifecycle is reconciled from GitLab, source observations remain attributed, and merge is not misrepresented as deployment.

---

# Phase 16 — Deployment evidence and deployment state

**Goal:** Represent deployment independently from request lifecycle, source status, and execution status.

## Tasks

- [ ] P16-01: Decide the first supported deployment evidence source (GitLab deployment API, pipeline/release integration, or approved manual evidence).
- [ ] P16-02: Implement `deployments` records with project, environment, source commit, release/external ID, status, evidence source, and timestamps.
- [ ] P16-03: Validate that a deployment event belongs to a configured repository/project/environment.
- [ ] P16-04: Process deployment evidence idempotently and reconcile current state against the authoritative platform.
- [ ] P16-05: Define how a request/source link is associated with a deployed commit. Do not claim a request is deployed merely because its merge request was merged.
- [ ] P16-06: Keep manual declarations labeled as manually asserted, with actor and audit trail.
- [ ] P16-07: Derive `DEPLOYED` badge from valid deployment evidence and the configured source link/release relationship.
- [ ] P16-08: Keep successful request execution as separate evidence; do not infer deployment from execution against localhost or staging.
- [ ] P16-09: Add project/request UI for environment-specific deployment status and evidence details.

## Tests

- [ ] Merge with no deployment event does not change deployment to `deployed`.
- [ ] A failed/cancelled deployment remains distinguishable from a successful deployment.
- [ ] Multiple environments can have different deployment states for the same commit.
- [ ] Manual evidence cannot masquerade as automatically confirmed evidence.

## Exit criteria

- [ ] Deployment state is environment-specific, evidence-backed, auditable, and independent from Git merge state.

---

# Phase 17 — Security, reliability, performance, and data governance hardening

**Goal:** Complete required threat controls and operational resilience before broad production rollout. Security tasks should be implemented incrementally in earlier phases; this phase closes and independently verifies the controls.

## Security tasks

- [ ] P17-01: Perform threat modeling for hosted MCP, runner enrollment, runner job dispatch, HTTP target validation, GitLab credentials, and response/body storage.
- [ ] P17-02: Verify authentication and project authorization for every REST route, MCP tool, runner operation, webhook, and result fetch.
- [ ] P17-03: Test cross-tenant access by guessing organization/project/request/job/device IDs.
- [ ] P17-04: Enforce target allowlists and approved scheme/port ranges, with clear exceptions for permitted local addresses.
- [ ] P17-05: Revalidate redirects and final resolved destination; test DNS rebinding and metadata/private-network protections appropriate to the deployment model.
- [ ] P17-06: Verify runner has no unintended inbound listener or shell execution surface.
- [ ] P17-07: Verify device key/credential storage, revocation, rotation, enrollment expiry, and tamper detection.
- [ ] P17-08: Verify secrets are redacted in structured logs, trace attributes, audit metadata, UI/API/MCP output, and stored job snapshots.
- [ ] P17-09: Set request/response/payload limits, execution timeout, per-user/device concurrency limit, and rate limits.
- [ ] P17-10: Add dependency scanning, secret scanning, container scanning, and signed release artifact checks.
- [ ] P17-11: Conduct security review/penetration test focused on SSRF-like behavior, tenant boundaries, MCP authorization, and device compromise.

## Reliability tasks

- [ ] P17-12: Test API and worker restart during queued, claimed, running, and completed job states.
- [ ] P17-13: Test database failover/reconnect and ensure handlers don't double-commit logical actions.
- [ ] P17-14: Test webhook duplicate/out-of-order/replay and reconciliation recovery.
- [ ] P17-15: Test runner sleep, offline state, reconnect storms, token expiration, revocation, and version mismatch.
- [ ] P17-16: Verify retention cleanup for request history, webhook payload references, audit events, idempotency records, and object storage.
- [ ] P17-17: Run backup/restore drill including object storage references and migration recovery.

## Performance tasks

- [ ] P17-18: Establish initial load profile based on Phase 0 scale estimates.
- [ ] P17-19: Load-test project/search APIs, request history, MCP tool latency, connected-device heartbeat handling, and job claim throughput.
- [ ] P17-20: Review PostgreSQL query plans/indexes for the most frequent access patterns.
- [ ] P17-21: Tune worker concurrency and database pool sizes based on measurements.
- [ ] P17-22: Define performance targets and alerts from observed baseline; don't introduce Redis solely on theoretical concern.

## Observability tasks

- [ ] P17-23: Add metrics for connected devices, heartbeat age, reconnects, queued jobs, oldest queued job, lease expirations, execution latency/outcomes, webhook backlog, reconciliation age, and failed jobs.
- [ ] P17-24: Add trace/correlation propagation from web/MCP request through application service, DB transaction, job, runner attempt, and result.
- [ ] P17-25: Add alerts for prolonged worker backlog, high job failure/unknown outcome rates, webhook backlog, disconnected integration, and backup failure.
- [ ] P17-26: Define safe support diagnostics that avoid dumping secrets or full bodies.

## Exit criteria

- [ ] Security review findings are resolved or explicitly accepted by the designated risk owner.
- [ ] Recovery, retention, and observability checks pass in staging.
- [ ] Performance fits the agreed expected scale without unnecessary infrastructure complexity.

---

# Phase 18 — Pilot, migration, production release, and operations

**Goal:** Roll out safely to a small group, then expand with documented operational ownership.

## Pilot setup

- [ ] P18-01: Select a small pilot group and a small set of representative projects.
- [ ] P18-02: Include at least one Windows-hosted API and one WSL2-hosted API.
- [ ] P18-03: Pilot request creation via MCP before commit, request review, local execution, and post-merge reconciliation.
- [ ] P18-04: Collect issues about MCP client onboarding, request editor UX, target mappings, and runner reliability.
- [ ] P18-05: Fix pilot blockers and repeat the acceptance workflow.

## Release preparation

- [ ] P18-06: Freeze schema/API/protocol breaking changes for the release candidate and document version compatibility.
- [ ] P18-07: Run full migration from a clean database and from the current staging schema.
- [ ] P18-08: Verify rollback/forward-fix procedure for application releases and runner releases.
- [ ] P18-09: Verify database backup and restore runbook; confirm retention and access controls.
- [ ] P18-10: Publish signed Windows and Linux/WSL2 runner artifacts with checksums and release notes.
- [ ] P18-11: Publish MCP setup guides for each supported client and operating system.
- [ ] P18-12: Publish administrator guide for SSO, GitLab, project permissions, device revocation, and incident response.
- [ ] P18-13: Confirm on-call/service owner and escalation channels.
- [ ] P18-14: Prepare production dashboards and alert routing.

## Rollout

- [ ] P18-15: Deploy backend and worker to production with the approved migration ordering.
- [ ] P18-16: Enable feature flags or staged access where supported.
- [ ] P18-17: Register GitLab integration and verify webhook/reconciliation.
- [ ] P18-18: Onboard users/projects in batches; monitor job and runner health after each batch.
- [ ] P18-19: Keep a rollback/disable plan for MCP write tools and execution if a critical security issue is discovered.
- [ ] P18-20: Review product metrics and incidents after the first production period, then prioritize follow-up work.

## Operational runbooks required

- [ ] Runner is offline or cannot enroll.
- [ ] Runner credential is compromised and must be revoked.
- [ ] Jobs remain queued or leases keep expiring.
- [ ] Execution outcome is unknown after possible target success.
- [ ] GitLab webhooks fail or source reconciliation is stale.
- [ ] OpenAPI import fails or source spec changes unexpectedly.
- [ ] Secret redaction or access-control issue is detected.
- [ ] Restore PostgreSQL and referenced object data.
- [ ] Roll back application/runner release.

## Exit criteria

- [ ] All production acceptance criteria in the PRD pass.
- [ ] Pilot users can complete the core lifecycle without engineering intervention for normal use.
- [ ] Operational ownership and incident/recovery procedures are accepted by the service owner.

---

# 4. Cross-phase end-to-end workflows

These workflows should be kept as permanent end-to-end test suites and run against a clean test environment in CI or scheduled staging validation.

## Workflow A — Create project from scratch

1. User signs in through SSO/OIDC.
2. User creates a project with name, slug, description, and owning team.
3. Backend authorizes the action and transactionally creates the project, membership/ownership association as applicable, and audit event.
4. UI opens the project workspace and onboarding checklist.
5. No GitLab repository, OpenAPI spec, runner, execution job, or deployment record is required for project creation.

**Verify:** project exists; creator has the expected access; project has no fabricated repository/spec/runner; onboarding steps show the remaining optional setup.

## Workflow B — Connect repository and import OpenAPI

1. Maintainer selects the GitLab repository using an authorized integration.
2. Hitman stores stable external repository identity and approved credential reference.
3. Hitman fetches repository metadata and the configured OpenAPI file at a specific commit.
4. Hitman preserves the raw spec version, parses supported operations, and records source commit SHA.
5. UI displays import summary, errors/warnings, and last successful sync.
6. Webhook setup is validated; scheduled reconciliation is enabled.

**Verify:** raw spec and normalized operations are related to a version and commit; invalid import doesn't erase prior valid spec; secret credentials aren't returned to the browser.

## Workflow C — AI creates a request before commit

1. Developer asks the coding agent to inspect local source and create a request in Hitman.
2. AI reads the local workspace with its own coding-tool permissions.
3. AI uses MCP to retrieve authorized project context, then searches for duplicates.
4. AI submits the method/path and evidence-derived request payload with a generated idempotency key.
5. Backend validates the request and authorization.
6. A single transaction creates request, version 1, optional unverified source observation, audit event, and idempotency record.
7. MCP returns stable IDs, initial statuses, and warnings.
8. The AI reports that the request is saved as a draft and has not been executed. No job/result is created.

**Verify:** exactly the intended records exist; repeated request with the same key and payload is safe; no false GitLab/deployment status appears.

## Workflow D — Install runner and execute locally

1. Developer explicitly installs a signed runner for Windows and/or WSL2.
2. Runner enrolls with a short-lived code and receives its own device identity.
3. Runner connects outbound to Hitman; device becomes online.
4. Developer configures the local target mapping for that device.
5. Developer or authorized AI client calls `start_execution` for a saved request, selected environment, and eligible device.
6. Backend creates a durable job and sends a notification.
7. Runner claims the job, rechecks target policy, executes HTTP, and reports the outcome.
8. Backend validates the result, stores the result/body according to redaction and retention policy, and marks the job terminal.
9. UI/MCP shows the outcome with status code, duration, response body/headers when permitted, and request-version link.

**Verify:** the runner operates without the MCP client; jobs survive restart; execution targets cannot be changed by arbitrary tool input; uncertain requests are not blindly replayed.

## Workflow E — Commit, merge, and reconcile source status

1. Developer commits/pushes code and opens an MR.
2. The source link is attached by the user/agent or matched through an approved correlation strategy.
3. GitLab webhook is verified and stored idempotently.
4. Worker processes the event and reconciles current authoritative MR state with GitLab.
5. Hitman updates source status/link metadata and adds audit/integration events; it does not rewrite old request versions.
6. Missed events are repaired through scheduled reconciliation.

**Verify:** duplicate/out-of-order events don't regress the state; unverified agent observation remains distinguishable; an unlinked request doesn't magically become integrated from a weak route match.

## Workflow F — Deploy and verify

1. A deployment system emits authoritative deployment evidence or an approved manual entry is recorded.
2. Hitman stores a deployment record tied to project, environment, commit/release, evidence source, and timestamps.
3. Hitman resolves whether the request/source link corresponds to the deployed commit/release using explicit links or supported mapping rules.
4. UI presents environment-specific deployment state and evidence.
5. Request execution/verification evidence is shown separately from deployment state.

**Verify:** merge alone never means deployed; a staging deployment doesn't mean production deployment; manual evidence remains labeled as manual.

---

# 5. Database migration sequence

Use numbered, reviewed, version-controlled migrations. The sequence below is logical; combine small migrations only when that makes review clearer. Avoid one giant initial migration that is difficult to review or evolve.

1. **M001 — Identity foundation:** organizations, users, organization memberships, teams, team memberships.
2. **M002 — Projects/access:** projects, project memberships, core audit events.
3. **M003 — GitLab registration:** GitLab connections, repositories.
4. **M004 — Specifications:** API specifications, specification versions, API operations.
5. **M005 — Collections and requests:** collections, folders, requests, request versions.
6. **M006 — Request provenance:** source observations, source links, related indexes/constraints.
7. **M007 — Environments:** environments, environment targets, environment variables/secret references.
8. **M008 — Device enrollment:** devices, enrollment codes, optional device sessions.
9. **M009 — Execution records:** execution jobs, attempts, results.
10. **M010 — Integration events:** webhook deliveries, deployments.
11. **M011 — Idempotency and outbox:** idempotency records and transactional outbox if cross-process publishing requires it.
12. **M012+ — Tune/extend:** indexes based on query plans, retention fields, feature-specific constraints.

Migration rules:

- [ ] Every schema change is applied automatically in CI to a clean database.
- [ ] Staging migration is tested before production migration.
- [ ] Backwards-incompatible migrations use expand/contract steps when rolling deploys are possible.
- [ ] Backups are verified before destructive migrations.
- [ ] Use database constraints for invariants that must survive concurrent requests.
- [ ] Avoid storing raw webhook payloads or large bodies unless retention/access requirements are defined.

---

# 6. API and protocol contract checklist

Before calling a feature complete, update and version the relevant contract.

## REST API groups

- [ ] Identity/session and organization membership.
- [ ] Projects, memberships, and repository links.
- [ ] Specifications, operations, collections, folders, request definitions, and versions.
- [ ] Environment settings, targets, variables, and secret references.
- [ ] Device enrollment, status, credentials/revocation, and diagnostics.
- [ ] Execution create/status/cancel/results.
- [ ] GitLab webhook reception and integration health.
- [ ] Deployment evidence and per-environment state.
- [ ] Audit access for authorized administrators.

## MCP tools

- [ ] `list_projects`
- [ ] `get_project_api_context`
- [ ] `search_api_requests`
- [ ] `get_api_request`
- [ ] `create_api_request`
- [ ] `update_api_request`
- [ ] `list_execution_targets`
- [ ] `start_execution`
- [ ] `get_execution_result`
- [ ] `cancel_execution`

Every MCP tool must have documented input/output schemas, permissions, side effects, maximum response size, error mapping, and idempotency behavior if it writes state.

## Runner protocol

- [ ] Protocol version negotiation.
- [ ] Device authentication and revocation behavior.
- [ ] Heartbeat and connection state.
- [ ] Claim/lease/start/result messages.
- [ ] Job cancellation best-effort semantics.
- [ ] Result redaction and size limits.
- [ ] Safe reconnect and stale-session handling.
- [ ] Compatibility policy and minimum supported version.

---

# 7. Testing strategy and definition of done

## Unit tests

- Domain validation and lifecycle transitions.
- Authorization and target policy decisions.
- Request normalization and idempotency hash behavior.
- Source observation versus authoritative source-state rules.
- URL and redirect policy helpers.
- Go runner protocol parsing, configuration, and executor policy.

## Integration tests

- PostgreSQL transactionality, unique constraints, row claiming/leases, request version immutability, and cleanup.
- OIDC/session validation in a test identity environment or appropriate mock boundary.
- GitLab API/webhook parsing with recorded sanitized fixtures.
- MCP tool calls through the actual chosen transport and SDK.
- Object storage access controls and retention if enabled.

## End-to-end tests

- Create project without optional integrations.
- Link repository and import supported OpenAPI.
- Create a request via UI and via MCP.
- Create a request based on uncommitted code, without commit/MR references.
- Repeated MCP call with same idempotency key doesn't duplicate.
- Execute against Windows-local service and WSL2-local service.
- Close MCP client while runner remains connected and able to receive a new job.
- Test offline runner, expired job, reconnect, stale lease, and uncertain POST outcome.
- GitLab push/MR/merge reconciliation with duplicate and out-of-order events.
- Confirm merge does not set deployment state.
- Confirm permissions, redaction, and device revocation end-to-end.

## Every work item is done only when

- [ ] Acceptance criteria for that work item pass.
- [ ] Automated tests cover expected behavior and principal failure cases.
- [ ] Schema/API/protocol docs are updated.
- [ ] Logs/metrics are adequate without exposing secrets.
- [ ] Authorization and data access are reviewed.
- [ ] Migrations are reproducible and tested.
- [ ] UI includes loading, empty, error, and permission-denied states where applicable.
- [ ] The feature is observable in staging and has a rollback/disable path when it adds risk.

---

# 8. Release gates

## Gate A — API Hub foundation

Must pass before enabling general MCP request creation:

- Auth/authorization tests pass.
- Project membership is enforced.
- Request/version transactions are correct.
- Request editor can safely save and load content.
- Secret references never reveal secret values.

## Gate B — MCP write enablement

Must pass before enabling `create_api_request` and `update_api_request` for pilot users:

- MCP transport works in the supported client matrix.
- Tool schemas and permissions are documented.
- Idempotency works under concurrent duplicate requests.
- Initial statuses are exact and no execution job is created by request creation.
- AI cannot write authoritative GitLab/deployment state.

## Gate C — Local execution enablement

Must pass before allowing runner execution:

- Device credentials, revocation, and protocol versioning work.
- Target allowlist and redirect/DNS checks are tested.
- Jobs are durable across restarts.
- Runner cannot execute arbitrary commands.
- Non-idempotent uncertain outcome is handled safely.
- Results and logs are redacted and size-limited.

## Gate D — GitLab and deployment lifecycle

Must pass before displaying integrated/deployed claims:

- Webhook signature/secret validation, idempotency, retry, and reconciliation work.
- Source status comes from authoritative GitLab reads or events.
- Deployment status has evidence source and environment association.
- Merge does not imply deployment.

## Gate E — Production readiness

- Threat model and security review completed.
- Backup/restore and recovery runbooks tested.
- Runner signing/update/rollback tested.
- Metrics and alerts active.
- Pilot acceptance criteria pass.
- Service owner, incident handling, retention, and on-call arrangements are documented.

---

# 9. Suggested team workstreams

These are optional ways to parallelize work; a small team may have one person covering multiple workstreams.

| Workstream            | Phases                 | Main output                                                               | Coordination interface                                |
| --------------------- | ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Platform/Foundation   | 1–3, 17–18             | CI, infrastructure, secrets, observability, release                       | deployment contract, environment config               |
| Identity/Core backend | 4–6, 8                 | domain services, DB schema, authorization, request model                  | DB schema and application-service interfaces          |
| Web UX                | 4–8, 14–16             | project experience, request editor, device/execution and source status UI | OpenAPI/REST contracts and UI state model             |
| MCP integration       | 2, 9–10                | tested MCP endpoint/tools and lifecycle                                   | versioned tool schemas, application services          |
| Go runner             | 2, 11–14               | enrollable, secure, packaged local executor                               | runner protocol and execution policy contract         |
| Integration lifecycle | 5, 15–16               | GitLab events, source reconciliation, deployments                         | source-link model and authoritative state transitions |
| QA/Security           | throughout; gate in 17 | test matrices, threat tests, acceptance automation                        | shared acceptance matrix and release gates            |

Coordination rule: agree and review API/database/protocol contracts before implementation diverges. Generated clients and fixtures should be derived from those contracts where practical.

---

# 10. Recommended first 10 implementation tickets

These are the first tickets I would create after approving this plan. The exact IDs can be mapped to the team's issue tracker.

1. **HIT-001 — Repository bootstrap and CI:** workspace, lint/typecheck/tests/build, Node/Go versions, local PostgreSQL.
2. **HIT-002 — ADR: identity and authorization model:** OIDC, roles, resource scoping, MCP identity.
3. **HIT-003 — ADR: MCP SDK/transport compatibility spike:** prove clients and authentication.
4. **HIT-004 — ADR: runner identity and protocol:** credential design, messages, versioning, reconnect.
5. **HIT-005 — ADR: HTTP execution safety policy:** host/port/redirect rules, approvals, response redaction.
6. **HIT-006 — Initial database migrations:** organizations/users/memberships/projects/audit baseline.
7. **HIT-007 — Project create/list/detail API and UI:** permit project creation without GitLab/spec/runner.
8. **HIT-008 — GitLab repository registration skeleton:** stable external repository ID and credential reference.
9. **HIT-009 — Request/collection/version schema and services:** immutable versioning and transactional create.
10. **HIT-010 — MCP read-only tools:** list projects, project context, request search using shared application services.

Do not start production HTTP execution before the security policy and runner protocol have been reviewed.

---

# 11. Final implementation rule

Hitman must make every significant state transition explicit, attributable, idempotent where appropriate, and testable. Project creation, request creation, request execution, source reconciliation, and deployment verification are separate workflows with separate records and authority boundaries. The product is complete only when the developer-facing UI, MCP tools, database state, runner behavior, GitLab integration, and operational status all tell the same truthful story.

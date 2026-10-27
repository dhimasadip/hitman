# Hitman execution and retention policy baseline

- **Status:** Approved Phase 0 baseline
- **Date:** 2026-10-27
- **Source:** PRD §8, §9, §15, §22; implementation plan P0-09/P0-10/P0-11
- **Change control:** Changes require product + security approval and an ADR
  update when they alter execution authority.

## Execution scope

| Scope                           | Meaning                                                   | Local/development targets              | Staging targets   | Production targets                   |
| ------------------------------- | --------------------------------------------------------- | -------------------------------------- | ----------------- | ------------------------------------ |
| `development_only` (`DEV ONLY`) | Enforced restriction for provisional/AI-assisted requests | Allowed if device/target policy allows | Denied            | Denied                               |
| `environment_policy`            | Default when no stricter scope is requested               | Allowed                                | Approval required | Approval required; AI callers denied |
- `DEV ONLY` is enforced in the backend before job creation and again by the
  runner before connection. It is not a badge.
- Project default execution scope is recorded on the request. The backend must
  not infer `DEV ONLY` solely because code is uncommitted.
- AI-initiated execution is denied for staging and production in the MVP.
- Local/development execution is automatic only when the target is enabled and
  the caller is authorized for the device.

## Limits

| Control                           | Value                                                  |
| --------------------------------- | ------------------------------------------------------ |
| Total HTTP request timeout        | 30 seconds                                             |
| Connect/TLS/header timeouts       | Configured subsets of the total, bounded by 30 seconds |
| Job expiry (queued)               | 15 minutes                                             |
| Device enrollment code            | Single use, 10 minutes                                 |
| Idempotency retention             | 7 days minimum                                         |
| Inline response body              | 1 MiB                                                  |
| Maximum request body              | 10 MiB                                                 |
| Execution response/body retention | 30 days                                                |
| Audit retention                   | 1 year                                                 |
| Heartbeat offline threshold       | 90 seconds (provisional; tune in Phase 11)             |
| Metrics scrape interval           | 15 seconds                                             |

## Retry rules

| Situation                             | Behavior                                             |
| ------------------------------------- | ---------------------------------------------------- |
| Job queued, never claimed             | May be claimed until expiry.                         |
| Claimed, never started, lease expires | Requeue safely as a new attempt.                     |
| Running, lease expires / result lost  | `outcome_unknown`; no automatic retry.               |
| Server 4xx/5xx captured               | Execution `succeeded`; HTTP status shown separately. |
| Transport failure before send         | May be retried by policy.                            |
| Cancellation after possible dispatch  | Best effort; may end `outcome_unknown`.              |

## Scale planning baseline (pilot)

| Dimension               | Baseline                                      |
| ----------------------- | --------------------------------------------- |
| Users                   | 25                                            |
| Projects                | 10                                            |
| Registered devices      | 20                                            |
| Peak connected devices  | 10                                            |
| Executions per day      | 10,000                                        |
| Average payload         | 5 MiB                                         |
| Initial worker replicas | 1                                             |
| Initial API replicas    | 1–2                                           |
| Database                | Managed PostgreSQL 16, point-in-time recovery |

Do not add Redis or a separate queue until measured load or scheduling
requirements justify it. Revisit after pilot data.

## Roles (authorization baseline)

- Organization: `org_admin`, `member`, `read_only`.
- Project: `project_admin`, `editor`, `executor`, `viewer`.
- Team: `team_admin`, `member`, `viewer`; organization admins may manage teams
  regardless of team role.
- Device owner can create/approve their own device-local targets and revoke
  their devices, subject to project policy.
- Org admins can revoke any device and inspect audit/integration health.
- Every operation is authorized server-side; IDs are not access grants.

## Data handling

- Secrets are references resolved only at use time.
- Sensitive headers and project-configured patterns are redacted before
  persistence, logs, and MCP output.
- Large/binary bodies require object storage and are not enabled until Phase 14.
- Audit metadata excludes secrets, tokens, raw bodies, and request/response
  payloads.

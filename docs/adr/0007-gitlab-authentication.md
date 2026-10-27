# ADR 0007 — GitLab authentication and source reconciliation

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Platform, integration workstream, security
- **PRD references:** §8.3, §8.10, §8.11, §12.2, §15.1, §22 open decision 2

## Decision

1. GitLab integration is **configurable per connection**:
   - least-privilege project/group access token reference; or
   - GitLab OAuth application with per-user/refresh tokens.
     The credential mode is stored as metadata; only a secret-manager reference is
     stored in PostgreSQL.
2. The Phase 2/early integration target is **GitLab.com**, with the instance URL
   configurable for a later self-hosted deployment.
3. Store the stable GitLab external project ID, namespace path, repository URL,
   default branch, configured OpenAPI path, webhook status, and last successful
   reconciliation time.
4. Webhooks are **hints**. Verify the configured secret/token in constant time,
   persist the delivery before processing, deduplicate, return quickly, and
   re-query GitLab for authoritative state when ordering/completeness is
   uncertain.
5. There is no universal stable delivery ID across all GitLab events. Deduplicate
   with an event key derived from repository, event type, object identity,
   event UUID when present, and payload hash. Record collisions for review.
6. Scheduled reconciliation repairs missed, delayed, duplicate, or failed
   delivery. Current GitLab state wins over out-of-order events.
7. Agent-reported source state is an **unverified observation**. Only GitLab
   reconciliation can set authoritative `committed`, `in_review`, `merged`, or
   `closed` state. A source link is never fabricated from local code.
8. Merge does not imply deployment. Deployment evidence comes from GitLab
   Deployments/CI or another approved source, scoped to an environment and
   commit/release, and is stored separately.
9. A manual deployment declaration, if added, is labeled `manual_approved` with
   actor and audit evidence; it is never presented as automatically verified.

## Implementation sequencing note (Phase 5)

Phase 5 uses an explicit `MockGitLabProvider` and `auth_mode='mock'` connection
metadata so the project and repository-registration workflows can be built
without inventing live GitLab state. Only an `env://` secret reference is stored;
no token is used or persisted. The UI labels mock sources. Live PAT/OAuth,
repository metadata verification, webhooks, and reconciliation remain Phase 15
work behind the same provider/service boundary.

## Consequences

- Phase 15 requires webhook secret rotation, replay tooling, and a failed-event
  visibility screen.
- Phase 16 needs a concrete deployment evidence source before showing
  `DEPLOYED`; the default remains `unknown`.
- The integration must not request broad GitLab scopes merely for convenience.

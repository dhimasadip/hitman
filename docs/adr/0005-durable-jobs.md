# ADR 0005 — Durable jobs, leases, and uncertain outcomes

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Backend, worker workstream
- **PRD references:** §8.8, §8.9, §11.3, §12.6, §22 open decision 10

## Decision

1. PostgreSQL is the **authoritative job store**. WebSocket messages only notify
   a runner that work may exist; they never carry the only copy of a job.
2. Claiming uses a transaction with `SELECT ... FOR UPDATE SKIP LOCKED` (or an
   equivalent single-winner primitive) followed by an atomic status/lease
   update. One active attempt is allowed per job.
3. Every claim issues a random lease token. Only its hash is stored. A runner
   must present the token, device identity, job ID, and attempt ID to start,
   heartbeat, and report. Stale or wrong-device reports are rejected.
4. Attempts are numbered and unique per job. A duplicate notification cannot
   create a second attempt.
5. Lease expiry is handled conservatively:
   - `claimed` but not started: safe to requeue; no HTTP request was sent.
   - `running` at expiry: mark `outcome_unknown`; never blind-retry a
     non-idempotent request.
6. If the WebSocket notification is lost, the runner discovers jobs through
   authenticated reconnect/poll. The job remains queued and is not stranded.
7. Idempotency records prevent duplicate jobs from repeated `start_execution`
   calls. The exact namespace is fixed in Phase 13.
8. Worker replicas use the same database claim primitive; no in-memory queue is
   required for correctness. `LISTEN/NOTIFY` or an outbox may notify workers but
   is not the source of truth.
9. A transactional outbox is added only when a downstream consumer requires
   at-least-once domain events. Phase 3 does not publish such events.

## Phase 2 evidence

`spikes/02-durable-jobs/tests/jobs.test.ts` proves against PostgreSQL 16:

- exactly one of eight concurrent claims wins;
- a job with no notification is still claimable;
- expiry/availability windows are respected;
- a claimed-but-never-started lease requeues safely as a new attempt;
- a started lease becomes `outcome_unknown` on expiry;
- a late result is rejected after the lease is reaped;
- wrong-device reports and stale tokens fail;
- a successful result cannot be inserted twice.

## Consequences

- Phase 13 must preserve these invariants in Drizzle transactions with proper
  indexes and tests under concurrency.
- Job expiry, lease duration, and heartbeat cadence are configuration, but their
  safety semantics are not.
- Outcome-unknown requires explicit UI/MCP copy; it must not look like a failed
  request that is safe to rerun.

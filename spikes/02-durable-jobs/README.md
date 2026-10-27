# Durable jobs spike

PostgreSQL-backed claim/lease/result prototype for Phase 2 Spike D.

## Run

```bash
TEST_DATABASE_URL=postgres://hitman@127.0.0.1:5433/hitman_test \
  pnpm --filter @hitman/spike-durable-jobs test
```

The test suite creates and drops `spike_jobs` tables in the test database only.

## Proven invariants

- Atomic single-winner claim with `FOR UPDATE SKIP LOCKED`.
- Durable discovery without a WebSocket notification.
- Availability and expiry windows.
- Claimed-never-started lease expiry → safe requeue (new attempt).
- Started lease expiry → `outcome_unknown`; late result rejected.
- Wrong-device and stale-token rejection.
- Result uniqueness.

The production implementation belongs in Phase 13 and must use Drizzle
transactions and the shared schema. See ADR 0005.

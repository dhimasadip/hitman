# Runbook — PostgreSQL backup and restore

**Status:** documented baseline; production drill required in Phase 17. The local
development cluster is not backed up and is not production data.

## Production expectations

- Managed PostgreSQL with automated backups and point-in-time recovery (PITR)
  where available.
- Encryption in transit and at rest.
- Restore credentials held in the secret manager, separate from app credentials.
- Backup retention aligned with audit (1 year) and execution-body (30 days)
  policy.
- Migration ordering: backup/verify before destructive changes.

## Restore drill outline

1. Provision an isolated restore database from the latest backup/PITR point.
2. Verify schema version and critical row counts (users, projects, requests,
   request versions, devices, jobs, results, audit, idempotency).
3. Verify `api_request_versions` immutability and current-version pointers.
4. Verify object-storage references if object storage is enabled (Phase 14).
5. Start a staging app instance against the restore and run readiness plus a
   read-only smoke test.
6. Record restore duration, data-loss window, and approver.
7. Never restore over production without incident commander approval.

## Local development

There is no backup requirement. Resetting `.dev/postgres` is destructive by
design; see `docs/runbooks/local-development.md`.

## Open item

Phase 17 must execute this drill against the actual chosen platform and attach
the evidence to the release gate.

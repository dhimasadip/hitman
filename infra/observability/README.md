# Observability baseline (Phase 3)

The server and worker expose:

- `/health/live` — process liveness.
- `/health/ready` — dependency readiness (PostgreSQL for both roles).
- `/metrics` — Prometheus text format, protected by `METRICS_TOKEN` in
  staging/production. The ingress returns `404` for `/metrics`; Prometheus
  scrapes service-internal addresses.

`prometheus.yml` and `hitman-alerts.yml` are starter configurations. Alert
routing, long-term storage, tracing export, and on-call ownership are finalized
in Phases 17–18. Never put tokens in metric labels or log lines.

`metrics-token` is intentionally not committed; mount it from the secret
manager or deployment environment.

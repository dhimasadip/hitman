# Network and access rules

## Inbound

| Source                          | Destination              | Port/Protocol                                     | Allowed                   |
| ------------------------------- | ------------------------ | ------------------------------------------------- | ------------------------- |
| Users / AI clients              | Ingress / TLS proxy      | 443 HTTPS                                         | Yes                       |
| HTTP                            | Ingress                  | 80                                                | Redirect to HTTPS only    |
| Prometheus (monitoring network) | server/worker            | 8080/8081 HTTPS or internal HTTP                  | Yes, `/metrics` only      |
| Public internet                 | server/worker/PostgreSQL | any direct port                                   | No                        |
| Browser                         | server                   | `/api`, `/health`, `/version`, `/mcp` via ingress | Yes, after auth           |
| Browser                         | `/metrics`               | through ingress                                   | No (404)                  |
| Runner                          | server                   | outbound WSS + HTTPS via ingress                  | Yes, device-authenticated |

## Internal

| Source        | Destination    | Port     | Notes                                |
| ------------- | -------------- | -------- | ------------------------------------ |
| proxy         | server         | 8080     | REST/MCP/health                      |
| proxy         | web            | 8080     | static SPA                           |
| server        | PostgreSQL     | 5432     | TLS in shared environments           |
| worker        | PostgreSQL     | 5432     | TLS in shared environments           |
| migrate job   | PostgreSQL     | 5432     | one-shot before rollout              |
| server/worker | secret manager | 443      | least-privilege reference resolution |
| worker        | GitLab API     | 443      | only when integration enabled        |
| server/worker | object storage | 443      | only when enabled (Phase 14)         |
| Prometheus    | server/worker  | internal | token-protected metrics              |

PostgreSQL is never published on a public interface. Local development binds the
user-owned cluster to `127.0.0.1:5433` only.

## Outbound from runners

- WSS/HTTPS to the Hitman ingress only, using outbound-initiated connections.
- No inbound listener on the developer machine.
- HTTP execution targets are constrained by device/environment policy and
  revalidated by the runner immediately before connection.
- Ambient OS proxies/credentials are not forwarded.

## DNS and TLS

- Shared environments terminate TLS at the ingress/proxy with organization
  certificates; the app also sets HSTS when behind HTTPS.
- GitLab/secret-manager/object-storage endpoints must be reachable over HTTPS.
- DNS rebinding protection is enabled for localhost binds; production host and
  origin allowlists are mandatory.
- Redirects from request execution are denied by default; approved redirects are
  revalidated per hop.

## Firewall checklist for staging/production

- Allow ingress 443 from users and runners.
- Allow monitoring network to scrape metrics.
- Allow server/worker egress to PostgreSQL, secret manager, GitLab (if enabled),
  and object storage (if enabled).
- Deny direct database and metrics access from users/internet.
- Log and alert on repeated authorization failures and unusual egress.

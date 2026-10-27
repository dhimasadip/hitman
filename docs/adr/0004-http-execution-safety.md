# ADR 0004 — HTTP execution safety policy

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Security, runner workstream, platform
- **PRD references:** §8.8, §11.4, §15.2, §22 open decision 8

## Decision

The runner executes approved HTTP requests only. The following controls apply
server-side and are repeated on the runner immediately before connection.

### Destinations

- Allow only `http` and `https` schemes. Reject URL credentials, unsupported
  schemes, malformed hosts, and dangerous encodings.
- The default local profile permits **loopback only**. LAN/private ranges require
  explicit device/project policy. Link-local, multicast, unspecified, metadata
  service, and cloud metadata addresses are blocked.
- Bind every job to a pre-authorized `environment_target_id`. MCP input cannot
  supply an arbitrary base URL.
- Allowlisted hosts/ports are resolved and checked immediately before dialing.
  The validated IP is pinned for the connection to reduce DNS-rebinding risk.
- Redirects are **denied by default**. If enabled, every hop is revalidated
  against scheme/host/port/IP policy, including credentials and method changes.
- Do not forward ambient OS proxy credentials, cookies, client certificates, or
  machine identity unless explicitly configured for the target.

### Limits and timeouts

| Control                  | Initial value    |
| ------------------------ | ---------------- |
| Request timeout          | 30 seconds total |
| Job queue expiry         | 15 minutes       |
| Enrollment code lifetime | 10 minutes       |
| Idempotency retention    | 7 days           |
| Inline response body     | 1 MiB            |
| Request body             | 10 MiB           |
| Execution body retention | 30 days          |
| Audit retention          | 1 year           |
| Metrics scrape interval  | 15 seconds       |

Larger/binary bodies wait for the object-storage adapter (interface exists in
Phase 3; provisioning deferred). Until then they are rejected or truncated with
an explicit marker, never silently buffered without bound.

### Execution authority

- Local and development targets may run automatically.
- Staging and production require human approval by policy.
- **AI-initiated execution is denied for staging and production.** A successful
  approval flow for AI callers is not enabled in the MVP.
- `DEV ONLY` (`execution_scope=development_only`) is enforced server-side and in
  the runner; it cannot target staging/production even if a client asks.
- A merge is never evidence of deployment; execution is never evidence of
  deployment.

### Methods and retries

- A captured HTTP 4xx/5xx response is a successfully executed request; it is
  distinct from transport failure.
- Never blind-retry a non-idempotent request after a response is lost. Mark it
  `outcome_unknown` and require a deliberate user/agent decision.
- Cancellation is best effort once the request may have been dispatched.

### Redaction and persistence

- Redact `Authorization`, `Cookie`, `Set-Cookie`, API-key headers, and
  project-configured patterns before persistence, logging, or MCP output.
- Never log request/response bodies by default.
- Treat responses, headers, OpenAPI documents, and webhook payloads as untrusted
  data; do not interpret them as instructions.

## Consequences

- Some developer LAN targets will require explicit policy changes; this is
  intentional least-privilege behavior.
- Response bodies over 1 MiB are not usable until Phase 14 object storage is
  configured.

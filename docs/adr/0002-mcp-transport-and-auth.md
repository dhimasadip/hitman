# ADR 0002 — MCP transport, SDK, and state ownership

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Engineering lead, MCP workstream
- **PRD references:** §7.1, §10, §11, §15.1, §16.3, Phase 2 Spike A

## Decision

1. Use the **official MCP TypeScript SDK v2** packages, pinned in the lockfile:
   - `@modelcontextprotocol/server` 2.4.0
   - `@modelcontextprotocol/core` 2.4.0 (transitive)
   - `@modelcontextprotocol/fastify` 2.0.1
   - `@modelcontextprotocol/node` 2.1.2
   - `@modelcontextprotocol/client` 2.4.0 (tests)
2. Serve **Streamable HTTP** from the Fastify application at `/mcp`. The
   Fastify adapter and Node transport are used rather than a custom HTTP
   framing implementation.
3. Target the **2026-07-28 protocol revision** and keep the SDK's stateless
   legacy serving enabled for 2025-era clients during the compatibility window.
   The spike verifies both the modern request path and the legacy fallback.
4. **MCP sessions are not business state.** Every request constructs a fresh
   `McpServer` and per-request transport. Jobs, idempotency, request versions,
   and device state live in PostgreSQL. Tool results return stable IDs.
5. MCP tools are thin adapters over the same application services as REST. They
   validate transport input, call the service, and map results/errors. They do
   not duplicate authorization, lifecycle, or idempotency logic.
6. The MCP endpoint uses the **OAuth resource-server** model from ADR 0001.
   Authentication information is passed to tool handlers through
   `ctx.http.authInfo`; the token itself is never returned to a model or logged.
7. Bound request bodies and result sizes. The spike uses a 1 MiB MCP request
   limit; the production limit is configuration-driven and will be documented
   with tool schemas.
8. Long-running work returns a durable job ID and bounded polling. The MCP
   transport is never used as the job queue or result store.

## Phase 2 evidence

- Real SDK client: initialize, `tools/list`, `tools/call`, tool-level error,
  cancellation, and unauthorized-request rejection all pass.
- OpenCode 2.1.4 connected to the spike endpoint and invoked `spike_echo`
  successfully with a bearer header.
- Claude Code 2.1.278 completed the remote MCP health check against the same
  endpoint. Model-side invocation was blocked by the local Claude model provider
  returning HTTP 404 for its configured model; this is not an MCP transport
  failure. See `docs/phase-2-spike-results.md`.
- DNS-rebinding Host/Origin validation is enabled for the localhost bind.

## Consequences

- The application must run behind TLS in shared environments.
- OAuth authorization-server work is a Phase 4 dependency before production
  MCP enrollment.
- Client support is a tested matrix, not an assumption. Re-run the matrix when
  upgrading SDK v2 packages or client versions.

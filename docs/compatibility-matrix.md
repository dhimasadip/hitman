# Supported clients, platforms, and contracts

**Status:** Phase 0 baseline, updated with Phase 2 evidence (2026-10-27).

## MCP clients

| Client                         | Version tested                       | Transport       | Auth          | Result      | Notes                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------ | --------------- | ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode                       | 2.1.4                                | Streamable HTTP | Bearer header | **PASS**    | Connected, listed/called `spike_echo` through its MCP tool bridge.                                                                                                                                                                    |
| Claude Code                    | 2.1.278                              | Streamable HTTP | Bearer header | **PARTIAL** | MCP health check reports `✔ Connected`. Model invocation was blocked because the local Claude model provider returned HTTP 404 for its configured model. Re-run tool invocation with a working provider before production enablement. |
| Official MCP TypeScript client | `@modelcontextprotocol/client` 2.4.0 | Streamable HTTP | Bearer header | **PASS**    | Initialize, list/call, tool error, cancellation, and unauthorized rejection tests pass.                                                                                                                                               |
- Production authentication is OAuth 2.1 via Hitman as authorization server
  (ADR 0001), not the spike's static header. The client matrix must be re-tested
  with OAuth before MCP write tools are enabled.
- Protocol support target: **2026-07-28**, with SDK legacy stateless serving for
  2025-era clients during the compatibility window.
- No stdio adapter is required for the tested clients. Add one only if a
  supported client proves incompatible with remote Streamable HTTP.

## Operating systems

| Target                                 | Support status                                                       | Evidence                                                                                |
| -------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| WSL2 Ubuntu 24.04 x86_64               | **Validated for loopback HTTP, outbound WSS, reconnect**             | `spikes/02-networking`, local run 2026-10-27                                            |
| Windows 11 x86_64                      | **Pending**                                                          | Test procedure in `spikes/02-networking/README.md`; no Windows host in this environment |
| Windows-hosted app reachable from WSL2 | **Pending**                                                          | Must validate `localhost` forwarding/host-gateway behavior with real App B setups       |
| Linux (non-WSL2)                       | Expected to share the Linux runner path; not independently validated | Phase 11 packaging matrix                                                               |

WSL2 sleep/resume, VPN changes, proxy behavior, firewall traversal, and laptop
network switching were not reproducible here. They remain Phase 2/Phase 11 test
gates before production runner rollout.

## OpenAPI

| Version | Status                       | Parser                                                                 |
| ------- | ---------------------------- | ---------------------------------------------------------------------- |
| 3.0.x   | Supported                    | `@redocly/openapi-core` 2.71.1 + `struct` rule                         |
| 3.1.x   | Supported                    | same                                                                   |
| 3.2.x   | Experimental, not advertised | Redocly accepted fixture; broader corpus and client tooling not tested |

Remote `$ref` URLs are rejected; local import bundles only, subject to size/time
limits (Phase 6).

## GitLab

| Integration                         | Status                                |
| ----------------------------------- | ------------------------------------- |
| Mock repository catalog             | Phase 5 implemented and labeled in UI |
| Live GitLab.com repository metadata | Phase 15                              |
| PAT/OAuth credential verification   | Phase 15                              |
| Webhooks/reconciliation/deployments | Phases 15–16                          |

No token is required for Phase 5 mock repository selection.

## Runtime stack

| Component           | Pin                                   |
| ------------------- | ------------------------------------- |
| Node.js             | 24.22.0                               |
| pnpm                | 12.14.0                               |
| TypeScript          | 7.0.2                                 |
| Fastify             | 5.12.7                                |
| PostgreSQL          | 16.15                                 |
| Go                  | 1.27.3                                |
| Drizzle ORM         | 0.45.4                                |
| MCP server          | `@modelcontextprotocol/server` 2.4.0  |
| MCP Fastify adapter | `@modelcontextprotocol/fastify` 2.0.1 |
| MCP Node transport  | `@modelcontextprotocol/node` 2.1.2    |
| OpenAPI parser      | `@redocly/openapi-core` 2.71.1        |

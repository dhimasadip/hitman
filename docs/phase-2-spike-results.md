# Phase 2 — Technical validation spikes: results

**Date:** 2026-10-27
**Status:** Spike A/B/C/D complete to the extent reproducible in this environment.
**Exit criteria assessment:** High-risk assumptions have demonstrated proof or a
documented mitigation. Windows-host and Claude-model invocation remain explicit
gates, not silent assumptions.

## Spike A — MCP client and transport

### What was built

`spikes/02-mcp-compatibility` is a disposable Fastify + MCP SDK v2 server at
`/mcp` with:

- Streamable HTTP via `createMcpHandler` + `toWebRequest` / Response streaming;
- bearer-token enforcement, localhost Host/Origin validation;
- tools `spike_echo`, `spike_whoami`, `spike_slow`, `spike_fail`;
- a real SDK client test suite (`@modelcontextprotocol/client` 2.4.0).

### Results

| Test                                                | Result                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SDK initialize + tools/list                         | Pass                                                                                                                                    |
| SDK tools/call + structured content                 | Pass                                                                                                                                    |
| Tool-level error (`isError`)                        | Pass                                                                                                                                    |
| Missing bearer token rejected                       | Pass                                                                                                                                    |
| Client cancellation                                 | Pass                                                                                                                                    |
| Reconnect after client close                        | Pass                                                                                                                                    |
| OpenCode 2.1.4 connection + `spike_echo` invocation | **Pass**                                                                                                                                |
| Claude Code 2.1.278 connection/health check         | **Pass** (`✔ Connected`)                                                                                                                |
| Claude Code tool invocation through a model         | **Blocked externally** — its configured model provider returned HTTP 404 (`unrecognized_model`) before a model turn could call the tool |

OpenCode invocation evidence (sanitized): the tool returned
`{"message":"opencode-mcp-ok","principal":"spike-dev-user","serverTime":"..."}`.
The bearer token was never present in the model-visible result.

### Limitations / follow-up

- The spike uses a static bearer header. Production must use Hitman's OAuth 2.1
  authorization server and resource-server validation (ADR 0001/0002).
- Re-run Claude Code tool invocation after fixing or changing its model provider.
  The MCP transport/auth path already passes health checks.
- Re-test on SDK v2 patch upgrades and each supported client release.

## Spike B — OpenAPI compatibility

See ADR 0006. Key result: Redocly handles 3.0.3, 3.1.0, and the tested 3.2.1
constructs; Scalar is faster but rejected `additionalOperations`; ReadMe and
Swagger parsers rejected 3.2. Advertised support is 3.0.x/3.1.x only.

Generated matrix: `spikes/02-openapi-compatibility/results/matrix-2026-10-27.json`.

## Spike C — WSL2 networking

`spikes/02-networking` verified inside this WSL2 Ubuntu 24.04 environment:

- HTTP to `127.0.0.1:<ephemeral>` — pass.
- HTTP to `localhost:<ephemeral>` — pass (resolved to loopback here).
- WSS TLS 1.3 connection to loopback with a self-signed test certificate — pass.
- `runner.hello` and `runner.heartbeat` echo round trips — pass.
- Reconnect after clean socket close — pass.

Results: `spikes/02-networking/results/wsl2-2026-10-27.json`.

Not validated here: Windows-host loopback, WSL2↔Windows forwarding, VPN/proxy
transitions, sleep/resume, firewall behavior. Procedure and expected outcomes
are in `spikes/02-networking/README.md`; these remain Phase 11/12 release gates.

## Spike D — Durable jobs and uncertain outcomes

`spikes/02-durable-jobs` proved against PostgreSQL 16.15:

- eight concurrent claims → exactly one winner (`FOR UPDATE SKIP LOCKED`);
- a durable job with no notification is still discovered;
- available-at/expiry windows are respected;
- claimed-but-never-started lease expiry requeues safely as attempt 2;
- started-job lease expiry becomes `outcome_unknown`;
- late result after reaping is rejected;
- wrong-device reports and stale lease tokens are rejected;
- duplicate success result cannot be inserted.

See ADR 0005. These invariants are mandatory for Phase 13.

## Phase 2 exit

- MCP SDK v2/Streamable HTTP and real client connection are proven.
- OpenAPI parser choice and advertised versions are fixed.
- WSL2 loopback/WSS/reconnect is proven; Windows and adverse network behavior
  are documented pending tests, not claimed.
- PostgreSQL claim/lease/outcome-unknown semantics are proven.
- No feature phase is blocked by an untested transport/parser assumption.

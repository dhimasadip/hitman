# MCP client smoke evidence — 2026-10-27

## OpenCode 2.1.4

- Project config: remote Streamable HTTP server `hitman-spike` at
  `http://127.0.0.1:8787/mcp` with a bearer header.
- `opencode mcp list --print-logs` → `✓ hitman-spike connected`.
- `opencode run` invoked the MCP tool. Sanitized tool result:

```json
{
  "message": "opencode-mcp-ok",
  "principal": "spike-dev-user",
  "serverTime": "2026-10-27T06:50:10.035Z"
}
```

- The model reply repeated the tool output. No token appeared in the result.

## Claude Code 2.1.278

- Temporary config directory; server added with
  `claude mcp add --transport http ... --header "Authorization: Bearer ..."`.
- `claude mcp list` → `hitman-spike: http://127.0.0.1:8787/mcp (HTTP) - ✔ Connected`.
- Actual model/tool turn was blocked by the local model provider:
  `unrecognized_model` / HTTP 404 for the configured model. This is external to
  the MCP server and does not invalidate the connection test.
- Follow-up: re-run tool invocation with a working Claude model/provider before
  enabling MCP write tools in Phase 9/10.

## SDK client

`pnpm --filter @hitman/spike-mcp test` passes six tests: list, call, error,
unauthorized rejection, client-close reconnect, and cancellation.

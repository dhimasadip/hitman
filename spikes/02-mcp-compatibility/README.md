# MCP compatibility spike

Disposable Phase 2 spike only. It uses a static bearer token and localhost
Host/Origin validation. It is **not** the production authentication or tool
surface.

## Run

```bash
SPIKE_MCP_TOKEN='<choose-a-local-token>' SPIKE_MCP_PORT=8787 \
  pnpm --filter @hitman/spike-mcp dev
```

Endpoint: `http://127.0.0.1:8787/mcp`
Health: `http://127.0.0.1:8787/health`

The built-in development token is printed as a warning when used. Set
`SPIKE_MCP_TOKEN` explicitly for any shared environment.

## Tools

| Tool           | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `spike_echo`   | Echo a message, optional delay, returns authenticated principal |
| `spike_whoami` | Sanitized auth context (never the token)                        |
| `spike_slow`   | Timeout/cancellation testing                                    |
| `spike_fail`   | Tool-level error mapping                                        |

## OpenCode configuration

`opencode mcp add` writes project config in this shape. The token below is the
local spike token; do not reuse it anywhere.

```json
{
  "mcp": {
    "servers": {
      "hitman-spike": {
        "type": "remote",
        "url": "http://127.0.0.1:8787/mcp",
        "headers": {
          "Authorization": "Bearer <SPIKE_MCP_TOKEN>"
        }
      }
    }
  }
}
```

Run from the directory containing `opencode.json`:

```bash
opencode mcp list --print-logs
opencode run --auto --model <provider/model> \
  'Call the hitman-spike MCP tool spike_echo with {"message":"opencode-mcp-ok"}.'
```

## Claude Code configuration

Use a temporary config file and strict MCP selection:

```json
{
  "mcpServers": {
    "hitman-spike": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer <SPIKE_MCP_TOKEN>"
      }
    }
  }
}
```

```bash
claude mcp add --transport http hitman-spike http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer <SPIKE_MCP_TOKEN>" -s local
claude mcp list
```

or for print mode:

```bash
claude -p 'Call mcp__hitman-spike__spike_echo with {"message":"claude-mcp-ok"}' \
  --mcp-config /path/to/config.json --strict-mcp-config \
  --allowedTools 'mcp__hitman-spike__spike_echo'
```

## Evidence and limitations

- OpenCode 2.1.4: connected and invoked `spike_echo`.
- Claude Code 2.1.278: `claude mcp list` reported `✔ Connected`; actual model
  invocation in this environment failed because the configured Claude model
  provider returned HTTP 404 for its model. This is not an MCP transport error.
- Tests: `pnpm --filter @hitman/spike-mcp test`.

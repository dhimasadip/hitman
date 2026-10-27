import { buildSpikeApp } from "./server.js";

const token = process.env.SPIKE_MCP_TOKEN ?? "hitman-mcp-spike-dev-token-2026";
const port = Number(process.env.SPIKE_MCP_PORT ?? "8787");
const host = process.env.SPIKE_MCP_HOST ?? "127.0.0.1";

if (token === "hitman-mcp-spike-dev-token-2026") {
  process.stderr.write(
    "[mcp-spike] Using the built-in development token. Set SPIKE_MCP_TOKEN for any shared environment.\n",
  );
}

const { app } = await buildSpikeApp({ token, host });

try {
  const address = await app.listen({ port, host });
  process.stdout.write(
    `${JSON.stringify({
      event: "mcp_spike_listening",
      address,
      endpoint: `${address}/mcp`,
      auth: "Authorization: Bearer <SPIKE_MCP_TOKEN>",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(`[mcp-spike] failed to start: ${String(error)}\n`);
  process.exit(1);
}

const shutdown = async (signal: string): Promise<void> => {
  process.stderr.write(`[mcp-spike] ${signal} received, shutting down\n`);
  await app.close();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

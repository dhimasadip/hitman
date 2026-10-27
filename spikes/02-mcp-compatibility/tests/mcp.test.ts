import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSpikeApp, type SpikeApp } from "../src/server.js";

const token = "spike-test-token-0123456789";
let spike: SpikeApp;
let baseUrl: string;

beforeAll(async () => {
  spike = await buildSpikeApp({ token, host: "127.0.0.1" });
  await spike.app.listen({ port: 0, host: "127.0.0.1" });
  const address = spike.app.server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await spike.app.close();
});

function makeClient(): Client {
  return new Client({ name: "hitman-spike-test-client", version: "0.0.0" });
}

async function connect(client: Client): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  await client.connect(transport);
}

describe("MCP v2 Streamable HTTP spike", () => {
  it("lists the spike tools over the real SDK transport", async () => {
    const client = makeClient();
    await connect(client);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "spike_echo",
      "spike_fail",
      "spike_slow",
      "spike_whoami",
    ]);
    await client.close();
  });

  it("calls a tool and exposes a sanitized principal", async () => {
    const client = makeClient();
    await connect(client);
    const echo = await client.callTool({
      name: "spike_echo",
      arguments: { message: "hello-hitman" },
    });
    expect(echo.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("hello-hitman") }),
    ]);
    expect(JSON.stringify(echo)).not.toContain(token);

    const whoami = await client.callTool({ name: "spike_whoami", arguments: {} });
    const text = whoami.content?.[0];
    expect(text).toMatchObject({ type: "text" });
    if (text && "text" in text) {
      expect(text.text).toContain("spike-dev-user");
      expect(text.text).toContain("protocolEra");
      expect(text.text).not.toContain(token);
    }
    await client.close();
  });

  it("returns tool-level errors without marking the transport broken", async () => {
    const client = makeClient();
    await connect(client);
    const result = await client.callTool({ name: "spike_fail", arguments: { reason: "test" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("rejects requests without a bearer token", async () => {
    const client = new Client({ name: "hitman-spike-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it("reconnects after a client transport close", async () => {
    const first = makeClient();
    await connect(first);
    await first.close();

    const second = makeClient();
    await connect(second);
    const tools = await second.listTools();
    expect(tools.tools.length).toBe(4);
    await second.close();
  });

  it("supports client-side cancellation of a slow tool", async () => {
    const client = makeClient();
    await connect(client);
    const controller = new AbortController();
    const pending = client.callTool(
      { name: "spike_slow", arguments: { delayMs: 2_000 } },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    await client.close();
  });
});

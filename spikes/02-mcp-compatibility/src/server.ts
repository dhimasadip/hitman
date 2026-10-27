import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/fastify";
import { toWebRequest } from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  createMcpHandler,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import * as z from "zod";

export const SPIKE_TOKEN_MIN_LENGTH = 16;

export interface SpikeServerOptions {
  token: string;
  host?: string;
  version?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    spikeAuth?: AuthInfo;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildMcpServer(era: "legacy" | "modern"): McpServer {
  const server = new McpServer({ name: "hitman-mcp-spike", version: "0.0.0" });

  server.registerTool(
    "spike_echo",
    {
      title: "Echo a message",
      description:
        "Returns the provided message and the authenticated principal. Used to verify MCP tool invocation.",
      inputSchema: z.object({
        message: z.string().min(1).max(1_000).describe("Message to echo"),
        delayMs: z
          .number()
          .int()
          .min(0)
          .max(5_000)
          .optional()
          .describe("Optional artificial delay"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ message, delayMs }, ctx) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const principal = ctx.http?.authInfo?.clientId ?? "anonymous";
      const output = { message, principal, serverTime: new Date().toISOString() };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "spike_whoami",
    {
      title: "Show authenticated principal",
      description: "Returns the sanitized MCP authentication context. Never returns the token.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => {
      const auth = ctx.http?.authInfo;
      const output = {
        authenticated: Boolean(auth),
        clientId: auth?.clientId ?? null,
        scopes: auth?.scopes ?? [],
        protocolEra: era,
        protocolMethod: ctx.mcpReq.method,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "spike_slow",
    {
      title: "Slow tool",
      description: "Waits before responding; used to test client timeouts and cancellation.",
      inputSchema: z.object({
        delayMs: z.number().int().min(0).max(10_000),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ delayMs }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { content: [{ type: "text", text: `waited ${delayMs}ms` }] };
    },
  );

  server.registerTool(
    "spike_fail",
    {
      title: "Fail deliberately",
      description: "Always throws a tool error; used to verify error mapping.",
      inputSchema: z.object({ reason: z.string().max(200).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ reason }) => {
      throw new Error(`deliberate spike failure: ${reason ?? "no reason"}`);
    },
  );

  return server;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

function unauthorized(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  reply.header(
    "www-authenticate",
    'Bearer realm="hitman-mcp-spike", error="invalid_token", error_description="A valid bearer token is required"',
  );
  return reply.status(401).send({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: request.id,
  });
}

export async function sendWebResponse(
  response: Response,
  reply: FastifyReply,
): Promise<FastifyReply> {
  reply.hijack();
  reply.raw.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    reply.raw.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) reply.raw.setHeader("set-cookie", cookies);

  if (!response.body) {
    reply.raw.end();
    return reply;
  }

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("error", () => reply.raw.destroy());
  body.pipe(reply.raw);
  return reply;
}

export interface SpikeApp {
  app: FastifyInstance;
  handler: McpHttpHandler;
}

export async function buildSpikeApp(options: SpikeServerOptions): Promise<SpikeApp> {
  if (options.token.length < SPIKE_TOKEN_MIN_LENGTH) {
    throw new Error(`SPIKE_MCP_TOKEN must be at least ${SPIKE_TOKEN_MIN_LENGTH} characters`);
  }

  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 15_000,
  });
  const host = options.host ?? "127.0.0.1";

  app.addHook("onRequest", localhostHostValidation());
  app.addHook("onRequest", localhostOriginValidation());

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/mcp")) return;
    const token = bearerToken(request);
    if (!token || !safeEqual(token, options.token)) {
      return unauthorized(reply, request);
    }
    request.spikeAuth = {
      token,
      clientId: "spike-dev-user",
      scopes: ["mcp"],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  });

  const handler = createMcpHandler((ctx) => buildMcpServer(ctx.era), {
    legacy: "stateless",
    maxRequestBodySize: 1024 * 1024,
    onerror: (error) => {
      // The spike uses stderr logging only; production will use the shared logger.
      process.stderr.write(`[mcp-spike] ${error.message}\n`);
    },
  });

  app.all("/mcp", async (request, reply) => {
    try {
      const webRequest = await toWebRequest(request.raw, request.body);
      const response = await handler.fetch(webRequest, {
        ...(request.spikeAuth ? { authInfo: request.spikeAuth } : {}),
      });
      return await sendWebResponse(response, reply);
    } catch (error) {
      request.log.error({ err: error }, "mcp request failed");
      return reply.status(500).send({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      });
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "hitman-mcp-spike", host }));
  app.get("/spike/info", async () => ({
    service: "hitman-mcp-spike",
    version: options.version ?? "0.0.0",
    transport: "streamable-http",
    endpoint: "/mcp",
    auth: "bearer",
  }));

  app.addHook("onClose", async () => {
    await handler.close();
  });

  return { app, handler };
}

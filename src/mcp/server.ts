import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { EndpointMap, RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import { inputSchema, exposedEndpoints } from "../endpoints/catalog.js";
import { EndpointInvoker } from "../endpoints/invoker.js";
import { FetchTransport } from "../http/fetch-transport.js";
import { HybridTransport } from "../http/hybrid-transport.js";
import { AuthRequiredError, ReauthRequiredError } from "../errors.js";

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function authUrl(runtime: RuntimeConfig): string {
  return `http://${runtime.daemon.healthHost}:${runtime.daemon.healthPort}/auth/form`;
}

const AGENT_INSTRUCTIONS = [
  "Normal path: call the single fomo_* data tool that matches the user's request using its exact schema fields; do not add an auth-status call first.",
  "The transport performs one bounded session refresh automatically when possible.",
  "If a data tool returns reauthRequired, call fomo_auth_start, give authUrl to the user, and wait for the user to complete authorization.",
  "Poll fomo_auth_status until ready is true, then retry the original data tool once.",
  "All data tools are read-only. Never call internal catalog records, expose credentials, or invent route parameters.",
  "Successful data results always contain data and meta; use meta.status, meta.endpointId, meta.requestId, and meta.attempts as execution evidence.",
].join(" ");

const authStatusOutput = z.object({
  ready: z.boolean(),
  nextAction: z.enum(["call_data_tool", "start_authorization"]),
  available: z.boolean(),
  source: z.string(),
  hasIdentityToken: z.boolean(),
  hasAccessToken: z.boolean(),
  hasRefreshToken: z.boolean(),
  cookieCount: z.number(),
  updatedAt: z.string().optional(),
  accessTokenExpiresAt: z.string().optional(),
  refreshTokenExpiresAt: z.string().optional(),
  identityTokenExpiresAt: z.string().optional(),
  reauthRequired: z.boolean(),
});

const authStartOutput = z.object({
  status: z.literal("authorization_required"),
  nextAction: z.literal("open_auth_url_and_poll"),
  authUrl: z.string(),
  poll: z.object({
    tool: z.literal("fomo_auth_status"),
    intervalMs: z.number(),
    stopWhen: z.literal("ready=true"),
  }),
  requiresUser: z.literal(true),
  secretsReturned: z.literal(false),
  instructions: z.string(),
});

function authStatusResult(status: Awaited<ReturnType<AuthManager["status"]>>): z.infer<typeof authStatusOutput> {
  const ready = status.available && !status.reauthRequired;
  return {
    ...status,
    ready,
    nextAction: ready ? "call_data_tool" : "start_authorization",
  };
}

function authRequiredResult(runtime: RuntimeConfig, error: unknown): Record<string, unknown> {
  return {
    error: errorText(error),
    reauthRequired: true,
    ready: false,
    nextAction: "start_authorization",
    authUrl: authUrl(runtime),
    instructions: "Call fomo_auth_start, give authUrl to the user, poll fomo_auth_status until ready=true, then retry the original data tool once.",
  };
}

export async function createMcpServer(runtime: RuntimeConfig, endpointMap: EndpointMap): Promise<McpServer> {
  const auth = new AuthManager(runtime);
  await auth.initialize();
  const transport = runtime.transport.mode === "hybrid"
    ? new HybridTransport(runtime, auth)
    : new FetchTransport(runtime, auth);
  const invoker = new EndpointInvoker(runtime, transport);
  const server = new McpServer({ name: runtime.mcp.name, version: runtime.mcp.version }, { instructions: AGENT_INSTRUCTIONS });
  server.registerTool("fomo_auth_status", {
    title: "Authentication status",
    description: "Optional readiness check before or after user authorization. Returns ready and nextAction; never returns token values.",
    inputSchema: {},
    outputSchema: authStatusOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const result = authStatusResult(await auth.status());
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
  });
  server.registerTool("fomo_auth_start", {
    title: "Get authorization link",
    description: "Use only when fomo_auth_status.ready is false or a data tool returns reauthRequired. Returns one auth URL and the polling contract.",
    inputSchema: {},
    outputSchema: authStartOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const result = {
      status: "authorization_required" as const,
      nextAction: "open_auth_url_and_poll" as const,
      authUrl: authUrl(runtime),
      poll: { tool: "fomo_auth_status" as const, intervalMs: 1000, stopWhen: "ready=true" as const },
      requiresUser: true as const,
      secretsReturned: false as const,
      instructions: "Open authUrl in the user's local browser, complete FOMO authorization, then poll fomo_auth_status until ready=true.",
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
  });
  for (const endpoint of exposedEndpoints(endpointMap.endpoints, runtime.mcp.includeMutationTools, runtime.mcp.includeInternalEndpoints)) {
    server.registerTool(endpoint.tool as string, {
      title: endpoint.tool as string,
      description: `[${endpoint.category}] ${endpoint.description} Read-only ${endpoint.method}; returns {data,meta}.`,
      inputSchema: inputSchema(endpoint),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: endpoint.method === "GET", openWorldHint: true },
    }, async (args) => {
      try {
        const result = await invoker.invoke(endpoint, args as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (error) {
        const reauth = error instanceof AuthRequiredError || error instanceof ReauthRequiredError;
        const structured = reauth ? authRequiredResult(runtime, error) : undefined;
        const text = structured ? JSON.stringify(structured, null, 2) : errorText(error);
        return { isError: true, content: [{ type: "text" as const, text }], ...(structured ? { structuredContent: structured } : {}) };
      }
    });
  }
  return server;
}

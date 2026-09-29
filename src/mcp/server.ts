import { McpServer } from "@modelcontextprotocol/server";
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

export async function createMcpServer(runtime: RuntimeConfig, endpointMap: EndpointMap): Promise<McpServer> {
  const auth = new AuthManager(runtime);
  await auth.initialize();
  const transport = runtime.transport.mode === "hybrid"
    ? new HybridTransport(runtime, auth)
    : new FetchTransport(runtime, auth);
  const invoker = new EndpointInvoker(runtime, transport);
  const server = new McpServer({ name: runtime.mcp.name, version: runtime.mcp.version });
  server.registerTool("fomo_auth_status", {
    description: "Read authentication availability and expiry metadata. Secret values are never returned.",
    inputSchema: {},
  }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify(await auth.status(), null, 2) }] }));
  server.registerTool("fomo_auth_start", {
    description: "Get a local authorization link. The user completes login in a separate visible browser window.",
    inputSchema: {},
  }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify({
    authUrl: authUrl(runtime),
    instructions: "Open authUrl in the user's local browser and complete the FOMO login. Poll fomo_auth_status afterwards.",
  }, null, 2) }] }));
  for (const endpoint of exposedEndpoints(endpointMap.endpoints, runtime.mcp.includeMutationTools, runtime.mcp.includeInternalEndpoints)) {
    server.registerTool(endpoint.tool as string, {
      description: `${endpoint.description} Response: ${endpoint.response.type}.`,
      inputSchema: inputSchema(endpoint),
    }, async (args) => {
      try {
        const result = await invoker.invoke(endpoint, args as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const reauth = error instanceof AuthRequiredError || error instanceof ReauthRequiredError;
        const text = reauth
          ? JSON.stringify({
            error: errorText(error),
            reauthRequired: true,
            authUrl: authUrl(runtime),
            instructions: "Open authUrl in the user's local browser and complete FOMO authorization, then retry.",
          }, null, 2)
          : errorText(error);
        return { isError: true, content: [{ type: "text" as const, text }] };
      }
    });
  }
  return server;
}

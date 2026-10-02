import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { EndpointMap, RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import { BROWSER_LOGIN_STATUSES } from "../auth/browser-login.js";
import { inputSchema, exposedEndpoints } from "../endpoints/catalog.js";
import { EndpointInvoker } from "../endpoints/invoker.js";
import { FetchTransport } from "../http/fetch-transport.js";
import { HybridTransport } from "../http/hybrid-transport.js";
import { AuthRequiredError, ReauthRequiredError } from "../errors.js";

const browserFlowSchema = z.object({ id: z.string(), status: z.enum(BROWSER_LOGIN_STATUSES), error: z.string().optional() });
type BrowserFlowSnapshot = z.infer<typeof browserFlowSchema>;
const browserOutputSchema = z.object({
  started: z.boolean(),
  flowId: z.string().optional(),
  status: z.enum(BROWSER_LOGIN_STATUSES).optional(),
  error: z.string().optional(),
});

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function authUrl(runtime: RuntimeConfig): string {
  return `${daemonAuthUrl(runtime)}/auth/form`;
}

function toolResult<T extends object>(result: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
}

const AGENT_INSTRUCTIONS = [
  "Normal path: call the single fomo_* data tool that matches the user's request using its exact schema fields; do not add an auth-status call first.",
  "The transport performs one bounded session refresh automatically when possible.",
  "When identity authorization expires, the gateway starts the visible headed browser flow automatically. Tell the user to complete the sign-in window, poll fomo_auth_status until ready is true, then retry the original data tool once.",
  "All data tools are read-only. Never call internal catalog records, expose credentials, or invent route parameters.",
  "Preserve upstream data, including pagination and pinned records. Any filtering, aggregation, normalization or sentiment analysis is agent-derived, never FOMO data.",
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
  browser: browserOutputSchema.optional(),
  authUrl: z.string().optional(),
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
  browser: browserOutputSchema,
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

function daemonAuthUrl(runtime: RuntimeConfig): string {
  return `http://${runtime.daemon.healthHost}:${runtime.daemon.healthPort}`;
}

async function browserFlowRequest(runtime: RuntimeConfig, flowId?: string): Promise<BrowserFlowSnapshot> {
  try {
    const route = flowId ? `/auth/session/${encodeURIComponent(flowId)}` : "/auth/session/start";
    const response = await fetch(`${daemonAuthUrl(runtime)}${route}`, {
      method: flowId ? "GET" : "POST",
      signal: AbortSignal.timeout(runtime.http.requestTimeoutMs),
    });
    const parsed = browserFlowSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success) {
      throw new Error(`Auth daemon returned HTTP ${response.status} or an invalid browser flow`);
    }
    return parsed.data;
  } catch (error) {
    return {
      id: "",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function browserOutput(flow: BrowserFlowSnapshot): z.infer<typeof browserOutputSchema> {
  return {
    started: Boolean(flow.id) && flow.status !== "failed",
    ...(flow.id ? { flowId: flow.id } : {}),
    ...(flow.status ? { status: flow.status } : {}),
    ...(flow.error ? { error: flow.error } : {}),
  };
}

async function authRequiredResult(
  runtime: RuntimeConfig,
  error: unknown,
  ensureBrowserFlow: () => Promise<BrowserFlowSnapshot>,
): Promise<Record<string, unknown>> {
  const flow = await ensureBrowserFlow();
  const browser = browserOutput(flow);
  return {
    error: errorText(error),
    reauthRequired: true,
    ready: false,
    nextAction: "start_authorization",
    authUrl: authUrl(runtime),
    browser,
    instructions: browser.started
      ? "Complete the visible FOMO sign-in window, poll fomo_auth_status until ready=true, then retry the original data tool once."
      : "Open authUrl in the user's local browser, complete authorization, poll fomo_auth_status until ready=true, then retry the original data tool once.",
  };
}

export async function createMcpServer(runtime: RuntimeConfig, endpointMap: EndpointMap): Promise<McpServer> {
  const auth = new AuthManager(runtime);
  await auth.initialize();
  let browserFlow: BrowserFlowSnapshot | undefined;
  let browserFlowInFlight: Promise<BrowserFlowSnapshot> | undefined;
  const ensureBrowserFlow = async (force = false): Promise<BrowserFlowSnapshot> => {
    if (browserFlowInFlight) return browserFlowInFlight;
    if (!force && browserFlow?.status === "failed") return browserFlow;
    const activeId = !force && browserFlow?.status !== "captured" ? browserFlow?.id : undefined;
    browserFlowInFlight = browserFlowRequest(runtime, activeId);
    try {
      browserFlow = await browserFlowInFlight;
      return browserFlow;
    } finally {
      browserFlowInFlight = undefined;
    }
  };
  const transport = runtime.transport.mode === "hybrid"
    ? new HybridTransport(runtime, auth)
    : new FetchTransport(runtime, auth);
  const invoker = new EndpointInvoker(runtime, transport);
  const server = new McpServer({ name: runtime.mcp.name, version: runtime.mcp.version }, { instructions: AGENT_INSTRUCTIONS });
  server.registerTool("fomo_auth_status", {
    title: "Authentication status",
    description: "Readiness check before or after user authorization. When authorization is required, starts the visible headed browser flow and returns its status; never returns token values.",
    inputSchema: {},
    outputSchema: authStatusOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const status = await auth.status();
    if (!status.reauthRequired) browserFlow = undefined;
    const flow = status.reauthRequired ? await ensureBrowserFlow() : undefined;
    const result = {
      ...authStatusResult(status),
      ...(flow ? { browser: browserOutput(flow), authUrl: authUrl(runtime) } : {}),
    };
    return toolResult(result);
  });
  server.registerTool("fomo_auth_start", {
    title: "Start authorization",
    description: "Starts the visible headed browser authorization flow when possible and returns the local fallback URL plus polling contract. Never returns token values.",
    inputSchema: {},
    outputSchema: authStartOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const flow = await ensureBrowserFlow(true);
    const browser = browserOutput(flow);
    const result = {
      status: "authorization_required" as const,
      nextAction: "open_auth_url_and_poll" as const,
      authUrl: authUrl(runtime),
      poll: { tool: "fomo_auth_status" as const, intervalMs: 1000, stopWhen: "ready=true" as const },
      requiresUser: true as const,
      secretsReturned: false as const,
      browser,
      instructions: browser.started
        ? "Complete the visible FOMO sign-in window, then poll fomo_auth_status until ready=true."
        : "Open authUrl in the user's local browser, complete FOMO authorization, then poll fomo_auth_status until ready=true.",
    };
    return toolResult(result);
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
        return toolResult(result);
      } catch (error) {
        const reauth = error instanceof AuthRequiredError || error instanceof ReauthRequiredError;
        const structured = reauth ? await authRequiredResult(runtime, error, ensureBrowserFlow) : undefined;
        const text = structured ? JSON.stringify(structured, null, 2) : errorText(error);
        return { isError: true, content: [{ type: "text" as const, text }], ...(structured ? { structuredContent: structured } : {}) };
      }
    });
  }
  return server;
}

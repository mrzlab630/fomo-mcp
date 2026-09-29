import type { EndpointConfig, RuntimeConfig } from "../config/types.js";
import { UpstreamResponseError } from "../errors.js";
import type { Transport } from "../http/transport.js";
import { assertReadOnly, buildRequest } from "./catalog.js";

function toUrl(runtime: RuntimeConfig, endpoint: EndpointConfig, path: string, query: Record<string, unknown>): string {
  const base = runtime.apiBases[endpoint.base];
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parsePayload(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text) as unknown; }
  catch { return text; }
}

function unwrapEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.success === false) throw new UpstreamResponseError(String(record.message ?? "Upstream returned success=false"));
  return record.responseObject ?? value;
}

export interface EndpointResult {
  data: unknown;
  meta: {
    endpointId: string;
    source: string;
    fetchedAt: string;
    status: number;
    requestId: string;
    attempts: number;
    responseType: string;
  };
}

export class EndpointInvoker {
  constructor(private readonly runtime: RuntimeConfig, private readonly transport: Transport) {}

  async invoke(endpoint: EndpointConfig, args: Record<string, unknown>): Promise<EndpointResult> {
    assertReadOnly(endpoint);
    const built = buildRequest(endpoint, args);
    const url = toUrl(this.runtime, endpoint, built.path, built.query);
    const response = await this.transport.request({
      method: endpoint.method,
      url,
      auth: endpoint.auth,
      body: built.body,
      retryable: endpoint.method === "GET" || endpoint.sideEffect === "none",
    });
    if (response.status < 200 || response.status >= 300) {
      const payload = parsePayload(response.body);
      throw new UpstreamResponseError(
        `Endpoint ${endpoint.id} returned HTTP ${response.status}: ${typeof payload === "string" ? payload.slice(0, 500) : JSON.stringify(payload).slice(0, 500)}`,
        { status: response.status, requestId: response.requestId },
      );
    }
    return {
      data: unwrapEnvelope(parsePayload(response.body)),
      meta: {
        endpointId: endpoint.id,
        source: endpoint.base,
        fetchedAt: new Date().toISOString(),
        status: response.status,
        requestId: response.requestId,
        attempts: response.attempts,
        responseType: endpoint.response.type,
      },
    };
  }
}

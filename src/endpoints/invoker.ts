import type { EndpointConfig, EndpointScope, RuntimeConfig } from "../config/types.js";
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

function validHeaderDate(value: string | null): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function cacheAgeSeconds(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

function freshnessMetadata(headers: Headers, observedAt: string): {
  basis: "provider-reported" | "client-observed";
  observedAt: string;
  providerReportedAt?: string;
  providerLastModified?: string;
  cacheAgeSeconds?: number;
} {
  const providerReportedAt = validHeaderDate(headers.get("date"));
  const providerLastModified = validHeaderDate(headers.get("last-modified"));
  const cacheAge = cacheAgeSeconds(headers.get("age"));
  return {
    basis: providerReportedAt || providerLastModified ? "provider-reported" : "client-observed",
    observedAt,
    ...(providerReportedAt ? { providerReportedAt } : {}),
    ...(providerLastModified ? { providerLastModified } : {}),
    ...(cacheAge === undefined ? {} : { cacheAgeSeconds: cacheAge }),
  };
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
    provenance: {
      data: "upstream";
      metadata: "mcp_generated";
    };
    scope: {
      value: EndpointScope | "unknown";
      source: "mcp_catalog";
    };
    freshness: ReturnType<typeof freshnessMetadata>;
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
    const fetchedAt = new Date().toISOString();
    return {
      data: unwrapEnvelope(parsePayload(response.body)),
      meta: {
        endpointId: endpoint.id,
        source: endpoint.base,
        fetchedAt,
        status: response.status,
        requestId: response.requestId,
        attempts: response.attempts,
        responseType: endpoint.response.type,
        provenance: {
          data: "upstream",
          metadata: "mcp_generated",
        },
        scope: {
          value: endpoint.mcpMetadata?.scope ?? "unknown",
          source: "mcp_catalog",
        },
        freshness: freshnessMetadata(response.headers, fetchedAt),
      },
    };
  }
}

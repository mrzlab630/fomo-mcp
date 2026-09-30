import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import { AuthRequiredError, ReauthRequiredError, TransportError } from "../errors.js";
import type { Transport, TransportRequest, TransportResponse } from "./transport.js";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TransportError(`Response exceeded configured limit of ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class FetchTransport implements Transport {
  constructor(private readonly runtime: RuntimeConfig, private readonly auth: AuthManager) {}

  async request(request: TransportRequest): Promise<TransportResponse> {
    const requestId = randomUUID();
    const attemptsAllowed = request.retryable ? this.runtime.http.maxRetries + 1 : 1;
    const authRetryAllowed = request.retryable && request.auth !== "none";
    const maxAttempts = attemptsAllowed + (authRetryAllowed ? 1 : 0);
    let authRetried = false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.runtime.http.requestTimeoutMs);
      try {
        await this.auth.ensureSession(request.auth);
        const headers: Record<string, string> = {
          accept: "application/json",
          origin: this.runtime.http.origin,
          referer: this.runtime.http.referer,
          "user-agent": this.runtime.http.userAgent,
          "x-request-id": requestId,
        };
        if (request.body !== undefined) headers["content-type"] = "application/json";
        if (request.auth === "identity") headers.authorization = `Bearer ${await this.auth.identityToken()}`;
        if (request.auth === "access") headers.authorization = `Bearer ${await this.auth.accessToken()}`;
        const cookies = await this.auth.cookiesFor(request.url);
        if (cookies) headers.cookie = cookies;
        const response = await fetch(request.url, {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: controller.signal,
        });
        await this.auth.updateCookies(response.headers, request.url);
        if (response.status === 401) {
          if (authRetryAllowed && !authRetried) {
            authRetried = true;
            await this.auth.refreshSession();
            continue;
          }
          throw new ReauthRequiredError("Upstream returned HTTP 401; identity token re-authentication is required");
        }
        if (RETRYABLE_STATUSES.has(response.status) && attempt < attemptsAllowed) {
          const serverDelay = this.runtime.http.respectRetryAfter ? retryAfterMs(response.headers) : undefined;
          await delay(serverDelay ?? this.runtime.http.retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const body = await readBody(response, this.runtime.http.maxResponseBytes);
        return { status: response.status, url: request.url, requestId, body, headers: response.headers, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (error instanceof AuthRequiredError || error instanceof ReauthRequiredError || error instanceof TransportError || attempt >= maxAttempts) {
          throw error;
        }
        await delay(this.runtime.http.retryBaseDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new TransportError(`Transport failed after ${attemptsAllowed} attempts: ${String(lastError)}`, { requestId });
  }
}

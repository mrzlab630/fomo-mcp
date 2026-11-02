import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import { AuthRequiredError, ReauthRequiredError, TransportError } from "../errors.js";
import type { Transport, TransportRequest, TransportResponse } from "./transport.js";
import { RETRYABLE_STATUSES, retryDelayMs } from "./retry-policy.js";
import { readBoundedBody } from "./bounded-fetch.js";

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
        const token = await this.auth.ensureSession(request.auth);
        const headers: Record<string, string> = {
          accept: "application/json",
          origin: this.runtime.http.origin,
          referer: this.runtime.http.referer,
          "user-agent": this.runtime.http.userAgent,
          "x-request-id": requestId,
        };
        if (request.body !== undefined) headers["content-type"] = "application/json";
        if (token) headers.authorization = `Bearer ${token}`;
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
          await response.body?.cancel();
          if (authRetryAllowed && !authRetried) {
            authRetried = true;
            await this.auth.refreshSession();
            continue;
          }
          throw new ReauthRequiredError("Upstream returned HTTP 401; identity token re-authentication is required");
        }
        if (RETRYABLE_STATUSES.has(response.status) && attempt < attemptsAllowed) {
          await response.body?.cancel();
          await delay(retryDelayMs(this.runtime.http, attempt, response.headers.get("retry-after")));
          continue;
        }
        const body = await readBoundedBody(response, this.runtime.http.maxResponseBytes, controller.signal);
        return { status: response.status, url: request.url, requestId, body, headers: response.headers, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (error instanceof AuthRequiredError || error instanceof ReauthRequiredError || error instanceof TransportError || attempt >= maxAttempts) {
          throw error;
        }
        await delay(retryDelayMs(this.runtime.http, attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new TransportError(`Transport failed after ${attemptsAllowed} attempts: ${String(lastError)}`, { requestId });
  }
}

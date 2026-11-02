export const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function retryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(MAX_TIMER_DELAY_MS, Math.max(0, date - Date.now())) : undefined;
}
import type { RuntimeConfig } from "../config/types.js";

export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** Retry sleeps never exceed the configured per-request timeout or Node's timer range. */
export function retryDelayMs(http: RuntimeConfig["http"], attempt: number, value?: string | null): number {
  const requested = http.respectRetryAfter ? retryAfterMs(value) : undefined;
  return Math.max(0, Math.min(MAX_TIMER_DELAY_MS, http.requestTimeoutMs, requested ?? http.retryBaseDelayMs * 2 ** (attempt - 1)));
}

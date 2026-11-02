import { randomBytes, createHash } from "node:crypto";
import type { RuntimeConfig, AuthStatus, StoredCookie } from "../config/types.js";
import { AuthManager, identityTokenIsCurrent, sessionTokensFromCookies } from "./auth-manager.js";
import { privyHeaders } from "./privy-headers.js";
import { cookieHeader, getSetCookieHeaders, mergeSetCookies } from "./cookie-jar.js";
import { boundedFetch } from "../http/bounded-fetch.js";

export type ManualOAuthStatus = "starting" | "awaiting_login" | "captured" | "failed";

export interface ManualOAuthSnapshot {
  id: string;
  status: ManualOAuthStatus;
  startedAt: string;
  updatedAt: string;
  authorizationUrl?: string;
  error?: string;
  auth?: AuthStatus;
}

interface PendingOAuth {
  verifier: string;
  state: string;
  snapshot: ManualOAuthSnapshot;
  cookies: StoredCookie[];
  expiresAt: number;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function now(): string {
  return new Date().toISOString();
}

export class ManualOAuthManager {
  private readonly flows = new Map<string, PendingOAuth>();

  constructor(private readonly runtime: RuntimeConfig, private readonly auth: AuthManager) {}

  async create(provider = "google"): Promise<ManualOAuthSnapshot> {
    const id = crypto.randomUUID();
    const startedAt = now();
    const snapshot: ManualOAuthSnapshot = { id, status: "starting", startedAt, updatedAt: startedAt };
    const verifier = randomBytes(36).toString("base64url");
    const state = randomBytes(36).toString("base64url");
    const pending: PendingOAuth = {
      verifier, state, snapshot, cookies: await this.auth.browserCookies(),
      expiresAt: Date.now() + this.runtime.auth.browserLoginTimeoutMs,
    };
    this.flows.set(id, pending);
    try {
      const endpoint = `${this.runtime.apiBases.privy}/api/v1/oauth/init`;
      const cookies = cookieHeader(pending.cookies, endpoint);
      const { response, body } = await boundedFetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { ...privyHeaders(this.runtime), ...(cookies ? { cookie: cookies } : {}) },
        body: JSON.stringify({
          redirect_to: `${this.runtime.http.origin}/favicon.ico`,
          provider,
          code_challenge: pkceChallenge(verifier),
          state_code: state,
        }),
      }, this.runtime.http.requestTimeoutMs, this.runtime.http.maxResponseBytes);
      pending.cookies = mergeSetCookies(pending.cookies, getSetCookieHeaders(response.headers), endpoint);
      let data: { url?: unknown };
      try { data = JSON.parse(body) as { url?: unknown }; }
      catch { throw new Error(`Privy OAuth init returned invalid JSON with HTTP ${response.status}`); }
      if (!response.ok || typeof data.url !== "string") {
        throw new Error(`Privy OAuth init failed with HTTP ${response.status}; no authorization URL`);
      }
      snapshot.status = "awaiting_login";
      snapshot.authorizationUrl = data.url;
      snapshot.updatedAt = now();
      return snapshot;
    } catch (error) {
      snapshot.status = "failed";
      snapshot.error = error instanceof Error ? error.message : String(error);
      snapshot.updatedAt = now();
      pending.verifier = "";
      pending.state = "";
      pending.cookies = [];
      return snapshot;
    }
  }

  get(id: string): ManualOAuthSnapshot | undefined {
    const pending = this.flows.get(id);
    if (pending?.snapshot.status === "awaiting_login" && Date.now() >= pending.expiresAt) {
      pending.snapshot.status = "failed";
      pending.snapshot.error = "OAuth flow expired; start a new authorization flow";
      pending.snapshot.updatedAt = now();
      pending.verifier = "";
      pending.state = "";
      pending.cookies = [];
      delete pending.snapshot.authorizationUrl;
    }
    return pending?.snapshot;
  }

  async complete(id: string, rawUrl: string): Promise<ManualOAuthSnapshot> {
    const pending = this.flows.get(id);
    if (!pending) throw new Error("OAuth flow is no longer active");
    this.get(id);
    if (pending.snapshot.status !== "awaiting_login") throw new Error("OAuth exchange already attempted or expired; start a new authorization flow");
    const callback = new URL(rawUrl);
    if (callback.origin !== "https://fomo.family" || callback.username || callback.password
      || !["/token", "/favicon.ico"].includes(callback.pathname)) {
      throw new Error("Redirect URL must point to https://fomo.family/favicon.ico or https://fomo.family/token");
    }
    const code = callback.searchParams.get("privy_oauth_code");
    const returnedState = callback.searchParams.get("privy_oauth_state");
    if (!code || !returnedState) throw new Error("Redirect URL does not contain Privy OAuth parameters");
    if (returnedState !== pending.state) throw new Error("OAuth state mismatch; start a new authorization flow");
    pending.snapshot.status = "starting";
    pending.snapshot.updatedAt = now();
    try {
      const endpoint = `${this.runtime.apiBases.privy}/api/v1/oauth/authenticate`;
      const cookies = cookieHeader(pending.cookies, endpoint);
      const { response, body } = await boundedFetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { ...privyHeaders(this.runtime), ...(cookies ? { cookie: cookies } : {}) },
        body: JSON.stringify({
          authorization_code: code,
          state_code: pending.state,
          code_verifier: pending.verifier,
          mode: "login-or-sign-up",
        }),
      }, this.runtime.http.requestTimeoutMs, this.runtime.http.maxResponseBytes);
      let data: Record<string, unknown>;
      try { data = JSON.parse(body) as Record<string, unknown>; }
      catch { throw new Error(`Privy OAuth authenticate returned invalid JSON with HTTP ${response.status}`); }
      if (!response.ok) {
        const errorCode = typeof data.error_code === "string" ? data.error_code : undefined;
        throw new Error(`Privy OAuth authenticate failed with HTTP ${response.status}${errorCode ? ` (${errorCode})` : ""}`);
      }
      const responseCookies = mergeSetCookies(pending.cookies, getSetCookieHeaders(response.headers), endpoint);
      const cookieTokens = sessionTokensFromCookies(mergeSetCookies([], getSetCookieHeaders(response.headers), endpoint), this.runtime);
      const idToken = typeof data.token === "string" && data.token.length > 0 ? data.token : cookieTokens.idToken;
      const accessToken = ["privy_access_token", "access_token", "accessToken"]
        .map((key) => data[key]).find((value): value is string => typeof value === "string" && value.length > 0) ?? cookieTokens.accessToken;
      const refreshToken = ["refresh_token", "refreshToken"]
        .map((key) => data[key]).find((value): value is string => typeof value === "string" && value.length > 0) ?? cookieTokens.refreshToken;
      if (!idToken || !accessToken || !refreshToken) {
        const present = Object.keys(data).sort().join(", ");
        throw new Error(`Privy OAuth response did not contain a complete token set (fields: ${present})`);
      }
      if (!identityTokenIsCurrent(idToken)) {
        throw new Error("Privy OAuth returned an expired or unreadable identity token; start a new authorization flow");
      }
      await this.auth.importState({
        idToken,
        accessToken,
        refreshToken,
        cookies: responseCookies,
        caId: typeof data.privy_ca_id === "string" ? data.privy_ca_id : undefined,
      }, "manual-import");
      pending.snapshot.auth = await this.auth.status();
      pending.snapshot.status = "captured";
      pending.snapshot.updatedAt = now();
      return pending.snapshot;
    } catch (error) {
      pending.snapshot.status = "failed";
      pending.snapshot.error = error instanceof Error ? error.message : String(error);
      pending.snapshot.updatedAt = now();
      return pending.snapshot;
    } finally {
      pending.verifier = "";
      pending.state = "";
      pending.cookies = [];
      delete pending.snapshot.authorizationUrl;
    }
  }

}

import { randomBytes, createHash } from "node:crypto";
import type { RuntimeConfig, AuthStatus } from "../config/types.js";
import { AuthManager } from "./auth-manager.js";

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
  provider: string;
  snapshot: ManualOAuthSnapshot;
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
    this.flows.set(id, { verifier, state, provider, snapshot });
    try {
      const response = await fetch(`${this.runtime.apiBases.privy}/api/v1/oauth/init`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          redirect_to: `${this.runtime.http.origin}/favicon.ico`,
          provider,
          code_challenge: pkceChallenge(verifier),
          state_code: state,
        }),
      });
      const data = await response.json() as { url?: unknown; error?: unknown };
      if (!response.ok || typeof data.url !== "string") {
        throw new Error(`Privy OAuth init failed with HTTP ${response.status}: ${String(data.error ?? "no authorization URL")}`);
      }
      snapshot.status = "awaiting_login";
      snapshot.authorizationUrl = data.url;
      snapshot.updatedAt = now();
      return snapshot;
    } catch (error) {
      snapshot.status = "failed";
      snapshot.error = error instanceof Error ? error.message : String(error);
      snapshot.updatedAt = now();
      return snapshot;
    }
  }

  get(id: string): ManualOAuthSnapshot | undefined {
    return this.flows.get(id)?.snapshot;
  }

  async complete(id: string, rawUrl: string): Promise<ManualOAuthSnapshot> {
    const pending = this.flows.get(id);
    if (!pending) throw new Error("OAuth flow is no longer active");
    const callback = new URL(rawUrl);
    if (callback.protocol !== "https:" || callback.hostname !== "fomo.family" || !["/token", "/favicon.ico"].includes(callback.pathname)) {
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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          authorization_code: code,
          state_code: pending.state,
          code_verifier: pending.verifier,
          mode: "login-or-sign-up",
        }),
      });
      await this.auth.updateCookies(response.headers, endpoint);
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        const errorCode = typeof data.error_code === "string" ? data.error_code : undefined;
        throw new Error(`Privy OAuth authenticate failed with HTTP ${response.status}${errorCode ? ` (${errorCode})` : ""}`);
      }
      const idToken = typeof data.token === "string" && data.token.length > 0 ? data.token : undefined;
      const accessToken = ["privy_access_token", "access_token", "accessToken", "token"]
        .map((key) => data[key]).find((value): value is string => typeof value === "string" && value.length > 0);
      const refreshToken = ["refresh_token", "refreshToken"]
        .map((key) => data[key]).find((value): value is string => typeof value === "string" && value.length > 0);
      if (!idToken || !accessToken || !refreshToken) {
        const present = Object.keys(data).sort().join(", ");
        throw new Error(`Privy OAuth response did not contain a complete token set (fields: ${present})`);
      }
      await this.auth.importState({
        idToken,
        accessToken,
        refreshToken,
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
    }
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json",
      origin: this.runtime.http.origin,
      referer: this.runtime.http.referer,
      "privy-client": this.runtime.auth.privyClient,
      "privy-app-id": this.runtime.auth.privyAppId,
      "privy-client-id": this.runtime.auth.privyClientId,
      "user-agent": this.runtime.http.userAgent,
    };
  }
}

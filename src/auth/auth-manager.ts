import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuthMode, AuthState, AuthStatus, RuntimeConfig, StoredCookie } from "../config/types.js";
import { resolveConfiguredPath } from "../config/load.js";
import { AuthRequiredError, ReauthRequiredError, TransportError } from "../errors.js";
import { EncryptedJsonStore } from "./encrypted-store.js";
import { getSetCookieHeaders, mergeSetCookies, cookieHeader } from "./cookie-jar.js";
import { privyHeaders } from "./privy-headers.js";

interface PrivyRefreshResponse {
  token?: string;
  privy_access_token?: string;
  refresh_token?: string;
  identity_token?: string;
}

function parseEnvironmentCookies(): StoredCookie[] {
  const raw = process.env.FOMO_COOKIES_JSON;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("FOMO_COOKIES_JSON must be a JSON array");
  return parsed as StoredCookie[];
}

function environmentState(): AuthState | null {
  const idToken = process.env.FOMO_ID_TOKEN?.trim();
  const accessToken = process.env.FOMO_ACCESS_TOKEN?.trim();
  const refreshToken = process.env.FOMO_REFRESH_TOKEN?.trim();
  if (!idToken && !accessToken && !refreshToken && !process.env.FOMO_COOKIES_JSON) return null;
  if (accessToken && !refreshToken) throw new Error("FOMO_ACCESS_TOKEN requires FOMO_REFRESH_TOKEN");
  if (refreshToken && !accessToken) throw new Error("FOMO_REFRESH_TOKEN requires FOMO_ACCESS_TOKEN");
  return {
    version: 1,
    source: "environment",
    idToken,
    accessToken,
    refreshToken,
    caId: process.env.FOMO_CA_ID,
    cookies: parseEnvironmentCookies(),
    updatedAt: new Date().toISOString(),
    accessTokenExpiresAt: tokenExpiry(accessToken),
    refreshTokenExpiresAt: tokenExpiry(refreshToken),
    identityTokenExpiresAt: tokenExpiry(idToken),
  };
}

function tokenExpiry(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function safeState(input: Partial<AuthState>, source: AuthState["source"] = "manual-import"): AuthState {
  return {
    version: 1,
    source,
    idToken: input.idToken,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    caId: input.caId,
    cookies: Array.isArray(input.cookies) ? input.cookies : [],
    updatedAt: new Date().toISOString(),
    accessTokenExpiresAt: input.accessTokenExpiresAt ?? tokenExpiry(input.accessToken),
    refreshTokenExpiresAt: input.refreshTokenExpiresAt ?? tokenExpiry(input.refreshToken),
    identityTokenExpiresAt: input.identityTokenExpiresAt ?? tokenExpiry(input.idToken),
  };
}

function deriveExpiryMetadata(state: AuthState | null): AuthState | null {
  if (!state) return null;
  return {
    ...state,
    accessTokenExpiresAt: state.accessTokenExpiresAt ?? tokenExpiry(state.accessToken),
    refreshTokenExpiresAt: state.refreshTokenExpiresAt ?? tokenExpiry(state.refreshToken),
    identityTokenExpiresAt: state.identityTokenExpiresAt ?? tokenExpiry(state.idToken),
  };
}

export class AuthManager {
  private state: AuthState | null = null;
  private initialized = false;
  private persisted = false;
  private readonly filePath: string;
  private readonly store: EncryptedJsonStore<AuthState>;
  private refreshInFlight: Promise<void> | undefined;

  constructor(private readonly runtime: RuntimeConfig) {
    this.filePath = process.env.FOMO_MCP_AUTH_FILE
      ? path.resolve(process.env.FOMO_MCP_AUTH_FILE)
      : resolveConfiguredPath(runtime.auth.stateFile);
    this.store = new EncryptedJsonStore<AuthState>(this.filePath, process.env[runtime.auth.masterKeyEnv]);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const env = this.runtime.auth.allowEnvironmentTokens ? environmentState() : null;
    if (env) {
      this.state = env;
      this.persisted = false;
      this.initialized = true;
      return;
    }
    this.state = deriveExpiryMetadata(await this.store.read());
    this.persisted = this.state?.source !== "environment";
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private async reloadPersistedState(): Promise<void> {
    await this.ensureInitialized();
    if (this.persisted) this.state = deriveExpiryMetadata(await this.store.read());
  }

  async status(): Promise<AuthStatus> {
    await this.reloadPersistedState();
    return {
      available: Boolean(this.state?.idToken),
      source: this.state?.source ?? "none",
      hasIdentityToken: Boolean(this.state?.idToken),
      hasAccessToken: Boolean(this.state?.accessToken),
      hasRefreshToken: Boolean(this.state?.refreshToken),
      cookieCount: this.state?.cookies.length ?? 0,
      updatedAt: this.state?.updatedAt,
      accessTokenExpiresAt: this.state?.accessTokenExpiresAt,
      refreshTokenExpiresAt: this.state?.refreshTokenExpiresAt,
      identityTokenExpiresAt: this.state?.identityTokenExpiresAt,
      reauthRequired: !this.state?.idToken || this.identityExpired(),
    };
  }

  private tokenExpired(expiresAt: string | undefined): boolean {
    if (!expiresAt) return false;
    return Date.parse(expiresAt) <= Date.now();
  }

  private identityExpired(): boolean {
    return this.tokenExpired(this.state?.identityTokenExpiresAt);
  }

  private accessExpired(): boolean {
    return this.tokenExpired(this.state?.accessTokenExpiresAt);
  }

  async ensureSession(auth: AuthMode): Promise<string | undefined> {
    if (auth === "none") return undefined;
    await this.reloadPersistedState();

    const needsIdentity = auth === "identity";
    const needsAccess = auth === "access";
    const refreshable = Boolean(this.state?.accessToken && this.state.refreshToken);
    // Refresh only the token required by this endpoint's authentication mode.
    const refreshNeeded = (needsAccess && this.accessExpired()) || (needsIdentity && this.identityExpired());
    if (refreshNeeded && refreshable) await this.refreshSingleFlight();
    await this.reloadPersistedState();

    const token = needsIdentity ? this.state?.idToken : this.state?.accessToken;
    if (!token) {
      throw new AuthRequiredError(
        needsIdentity
          ? "An identity token is required for FOMO API access"
          : "An access token is required for this auth operation",
      );
    }
    if (needsIdentity && this.identityExpired()) {
      throw new ReauthRequiredError("Identity token is expired; open the local authorization link for a new login");
    }
    if (needsAccess && this.accessExpired()) {
      throw new ReauthRequiredError("Access token is expired; interactive re-authentication is required");
    }
    return token;
  }

  async cookiesFor(url: string): Promise<string | undefined> {
    await this.reloadPersistedState();
    return cookieHeader(this.state?.cookies ?? [], url);
  }

  async updateCookies(headers: Headers, requestUrl: string): Promise<void> {
    await this.reloadPersistedState();
    if (!this.state) return;
    const setCookies = getSetCookieHeaders(headers);
    if (setCookies.length === 0) return;
    this.state.cookies = mergeSetCookies(this.state.cookies, setCookies, requestUrl);
    this.state.updatedAt = new Date().toISOString();
    await this.persistIfAllowed();
  }

  async importState(input: Partial<AuthState>, source: AuthState["source"] = "manual-import"): Promise<AuthStatus> {
    const state = safeState(input, source);
    if (!state.idToken && !state.accessToken && !state.refreshToken && state.cookies.length === 0) {
      throw new Error("Auth import must contain at least one token or cookie");
    }
    this.state = state;
    this.initialized = true;
    this.persisted = true;
    await this.store.write(state);
    return this.status();
  }

  async refreshSession(): Promise<AuthStatus> {
    await this.refreshSingleFlight();
    return this.status();
  }

  private async refreshSingleFlight(): Promise<void> {
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }
    const operation = this.performRefresh();
    this.refreshInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.refreshInFlight === operation) this.refreshInFlight = undefined;
    }
  }

  private async performRefresh(): Promise<void> {
    await this.reloadPersistedState();
    if (!this.state?.accessToken || !this.state.refreshToken) {
      throw new AuthRequiredError("Both access and refresh tokens are required to refresh the Privy session");
    }
    const endpoint = "https://auth.privy.io/api/v1/sessions";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtime.http.requestTimeoutMs);
    try {
      const headers: Record<string, string> = {
        ...privyHeaders(this.runtime),
        authorization: `Bearer ${this.state.accessToken}`,
        ...(this.state.caId ? { "privy-ca-id": this.state.caId } : {}),
      };
      const cookies = await this.cookiesFor(endpoint);
      if (cookies) headers.cookie = cookies;
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ refresh_token: this.state.refreshToken }),
        signal: controller.signal,
      });
      await this.updateCookies(response.headers, endpoint);
      if (!response.ok) {
        if (response.status === 401) throw new ReauthRequiredError("Privy refresh was rejected; interactive re-authentication is required");
        throw new TransportError(`Privy refresh failed with HTTP ${response.status}`, { status: response.status });
      }
      const data = (await response.json()) as PrivyRefreshResponse;
      if (!data.privy_access_token || !data.refresh_token) {
        throw new ReauthRequiredError("Privy refresh did not return a complete rotated token pair");
      }
      this.state.accessToken = data.privy_access_token;
      this.state.refreshToken = data.refresh_token;
      this.state.accessTokenExpiresAt = tokenExpiry(data.privy_access_token);
      this.state.refreshTokenExpiresAt = tokenExpiry(data.refresh_token);
      const identityToken = data.token ?? data.identity_token;
      if (identityToken) {
        this.state.idToken = identityToken;
        this.state.identityTokenExpiresAt = tokenExpiry(identityToken);
      }
      this.state.updatedAt = new Date().toISOString();
      await this.persistIfAllowed();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistIfAllowed(): Promise<void> {
    if (!this.state || !this.persisted) return;
    await this.store.write(this.state);
  }
}

export async function readAuthImport(filePath: string): Promise<Partial<AuthState>> {
  const parsed = JSON.parse(await readFile(path.resolve(filePath), "utf8")) as Partial<AuthState>;
  return parsed;
}

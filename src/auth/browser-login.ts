import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { RuntimeConfig, StoredCookie } from "../config/types.js";
import { AuthManager } from "./auth-manager.js";

export type BrowserLoginStatus = "starting" | "awaiting_login" | "capturing" | "captured" | "failed";

export interface BrowserLoginSnapshot {
  id: string;
  status: BrowserLoginStatus;
  startedAt: string;
  updatedAt: string;
  authorizationUrl?: string;
  error?: string;
}

interface CapturedTokens {
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  caId?: string;
}

function tokenFromAuthorization(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function extractString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string;
  return undefined;
}

function extractPrivyTokens(payload: unknown): CapturedTokens {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  const nested = Object.values(record).find((value) => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown> | undefined;
  const source = nested ? { ...record, ...nested } : record;
  return {
    idToken: extractString(source, ["identity_token", "id_token", "identityToken"]),
    accessToken: extractString(source, ["privy_access_token", "access_token", "accessToken"]),
    refreshToken: extractString(source, ["refresh_token", "refreshToken"]),
    caId: extractString(source, ["privy_ca_id", "ca_id", "caId"]),
  };
}

function cookiesFromContext(cookies: Awaited<ReturnType<BrowserContext["cookies"]>>): StoredCookie[] {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expiresAt: cookie.expires > 0 ? cookie.expires * 1000 : undefined,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite === "Strict" ? "strict" : cookie.sameSite === "Lax" ? "lax" : cookie.sameSite === "None" ? "none" : undefined,
  }));
}

export class BrowserLoginManager {
  private readonly flows = new Map<string, BrowserLoginSnapshot>();
  private readonly browsers = new Map<string, Browser>();
  private readonly pages = new Map<string, Page>();
  private readonly chromeProcesses = new Map<string, ChildProcess>();
  private readonly chromeProfiles = new Map<string, string>();

  constructor(private readonly runtime: RuntimeConfig, private readonly auth: AuthManager) {}

  create(): BrowserLoginSnapshot {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const snapshot: BrowserLoginSnapshot = { id, status: "starting", startedAt: now, updatedAt: now };
    this.flows.set(id, snapshot);
    void this.run(id);
    return snapshot;
  }

  get(id: string): BrowserLoginSnapshot | undefined {
    return this.flows.get(id);
  }

  async submitRedirect(id: string, rawUrl: string): Promise<BrowserLoginSnapshot> {
    const page = this.pages.get(id);
    const flow = this.flows.get(id);
    if (!page || !flow) throw new Error("Authorization flow is no longer active");
    const callback = new URL(rawUrl);
    if (callback.protocol !== "https:" || callback.hostname !== "fomo.family") {
      throw new Error("Redirect URL must point to https://fomo.family");
    }
    if (!callback.searchParams.get("privy_oauth_code") || !callback.searchParams.get("privy_oauth_state")) {
      throw new Error("Redirect URL does not contain the expected Privy OAuth parameters");
    }
    this.update(id, { status: "capturing" });
    await page.goto(callback.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    return this.flows.get(id)!;
  }

  async openAuthorization(id: string): Promise<BrowserLoginSnapshot> {
    const page = this.pages.get(id);
    const flow = this.flows.get(id);
    if (!page || !flow) throw new Error("Authorization flow is no longer active");
    if (!flow.authorizationUrl) throw new Error("Google authorization URL has not been observed yet");
    await page.goto(flow.authorizationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    return this.flows.get(id)!;
  }

  private update(id: string, patch: Partial<BrowserLoginSnapshot>): void {
    const current = this.flows.get(id);
    if (!current) return;
    this.flows.set(id, { ...current, ...patch, updatedAt: new Date().toISOString() });
  }

  private async launchOrdinaryChrome(id: string): Promise<Browser> {
    const profile = await mkdtemp(path.join("/tmp", "fomo-mcp-auth-"));
    const chrome = spawn("/opt/google/chrome/chrome", [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "https://fomo.family/",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    this.chromeProcesses.set(id, chrome);
    this.chromeProfiles.set(id, profile);
    return new Promise<Browser>((resolve, reject) => {
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        chrome.kill();
        reject(new Error("Timed out waiting for ordinary Chrome remote debugging"));
      }, 30000);
      chrome.stderr?.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-65536);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
        if (!match || settled) return;
        settled = true;
        clearTimeout(timer);
        void chromium.connectOverCDP(match[1]!).then(resolve, reject);
      });
      chrome.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      chrome.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Ordinary Chrome exited before startup (code ${code ?? "unknown"})`));
      });
    });
  }

  private async run(id: string): Promise<void> {
    let browser: Browser | undefined;
    try {
      if (!this.runtime.auth.browserLoginHeaded) {
        throw new Error("Interactive authorization requires browserLoginHeaded=true");
      }
      browser = await this.launchOrdinaryChrome(id);
      this.browsers.set(id, browser);
      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = context.pages()[0] ?? await context.newPage();
      if (!page.url() || page.url() === "about:blank") {
        await page.goto("https://fomo.family/", { waitUntil: "domcontentloaded", timeout: 30000 });
      }
      this.pages.set(id, page);
      const tokens: CapturedTokens = {};
      let oauthSeen = false;
      this.update(id, { status: "awaiting_login" });
      page.on("request", (request) => {
        const url = request.url();
        if (!this.flows.get(id)?.authorizationUrl && /^https:\/\/accounts\.google\.com\//.test(url) && /oauth|client_id=/.test(url)) {
          this.update(id, { authorizationUrl: url });
        }
        if (url.startsWith(this.runtime.apiBases.fomo)) {
          const identity = tokenFromAuthorization(request.headers().authorization);
          if (identity) tokens.idToken = identity;
        }
        const caId = request.headers()["privy-ca-id"];
        if (caId) tokens.caId = caId;
      });
      page.on("response", async (response) => {
        if (!response.url().includes("auth.privy.io/api/v1/oauth/authenticate")) return;
        oauthSeen = true;
        try {
          const captured = extractPrivyTokens(await response.json());
          Object.assign(tokens, captured);
          this.update(id, { status: "capturing" });
        } catch {
          // The browser may receive a non-JSON response during an OAuth redirect.
        }
      });
      const deadline = Date.now() + this.runtime.auth.browserLoginTimeoutMs;
      while (Date.now() < deadline) {
        if (tokens.idToken && tokens.accessToken && tokens.refreshToken) {
          const cookies = cookiesFromContext(await context.cookies());
          await this.auth.importState({ ...tokens, cookies }, "browser-login");
          this.update(id, { status: "captured" });
          await context.close();
          await browser.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(oauthSeen ? "Login completed but required session tokens were not observed" : "Login timed out before OAuth completed");
    } catch (error) {
      this.update(id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      if (browser) await browser.close().catch(() => undefined);
    } finally {
      const chrome = this.chromeProcesses.get(id);
      if (chrome && !chrome.killed) chrome.kill();
      const profile = this.chromeProfiles.get(id);
      if (profile) await rm(profile, { recursive: true, force: true }).catch(() => undefined);
      this.browsers.delete(id);
      this.pages.delete(id);
      this.chromeProcesses.delete(id);
      this.chromeProfiles.delete(id);
    }
  }
}

import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { RuntimeConfig, StoredCookie } from "../config/types.js";
import { AuthManager } from "./auth-manager.js";
import { waitForChromeEndpoint } from "../http/chrome-startup.js";

export const BROWSER_LOGIN_STATUSES = ["starting", "awaiting_login", "capturing", "captured", "failed"] as const;
export type BrowserLoginStatus = typeof BROWSER_LOGIN_STATUSES[number];

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

function browserProfilePath(runtime: RuntimeConfig): string {
  const configured = process.env.FOMO_MCP_BROWSER_PROFILE_DIR?.trim() || runtime.auth.browserProfileDir?.trim();
  const selected = configured || path.join(os.homedir(), ".local", "share", "fomo-mcp", "google-profile");
  const expanded = selected.replace(/^~(?=\/|$)/, os.homedir());
  return path.resolve(expanded);
}

function browserEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  if (!environment.XDG_RUNTIME_DIR && typeof process.getuid === "function") {
    environment.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  }
  if (!environment.WAYLAND_DISPLAY && environment.XDG_RUNTIME_DIR && existsSync(path.join(environment.XDG_RUNTIME_DIR, "wayland-0"))) {
    environment.WAYLAND_DISPLAY = "wayland-0";
  }
  return environment;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

interface ProfileLock {
  path: string;
  handle: Awaited<ReturnType<typeof open>>;
  heartbeat: NodeJS.Timeout;
}

async function acquireProfileLock(profile: string): Promise<ProfileLock> {
  const lockPath = `${profile}.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const writeHeartbeat = async () => {
        const content = JSON.stringify({ pid: process.pid, updatedAt: Date.now() });
        await handle.write(content, 0, "utf8");
        await handle.truncate(Buffer.byteLength(content));
      };
      await writeHeartbeat();
      const heartbeat = setInterval(() => {
        void writeHeartbeat().catch(() => undefined);
      }, 5000);
      heartbeat.unref();
      return { path: lockPath, handle, heartbeat };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let lockIsStale = false;
      try {
        const owner = JSON.parse(await readFile(lockPath, "utf8")) as { updatedAt?: unknown };
        lockIsStale = typeof owner.updatedAt === "number" && Date.now() - owner.updatedAt > 15000;
      } catch {
        // A partially written lock is left in place to avoid racing its owner.
      }
      if (!lockIsStale) {
        throw new Error("FOMO authorization is already running in another process");
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error("Could not acquire the FOMO authorization profile lock");
}

async function releaseProfileLock(lock: ProfileLock | undefined): Promise<void> {
  if (!lock) return;
  clearInterval(lock.heartbeat);
  await lock.handle.close().catch(() => undefined);
  await unlink(lock.path).catch(() => undefined);
}

function chromeFailure(stderr: string, code: number | null): Error {
  const safe = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/https?:\/\/\S+/gi, "<url>").replace(/[A-Za-z0-9_-]{40,}/g, "<redacted>"))
    .filter((line) => line.length > 0)
    .slice(-8)
    .map((line) => line.slice(0, 300))
    .join(" | " );
  const details = safe ? `; ${safe}` : "";
  return new Error(`Ordinary Chrome exited before startup (code ${code ?? "unknown"}${details})`);
}

export class BrowserLoginManager {
  private readonly flows = new Map<string, BrowserLoginSnapshot>();
  private readonly pages = new Map<string, Page>();
  private readonly chromeProcesses = new Map<string, ChildProcess>();
  private readonly profileLocks = new Map<string, ProfileLock>();

  constructor(private readonly runtime: RuntimeConfig, private readonly auth: AuthManager) {}

  create(): BrowserLoginSnapshot {
    const active = [...this.flows.values()].find((flow) => flow.status !== "captured" && flow.status !== "failed");
    if (active) return active;
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
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      throw new Error("Interactive authorization requires a graphical session (DISPLAY or WAYLAND_DISPLAY is missing)");
    }
    const profile = browserProfilePath(this.runtime);
    await ensurePrivateDirectory(profile);
    if (!this.profileLocks.has(id)) {
      const lock = await acquireProfileLock(profile);
      this.profileLocks.set(id, lock);
    }
    const executablePath = this.runtime.transport.browser?.executablePath ?? "/opt/google/chrome/chrome";
    if (!existsSync(executablePath)) {
      throw new Error(`Chrome executable was not found at ${executablePath}`);
    }
    const environment = browserEnvironment();
    const chrome = spawn(executablePath, [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      ...(environment.WAYLAND_DISPLAY ? ["--ozone-platform=wayland"] : []),
      "about:blank",
    ], { env: environment, stdio: ["ignore", "ignore", "pipe"] });
    this.chromeProcesses.set(id, chrome);
    const endpoint = await waitForChromeEndpoint(chrome, { exitError: chromeFailure });
    return chromium.connectOverCDP(endpoint);
  }

  private async run(id: string): Promise<void> {
    let browser: Browser | undefined;
    try {
      if (!this.runtime.auth.browserLoginHeaded) {
        throw new Error("Interactive authorization requires browserLoginHeaded=true");
      }
      browser = await this.launchOrdinaryChrome(id);
      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = context.pages()[0] ?? await context.newPage();
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
      await page.goto("https://fomo.family/token", { waitUntil: "domcontentloaded", timeout: 30000 });
      const deadline = Date.now() + this.runtime.auth.browserLoginTimeoutMs;
      while (Date.now() < deadline) {
        const chrome = this.chromeProcesses.get(id);
        if (chrome && (chrome.exitCode !== null || chrome.signalCode !== null)) {
          throw new Error("Authorization browser was closed before the session was captured");
        }
        if (!tokens.accessToken || !tokens.refreshToken) {
          const stored = await page.evaluate(() => {
            const read = (key: string): string | undefined => {
              const raw = localStorage.getItem(key);
              if (!raw) return undefined;
              try {
                const value: unknown = JSON.parse(raw);
                return typeof value === "string" && value !== "deprecated" ? value : undefined;
              } catch { return undefined; }
            };
            return { accessToken: read("privy:pat"), refreshToken: read("privy:refresh_token"), caId: read("privy:caid") };
          });
          if (stored.accessToken) tokens.accessToken = stored.accessToken;
          if (stored.refreshToken) tokens.refreshToken = stored.refreshToken;
          if (stored.caId) tokens.caId = stored.caId;
        }
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
      if (chrome && chrome.exitCode === null && !chrome.killed) {
        chrome.kill();
        await new Promise<void>((resolve) => {
          if (chrome.exitCode !== null) return resolve();
          const timer = setTimeout(resolve, 5000);
          timer.unref();
          chrome.once("exit", () => { clearTimeout(timer); resolve(); });
        });
      }
      await releaseProfileLock(this.profileLocks.get(id));
      this.pages.delete(id);
      this.chromeProcesses.delete(id);
      this.profileLocks.delete(id);
    }
  }
}

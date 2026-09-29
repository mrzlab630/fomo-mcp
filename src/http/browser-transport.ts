import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import type { RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import { ReauthRequiredError, TransportError } from "../errors.js";
import type { Transport, TransportRequest, TransportResponse } from "./transport.js";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(headers: Record<string, string>): number | undefined {
  const value = headers["retry-after"];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function browserEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  if (!environment.XDG_RUNTIME_DIR && typeof process.getuid === "function") {
    environment.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  }
  if (!environment.WAYLAND_DISPLAY && environment.XDG_RUNTIME_DIR) {
    for (const candidate of ["wayland-0", "wayland-1"]) {
      if (existsSync(path.join(environment.XDG_RUNTIME_DIR, candidate))) {
        environment.WAYLAND_DISPLAY = candidate;
        break;
      }
    }
  }
  return environment;
}

function defaultChromePath(): string {
  const candidates = [
    process.env.FOMO_MCP_CHROME_PATH,
    "/opt/google/chrome/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new TransportError("A local Google Chrome or Chromium executable is required for FOMO browser transport");
  return found;
}

interface BrowserFetchResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export class BrowserTransport implements Transport {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private chromeProcess: ChildProcess | undefined;
  private profile: string | undefined;
  private starting: Promise<Page> | undefined;

  constructor(private readonly runtime: RuntimeConfig, private readonly auth: AuthManager) {
    process.once("exit", this.killChromeOnExit);
  }

  private readonly killChromeOnExit = (): void => {
    if (this.chromeProcess && !this.chromeProcess.killed) this.chromeProcess.kill();
  };

  async request(request: TransportRequest): Promise<TransportResponse> {
    const requestId = crypto.randomUUID();
    const attemptsAllowed = request.retryable ? this.runtime.http.maxRetries + 1 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
      try {
        const token = request.auth === "identity"
          ? await this.auth.identityToken()
          : request.auth === "access" ? await this.auth.accessToken() : undefined;
        const headers: Record<string, string> = {
          accept: "application/json",
          ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        };
        const result = await (await this.sharedPage()).evaluate(
          async ({ url, method, headers, body }) => {
            const response = await fetch(url, {
              method,
              headers,
              body,
              credentials: "include",
            });
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            return { status: response.status, body: await response.text(), headers: responseHeaders };
          },
          {
            url: request.url,
            method: request.method,
            headers,
            body: request.body === undefined ? undefined : JSON.stringify(request.body),
          },
        ) as BrowserFetchResult;
        if (result.status === 401) {
          throw new ReauthRequiredError("Upstream returned HTTP 401; identity token re-authentication is required");
        }
        if (RETRYABLE_STATUSES.has(result.status) && attempt < attemptsAllowed) {
          await delay(retryAfterMs(result.headers) ?? this.runtime.http.retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        if (Buffer.byteLength(result.body, "utf8") > this.runtime.http.maxResponseBytes) {
          throw new TransportError(`Response exceeded configured limit of ${this.runtime.http.maxResponseBytes} bytes`);
        }
        return {
          status: result.status,
          url: request.url,
          requestId,
          body: result.body,
          headers: new Headers(result.headers),
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ReauthRequiredError || error instanceof TransportError || attempt >= attemptsAllowed) {
          throw error;
        }
        await delay(this.runtime.http.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw new TransportError(`Browser transport failed after ${attemptsAllowed} attempts: ${String(lastError)}`, { requestId });
  }

  private async sharedPage(): Promise<Page> {
    if (this.page) return this.page;
    if (!this.starting) this.starting = this.startBrowser();
    return this.starting;
  }

  private async startBrowser(): Promise<Page> {
    const browserConfig = this.runtime.transport.browser;
    if (!browserConfig?.headed) {
      throw new TransportError("FOMO browser transport requires a headed ordinary Chrome session");
    }
    const profile = await mkdtemp(path.join(os.tmpdir(), "fomo-mcp-api-"));
    this.profile = profile;
    const windowWidth = Math.max(1, Math.floor(browserConfig.windowWidth ?? 1));
    const windowHeight = Math.max(1, Math.floor(browserConfig.windowHeight ?? 1));
    const origin = browserConfig.origin ?? this.runtime.http.origin;
    const chrome = spawn(browserConfig.executablePath ?? defaultChromePath(), [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      ...(browserConfig.startMinimized ? ["--start-minimized"] : []),
      `--window-size=${windowWidth},${windowHeight}`,
      ...(process.env.WAYLAND_DISPLAY || existsSync(path.join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? ""}`, "wayland-0"))
        ? ["--ozone-platform=wayland"] : []),
      ...(browserConfig.appMode ? [`--app=${origin}`] : [origin]),
    ], { env: browserEnvironment(), stdio: ["ignore", "ignore", "pipe"] });
    this.chromeProcess = chrome;
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      const timer = setTimeout(() => reject(new TransportError("Timed out waiting for ordinary Chrome remote debugging")), 30000);
      chrome.stderr?.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-65536);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
        if (!match) return;
        clearTimeout(timer);
        resolve(match[1]!);
      });
      chrome.once("error", (error) => { clearTimeout(timer); reject(error); });
      chrome.once("exit", (code) => { clearTimeout(timer); reject(new TransportError(`Chrome exited before startup (code ${code ?? "unknown"})`)); });
    });
    this.browser = await chromium.connectOverCDP(endpoint);
    const context = this.browser.contexts()[0] ?? await this.browser.newContext();
    this.page = context.pages()[0] ?? await context.newPage();
    await this.page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
    return this.page;
  }

  async close(): Promise<void> {
    process.removeListener("exit", this.killChromeOnExit);
    await this.browser?.close().catch(() => undefined);
    if (this.chromeProcess && !this.chromeProcess.killed) this.chromeProcess.kill();
    if (this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => undefined);
    this.browser = undefined;
    this.page = undefined;
    this.chromeProcess = undefined;
    this.profile = undefined;
    this.starting = undefined;
  }
}

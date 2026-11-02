import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { RuntimeConfig } from "../config/types.js";
import { AuthManager } from "../auth/auth-manager.js";
import { AuthRequiredError, ReauthRequiredError, TransportError } from "../errors.js";
import type { Transport, TransportRequest, TransportResponse } from "./transport.js";
import { RETRYABLE_STATUSES, retryDelayMs } from "./retry-policy.js";
import { waitForChromeEndpoint } from "./chrome-startup.js";

async function removeTemporaryProfile(profile: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    try {
      await stat(profile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    }
    await delay(100);
  }
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
  if (environment.DISPLAY && environment.XDG_RUNTIME_DIR
    && (!environment.XAUTHORITY || !existsSync(environment.XAUTHORITY))) {
    try {
      const xauthName = readdirSync(environment.XDG_RUNTIME_DIR)
        .find((name) => name.startsWith(".mutter-Xwaylandauth."));
      if (xauthName) environment.XAUTHORITY = path.join(environment.XDG_RUNTIME_DIR, xauthName);
    } catch {
      // Fall back to the original environment when the session directory is unavailable.
    }
  }
  return environment;
}

function windowingArguments(environment: NodeJS.ProcessEnv): string[] {
  // Wayland compositors own placement and ignore --window-position. When the
  // session exposes Xwayland, use it so Chrome can be placed at the work-area
  // edge before CDP connects and minimizes the window.
  if (environment.DISPLAY && environment.XAUTHORITY && existsSync(environment.XAUTHORITY)) {
    return ["--ozone-platform=x11"];
  }
  if (environment.WAYLAND_DISPLAY) return ["--ozone-platform=wayland"];
  return [];
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
  error?: string;
}

/** Self-contained because Playwright serializes this function into the page. */
export async function browserFetch({ url, method, headers, body, timeoutMs, maxBytes }: {
  url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number;
}): Promise<BrowserFetchResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error("Browser request timed out")); }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, { method, headers, body, credentials: "include", signal: controller.signal });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      const chunks: string[] = [];
      while (reader) {
        const chunk = await Promise.race([reader.read(), expired]);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw new Error(`Response exceeded configured limit of ${maxBytes} bytes`);
        chunks.push(decoder.decode(chunk.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return { status: response.status, body: chunks.join(""), headers: responseHeaders };
    })(), expired]);
  } catch (error) {
    return { status: 0, body: "", headers: {}, error: controller.signal.aborted ? "Browser request timed out"
      : error instanceof Error && error.message.startsWith("Response exceeded configured limit") ? error.message : "Browser HTTP request failed" };
  } finally {
    clearTimeout(timeout);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

export class BrowserTransport implements Transport {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private chromeProcess: ChildProcess | undefined;
  private profile: string | undefined;
  private starting: Promise<Page> | undefined;
  private closeInFlight: Promise<void> | undefined;
  private processHooksInstalled = false;
  private activeRequests = 0;
  private cookieRequests: Promise<void> = Promise.resolve();

  constructor(private readonly runtime: RuntimeConfig, private readonly auth: AuthManager) {}

  private readonly killChromeOnExit = (): void => {
    const chrome = this.chromeProcess;
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      this.signalChromeSync(chrome, "SIGKILL");
    }
    if (this.profile) {
      try {
        rmSync(this.profile, { recursive: true, force: true });
      } catch { /* Best-effort cleanup during synchronous process exit. */ }
    }
  };

  private readonly handleSigint = (): void => this.handleShutdownSignal("SIGINT");
  private readonly handleSigterm = (): void => this.handleShutdownSignal("SIGTERM");
  private readonly handleSighup = (): void => this.handleShutdownSignal("SIGHUP");

  private installProcessHooks(): void {
    if (this.processHooksInstalled) return;
    this.processHooksInstalled = true;
    process.once("SIGINT", this.handleSigint);
    process.once("SIGTERM", this.handleSigterm);
    process.once("SIGHUP", this.handleSighup);
  }

  private removeProcessHooks(): void {
    if (!this.processHooksInstalled) return;
    this.processHooksInstalled = false;
    process.removeListener("SIGINT", this.handleSigint);
    process.removeListener("SIGTERM", this.handleSigterm);
    process.removeListener("SIGHUP", this.handleSighup);
  }

  private handleShutdownSignal(signal: NodeJS.Signals): void {
    void this.close().finally(() => {
      process.kill(process.pid, signal);
    });
  }

  private signalChromeSync(chrome: ChildProcess, signal: NodeJS.Signals): void {
    try {
      if (chrome.pid) process.kill(-chrome.pid, signal);
      else chrome.kill(signal);
    } catch {
      try {
        chrome.kill(signal);
      } catch {
        // The process may have exited between the checks.
      }
    }
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.activeRequests += 1;
    const previous = this.cookieRequests;
    let release!: () => void;
    this.cookieRequests = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const requestId = crypto.randomUUID();
    const attemptsAllowed = request.retryable ? this.runtime.http.maxRetries + 1 : 1;
    const authRetryAllowed = request.retryable && request.auth !== "none";
    const maxAttempts = attemptsAllowed + (authRetryAllowed ? 1 : 0);
    let authRetried = false;
    let lastError: unknown;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const token = await this.auth.ensureSession(request.auth);
          const headers: Record<string, string> = {
            accept: "application/json",
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          };
          const page = await this.sharedPage();
          const context = page.context();
          await this.seedCookies(context);
          const evaluationTimeout = new AbortController();
          let result: BrowserFetchResult;
          try {
            result = await Promise.race([page.evaluate(
            browserFetch,
            {
              url: request.url,
              method: request.method,
              headers,
              body: request.body === undefined ? undefined : JSON.stringify(request.body),
              timeoutMs: this.runtime.http.requestTimeoutMs,
              maxBytes: this.runtime.http.maxResponseBytes,
            },
            ) as Promise<BrowserFetchResult>, delay(this.runtime.http.requestTimeoutMs, undefined, { signal: evaluationTimeout.signal }).then(() => {
              throw new TransportError("Browser request timed out", { requestId });
            })]);
          } finally {
            evaluationTimeout.abort();
          }
          // Set-Cookie is forbidden to page JavaScript; the browser jar is authoritative.
          await this.captureCookies(context);
          if (result.error) throw new TransportError(result.error, { requestId });
          if (result.status === 401) {
            if (authRetryAllowed && !authRetried) {
              authRetried = true;
              await this.auth.refreshSession();
              continue;
            }
            throw new ReauthRequiredError("Upstream returned HTTP 401; identity token re-authentication is required");
          }
          if (RETRYABLE_STATUSES.has(result.status) && attempt < attemptsAllowed) {
            await delay(retryDelayMs(this.runtime.http, attempt, result.headers["retry-after"]));
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
          if (error instanceof AuthRequiredError || error instanceof ReauthRequiredError || error instanceof TransportError || attempt >= maxAttempts) {
            throw error;
          }
          await delay(retryDelayMs(this.runtime.http, attempt));
        }
      }
      throw new TransportError(`Browser transport failed after ${attemptsAllowed} attempts: ${String(lastError)}`, { requestId });
    } finally {
      this.activeRequests -= 1;
      release();
      if (this.activeRequests === 0) await this.close();
    }
  }

  private async seedCookies(context: BrowserContext): Promise<void> {
    const cookies = await this.auth.browserCookies();
    await context.clearCookies();
    await context.addCookies(cookies.map((cookie) => ({
      name: cookie.name, value: cookie.value,
      domain: `${cookie.hostOnly ? "" : "."}${cookie.domain!}`, path: cookie.path!,
      ...(cookie.expiresAt === undefined ? {} : { expires: cookie.expiresAt / 1000 }),
      secure: cookie.secure, httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite === "strict" ? "Strict" : cookie.sameSite === "lax" ? "Lax" : cookie.sameSite === "none" ? "None" : undefined,
    })));
  }

  private async captureCookies(context: BrowserContext): Promise<void> {
    await this.auth.replaceBrowserCookies((await context.cookies()).map((cookie) => ({
      name: cookie.name, value: cookie.value, domain: cookie.domain, hostOnly: !cookie.domain.startsWith("."), path: cookie.path,
      expiresAt: cookie.expires > 0 ? cookie.expires * 1000 : undefined,
      secure: cookie.secure, httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite.toLowerCase() as "strict" | "lax" | "none",
    })));
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
    this.installProcessHooks();
    const windowWidth = Math.max(1, Math.floor(browserConfig.windowWidth ?? 1));
    const windowHeight = Math.max(1, Math.floor(browserConfig.windowHeight ?? 1));
    const windowPositionX = Math.floor(browserConfig.windowPositionX ?? 10000);
    const windowPositionY = Math.floor(browserConfig.windowPositionY ?? 10000);
    const origin = browserConfig.origin ?? this.runtime.http.origin;
    const avoidFocus = browserConfig.avoidFocus ?? true;
    const environment = browserEnvironment();
    process.once("exit", this.killChromeOnExit);
    const chromeArgs = [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      ...(avoidFocus ? ["--no-startup-window"] : []),
      ...(browserConfig.startMinimized ? ["--start-minimized"] : []),
      `--window-size=${windowWidth},${windowHeight}`,
      `--window-position=${windowPositionX},${windowPositionY}`,
      ...windowingArguments(environment),
      ...(avoidFocus ? [] : browserConfig.appMode ? [`--app=${origin}`] : [origin]),
    ];
    try {
      const chrome = spawn(browserConfig.executablePath ?? defaultChromePath(), chromeArgs, { detached: true, env: environment, stdio: ["ignore", "ignore", "pipe"] });
      this.chromeProcess = chrome;
      const endpoint = await waitForChromeEndpoint(chrome, { temporaryProfile: profile });
      this.browser = await chromium.connectOverCDP(endpoint);
      const context = this.browser.contexts()[0] ?? await this.browser.newContext();
      await this.seedCookies(context);
      if (avoidFocus) {
        // `context.newPage()` asks Chrome to focus a newly created window. Create
        // the target through CDP as a background tab instead, so the compositor
        // keeps the user's active window untouched from the first page event.
        const browserSession = await this.browser.newBrowserCDPSession();
        await browserSession.send("Target.createTarget", {
          url: "about:blank",
          background: true,
          focus: false,
        });
        await browserSession.detach().catch(() => undefined);
        for (let attempt = 0; attempt < 50; attempt += 1) {
          this.page = context.pages()[0];
          if (this.page) break;
          await delay(20);
        }
      }
      this.page ??= context.pages()[0] ?? await context.newPage();
      await this.minimizeWindow(context, this.page);
      await this.page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.captureCookies(context);
      return this.page;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async minimizeWindow(context: BrowserContext, page: Page): Promise<void> {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await session.detach().catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.closeInFlight) return this.closeInFlight;
    const cleanup = this.cleanupBrowser();
    const wrapped = cleanup.finally(() => {
      if (this.closeInFlight === wrapped) this.closeInFlight = undefined;
      process.removeListener("exit", this.killChromeOnExit);
      this.removeProcessHooks();
    });
    this.closeInFlight = wrapped;
    return wrapped;
  }

  private async cleanupBrowser(): Promise<void> {
    const browser = this.browser;
    const chrome = this.chromeProcess;
    const profile = this.profile;
    this.browser = undefined;
    this.chromeProcess = undefined;
    this.profile = undefined;
    this.page = undefined;
    this.starting = undefined;

    await browser?.close().catch(() => undefined);
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      this.signalChromeSync(chrome, "SIGTERM");
      await new Promise<void>((resolve) => {
        if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
        const timer = setTimeout(resolve, 5000);
        timer.unref();
        chrome.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      if (chrome.exitCode === null && chrome.signalCode === null) this.signalChromeSync(chrome, "SIGKILL");
    }
    if (profile) await removeTemporaryProfile(profile);
  }
}

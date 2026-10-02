import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TransportError } from "../errors.js";

interface ChromeStartupOptions {
  temporaryProfile?: string;
  exitError?: (stderr: string, code: number | null) => Error;
}

export function waitForChromeEndpoint(chrome: ChildProcess, options: ChromeStartupOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, endpoint?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.stderr?.removeListener("data", onData);
      chrome.removeListener("error", onError);
      chrome.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve(endpoint!);
    };
    const onData = (chunk: Buffer): void => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-65536);
      // Read a complete stderr line so a chunk boundary cannot resolve a
      // truncated WebSocket URL.
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)\r?\n/);
      if (match) finish(undefined, match[1]);
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null): void => finish(options.exitError?.(stderr, code)
      ?? new TransportError(`Chrome exited before startup (code ${code ?? "unknown"})`));
    const timer = setTimeout(() => finish(new TransportError("Timed out waiting for ordinary Chrome remote debugging")), 30000);
    chrome.stderr?.on("data", onData);
    chrome.once("error", onError);
    chrome.once("exit", onExit);

    // Only fresh temporary profiles are safe for the file fallback; persistent
    // login profiles can contain a DevToolsActivePort from an earlier run.
    if (options.temporaryProfile) {
      const activePort = path.join(options.temporaryProfile, "DevToolsActivePort");
      void (async () => {
        while (!settled) {
          try {
            const [rawPort, browserPath] = (await readFile(activePort, "utf8")).trim().split(/\r?\n/);
            const port = Number(rawPort);
            if (Number.isInteger(port) && port > 0 && port <= 65535 && browserPath?.startsWith("/devtools/browser/")) {
              finish(undefined, `ws://127.0.0.1:${port}${browserPath}`);
              return;
            }
          } catch {
            // Chrome publishes the file after creating the profile directory.
          }
          await delay(50);
        }
      })();
    }
  });
}

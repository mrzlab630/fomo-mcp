import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EndpointMap, RuntimeConfig } from "./types.js";
import { validateEndpointMap } from "./validate.js";
import { MAX_TIMER_DELAY_MS } from "../http/retry-policy.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function configRoot(): string {
  const runtimePath = process.env.FOMO_MCP_RUNTIME_CONFIG;
  return runtimePath
    ? path.dirname(path.resolve(runtimePath))
    : path.resolve(projectRoot, "config");
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const configured = process.env.FOMO_MCP_RUNTIME_CONFIG;
  const filePath = configured
    ? path.resolve(configured)
    : path.resolve(configRoot(), "runtime.json");
  const config = await readJson<RuntimeConfig>(filePath);
  if (!config.apiBases?.fomo || !config.http || !config.transport || !config.auth || !config.mcp || !config.daemon) {
    throw new Error(`Invalid runtime configuration: ${filePath}`);
  }
  for (const key of ["requestTimeoutMs", "maxResponseBytes", "maxRetries", "retryBaseDelayMs"] as const) {
    const value = config.http[key];
    if (!Number.isSafeInteger(value) || value < (key === "requestTimeoutMs" || key === "maxResponseBytes" ? 1 : 0)
      || (key !== "maxResponseBytes" && value > MAX_TIMER_DELAY_MS)) throw new Error(`Invalid HTTP limit: ${key}`);
  }
  if (typeof config.http.respectRetryAfter !== "boolean") throw new Error("Invalid HTTP retry policy");
  return config;
}

export function resolveEndpointMapPath(): string {
  return process.env.FOMO_MCP_ENDPOINTS_CONFIG
    ? path.resolve(process.env.FOMO_MCP_ENDPOINTS_CONFIG)
    : path.resolve(configRoot(), "endpoints.json");
}

export async function loadEndpointMap(): Promise<EndpointMap> {
  const filePath = resolveEndpointMapPath();
  return validateEndpointMap(await readJson<unknown>(filePath));
}

export function resolveConfiguredPath(configuredPath: string): string {
  return path.resolve(projectRoot, configuredPath);
}

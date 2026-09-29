import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EndpointMap, RuntimeConfig } from "./types.js";

function configRoot(): string {
  const runtimePath = process.env.FOMO_MCP_RUNTIME_CONFIG;
  return runtimePath
    ? path.dirname(path.resolve(runtimePath))
    : path.resolve(process.cwd(), "config");
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
  return config;
}

export async function loadEndpointMap(): Promise<EndpointMap> {
  const filePath = process.env.FOMO_MCP_ENDPOINTS_CONFIG
    ? path.resolve(process.env.FOMO_MCP_ENDPOINTS_CONFIG)
    : path.resolve(configRoot(), "endpoints.json");
  const map = await readJson<EndpointMap>(filePath);
  if (!Array.isArray(map.endpoints) || map.endpoints.length === 0) {
    throw new Error(`Endpoint map is empty or invalid: ${filePath}`);
  }
  return map;
}

export function resolveConfiguredPath(configuredPath: string): string {
  return path.resolve(process.cwd(), configuredPath);
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type * as TypeScript from "typescript";
import type { EndpointConfig, EndpointMap, RuntimeConfig } from "./config/types.js";
import { assertReadOnly, inputSchema } from "./endpoints/catalog.js";

const ROUTE_PREFIX = /^\/(?:v\d+(?:\/|$)|feed(?:\/|$)|proxy\/|hodlers\/|trades(?:\/|$)|watchlist(?:\/|$)|tokenAllowList\/|transfers\/|config$|api\/2\/|swaps\/|follows$)/;

export interface DiscoveredRoute {
  path: string;
  evidenceAssets: string[];
}

export interface DiscoveryCandidate {
  endpoint: EndpointConfig;
  evidenceAssets: string[];
}

export interface EndpointDiscoveryReport {
  reportVersion: 2;
  generatedAt: string;
  catalogDigest: string;
  source: {
    url: string;
    manifestUrl: string;
    manifestVersion?: string;
    routeModuleCount?: number;
    assetCount: number;
    downloadedBytes: number;
  };
  assets: { path: string; url: string; sha256: string; bytes: number }[];
  discoveredRoutes: DiscoveredRoute[];
  unmappedRoutes: DiscoveredRoute[];
  candidates: DiscoveryCandidate[];
  catalogOnly: string[];
  routeReferences: number;
  changes?: {
    baselineGeneratedAt: string;
    addedRoutes: string[];
    removedRoutes: string[];
    changedEvidenceRoutes: string[];
  };
  limitations: string[];
}

export function catalogDigest(endpointMap: EndpointMap): string {
  return createHash("sha256").update(JSON.stringify(endpointMap)).digest("hex");
}

export function canonicalPath(input: string): string {
  return input.split("?")[0]!.replace(/\$\{[^}]+\}/g, "{param}").replace(/\{[^}]+\}/g, "{param}").replace(/\/{2,}/g, "/");
}

function staticPrefix(ts: typeof TypeScript, expression: TypeScript.Expression): string | undefined {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) return expression.head.text;
  return undefined;
}

function isQuerySuffix(ts: typeof TypeScript, expression: TypeScript.Expression): boolean {
  if (ts.isConditionalExpression(expression)) {
    return [expression.whenTrue, expression.whenFalse].every((branch) => {
      const text = staticPrefix(ts, branch);
      return text !== undefined && (text === "" || text.startsWith("?") || text.startsWith("&"));
    });
  }
  return staticPrefix(ts, expression)?.startsWith("?") ?? false;
}

export function extractRouteReferences(ts: typeof TypeScript, source: string, assetName: string): DiscoveredRoute[] {
  const routes = new Set<string>();
  const tree = ts.createSourceFile(assetName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node: TypeScript.Node): void {
    let value: string | undefined;
    if (ts.isStringLiteralLike(node)) value = node.text;
    else if (ts.isTemplateExpression(node)) {
      value = node.head.text;
      for (const [index, span] of node.templateSpans.entries()) {
        if (value.includes("?") || isQuerySuffix(ts, span.expression)) break;
        // A leading template variable can be the API base URL, not a path id.
        if (!(index === 0 && value === "" && span.literal.text.startsWith("/"))) value += "{param}";
        value += span.literal.text;
      }
    }
    if (value) {
      if (/^https?:\/\//.test(value)) {
        try { value = new URL(value).pathname; } catch { value = ""; }
      }
      const route = canonicalPath(value);
      if (ROUTE_PREFIX.test(route)) routes.add(route);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...routes].sort().map((route) => ({ path: route, evidenceAssets: [assetName] }));
}

async function fetchText(url: string, maxBytes: number, budget: { remaining: number }): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/html,application/javascript" } });
    if (!response.ok) throw new Error(`Discovery fetch failed for ${url}: HTTP ${response.status}`);
    if (!response.body) throw new Error(`Discovery response has no body: ${url}`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      budget.remaining -= chunk.byteLength;
      if (bytes > maxBytes || budget.remaining < 0) {
        controller.abort();
        throw new Error(`Discovery download budget exceeded: ${url}`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && index < items.length) {
      const current = index++;
      try { results[current] = await fn(items[current]!); }
      catch (error) { failed = true; throw error; }
    }
  }
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  for (const result of settled) if (result.status === "rejected") throw result.reason;
  return results;
}

function manifestAssets(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string" && value.startsWith("/assets/") && value.endsWith(".js")) result.add(value);
  else if (Array.isArray(value)) for (const item of value) manifestAssets(item, result);
  else if (value && typeof value === "object") for (const item of Object.values(value)) manifestAssets(item, result);
  return result;
}

function candidateKey(endpoint: EndpointConfig): string {
  return `${endpoint.base}:${endpoint.method}:${canonicalPath(endpoint.path)}`;
}

function validateCandidate(endpoint: EndpointConfig): void {
  assertReadOnly(endpoint);
  if (!endpoint.expose || endpoint.internalOnly || !endpoint.tool || !["GET", "POST"].includes(endpoint.method) || !["fomo", "mobula"].includes(endpoint.base)) {
    throw new Error(`Discovery candidate must be an exposed read-only data endpoint: ${endpoint.id}`);
  }
  if (!endpoint.path.startsWith("/") || endpoint.path.includes("?") || endpoint.path.includes("..")) throw new Error(`Invalid candidate path: ${endpoint.id}`);
  const parameters = endpoint.request.params;
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) throw new Error(`Duplicate candidate parameters: ${endpoint.id}`);
  for (const match of endpoint.path.matchAll(/\{([^}]+)\}/g)) {
    if (!parameters.some((parameter) => parameter.name === match[1] && parameter.source === "path")) throw new Error(`Missing candidate path parameter: ${endpoint.id}`);
  }
  inputSchema(endpoint);
}

export async function discoverEndpointMap(runtime: RuntimeConfig, endpointMap: EndpointMap, baseline?: EndpointDiscoveryReport): Promise<EndpointDiscoveryReport> {
  const settings = runtime.discovery ?? { sourceUrl: "https://fomo.family/", outputDir: "reports", maxAssets: 400, maxAssetBytes: 5 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024, concurrency: 6 };
  for (const name of ["maxAssets", "maxAssetBytes", "maxTotalBytes", "concurrency"] as const) {
    if (!Number.isSafeInteger(settings[name]) || settings[name] < 1) throw new Error(`Invalid discovery setting: ${name}`);
  }
  const sourceUrl = new URL(settings.sourceUrl);
  if (!["http:", "https:"].includes(sourceUrl.protocol)) throw new Error("Discovery requires an HTTP(S) source");
  if (baseline && (baseline.reportVersion !== 2 || baseline.source.url !== sourceUrl.toString())) throw new Error("Baseline must be a version 2 discovery report from the same source");
  const ts = await import("typescript");
  const budget = { remaining: settings.maxTotalBytes };
  const html = await fetchText(sourceUrl.toString(), settings.maxAssetBytes, budget);
  const manifestReference = html.match(/(?:src|href)=["']([^"']*\/manifest-[^"']+\.js)["']/)?.[1];
  if (!manifestReference) throw new Error("Production page did not expose a React Router manifest asset");
  const manifestUrl = new URL(manifestReference, sourceUrl);
  if (manifestUrl.origin !== sourceUrl.origin) throw new Error("Discovery manifest must be on the source origin");
  const manifestText = await fetchText(manifestUrl.toString(), settings.maxAssetBytes, budget);
  const marker = "window.__reactRouterManifest=";
  if (!manifestText.trim().startsWith(marker)) throw new Error("Unexpected production manifest format");
  const manifest = JSON.parse(manifestText.trim().slice(marker.length).replace(/;\s*$/, "")) as Record<string, unknown>;
  const assetPaths = [...manifestAssets(manifest)].sort();
  if (assetPaths.length === 0 || assetPaths.length > settings.maxAssets) throw new Error(`Discovery asset count is empty or exceeds ${settings.maxAssets}`);
  const sources = await mapWithConcurrency(assetPaths, settings.concurrency, async (asset) => {
    const url = new URL(asset, sourceUrl).toString();
    const source = await fetchText(url, settings.maxAssetBytes, budget);
    return { asset, url, sha256: createHash("sha256").update(source).digest("hex"), bytes: Buffer.byteLength(source), routes: extractRouteReferences(ts, source, path.basename(asset)) };
  });
  const routeMap = new Map<string, Set<string>>();
  for (const item of sources) for (const route of item.routes) {
    const assets = routeMap.get(route.path) ?? new Set<string>();
    assets.add(path.basename(item.asset));
    routeMap.set(route.path, assets);
  }
  const discoveredRoutes = [...routeMap].sort(([a], [b]) => a.localeCompare(b)).map(([route, assets]) => ({ path: route, evidenceAssets: [...assets].sort() }));
  const discovered = new Set(routeMap.keys());
  const known = new Set(endpointMap.endpoints.flatMap((endpoint) => [endpoint.path, ...Object.values(endpoint.pathOverrides ?? {})]).map(canonicalPath));
  const existing = new Set(endpointMap.endpoints.map(candidateKey));
  const pending = endpointMap.discoveryCandidates ?? [];
  for (const endpoint of pending) validateCandidate(endpoint);
  const candidates = pending.filter((endpoint) => discovered.has(canonicalPath(endpoint.path)) && !existing.has(candidateKey(endpoint))).map((endpoint) => ({ endpoint, evidenceAssets: [...routeMap.get(canonicalPath(endpoint.path))!].sort() }));
  const report: EndpointDiscoveryReport = {
    reportVersion: 2,
    generatedAt: new Date().toISOString(),
    catalogDigest: catalogDigest(endpointMap),
    source: { url: sourceUrl.toString(), manifestUrl: manifestUrl.toString(), manifestVersion: typeof manifest.version === "string" ? manifest.version : undefined, routeModuleCount: manifest.routes && typeof manifest.routes === "object" ? Object.keys(manifest.routes).length : undefined, assetCount: sources.length, downloadedBytes: settings.maxTotalBytes - budget.remaining },
    assets: sources.map(({ asset, url, sha256, bytes }) => ({ path: asset, url, sha256, bytes })),
    discoveredRoutes,
    unmappedRoutes: discoveredRoutes.filter((route) => !known.has(route.path)),
    candidates,
    catalogOnly: endpointMap.endpoints.filter((endpoint) => ![endpoint.path, ...Object.values(endpoint.pathOverrides ?? {})].some((route) => discovered.has(canonicalPath(route)))).map((endpoint) => endpoint.id).sort(),
    routeReferences: discoveredRoutes.length,
    limitations: [
      "Public JavaScript references are discovery evidence, not an official API schema or a complete route inventory.",
      "Discovery does not authenticate, execute application JavaScript, launch a browser, or infer HTTP methods, permissions, response shapes, or request contracts.",
      "Unmapped references may include mutations, sensitive account routes, or non-API strings; review before adding a schema to config/endpoints.json discoveryCandidates.",
      "Missing references do not prove route removal. Changed evidence requires manual contract comparison and authorized read-only probes.",
    ],
  };
  if (baseline) {
    const before = new Map(baseline.discoveredRoutes.map((route) => [route.path, route]));
    const oldHashes = new Map(baseline.assets.map((asset) => [path.basename(asset.path), asset.sha256]));
    const newHashes = new Map(report.assets.map((asset) => [path.basename(asset.path), asset.sha256]));
    const fingerprint = (route: DiscoveredRoute, hashes: Map<string, string>) => route.evidenceAssets.map((asset) => hashes.get(asset) ?? asset).sort().join(":");
    report.changes = {
      baselineGeneratedAt: baseline.generatedAt,
      addedRoutes: discoveredRoutes.filter((route) => !before.has(route.path)).map((route) => route.path),
      removedRoutes: baseline.discoveredRoutes.filter((route) => !discovered.has(route.path)).map((route) => route.path),
      changedEvidenceRoutes: discoveredRoutes.filter((route) => before.has(route.path) && fingerprint(route, newHashes) !== fingerprint(before.get(route.path)!, oldHashes)).map((route) => route.path),
    };
  }
  return report;
}

export function applyDiscoveryCandidates(endpointMap: EndpointMap, report: EndpointDiscoveryReport): EndpointMap {
  if (catalogDigest(endpointMap) !== report.catalogDigest) throw new Error("Catalog changed during discovery; rerun before applying");
  const reviewed = new Map((endpointMap.discoveryCandidates ?? []).map((endpoint) => [endpoint.id, endpoint]));
  const ids = new Set(endpointMap.endpoints.map((endpoint) => endpoint.id));
  const tools = new Set(endpointMap.endpoints.map((endpoint) => endpoint.tool).filter(Boolean));
  const routes = new Set(endpointMap.endpoints.map(candidateKey));
  const additions: EndpointConfig[] = [];
  for (const candidate of report.candidates) {
    const endpoint = candidate.endpoint;
    if (!isDeepStrictEqual(reviewed.get(endpoint.id), endpoint)) throw new Error(`Candidate was not reviewed in the configured catalog: ${endpoint.id}`);
    validateCandidate(endpoint);
    if (!report.discoveredRoutes.some((route) => route.path === canonicalPath(endpoint.path))) throw new Error(`Candidate has no route evidence: ${endpoint.id}`);
    if (ids.has(endpoint.id) || tools.has(endpoint.tool) || routes.has(candidateKey(endpoint))) throw new Error(`Candidate conflicts with an existing endpoint: ${endpoint.id}`);
    ids.add(endpoint.id); tools.add(endpoint.tool); routes.add(candidateKey(endpoint)); additions.push(endpoint);
  }
  return {
    ...endpointMap,
    version: endpointMap.version + (additions.length > 0 ? 1 : 0),
    source: { ...endpointMap.source, status: "reverse-engineered reference; refreshed from production frontend; verify before live use", discoveredAt: report.generatedAt, discoveryUrl: report.source.url, discoveryManifest: report.source.manifestVersion ?? report.source.manifestUrl },
    endpoints: [...endpointMap.endpoints, ...additions],
    ...(endpointMap.discoveryCandidates ? { discoveryCandidates: endpointMap.discoveryCandidates.filter((endpoint) => !additions.some((item) => item.id === endpoint.id)) } : {}),
  };
}

export async function writeDiscoveryReport(report: EndpointDiscoveryReport, outputDir: string): Promise<{ jsonPath: string; markdownPath: string }> {
  const resolved = path.resolve(outputDir);
  await mkdir(resolved, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(resolved, `fomo-endpoint-discovery-${stamp}.json`);
  const markdownPath = path.join(resolved, `fomo-endpoint-discovery-${stamp}.md`);
  const list = (routes: DiscoveredRoute[]) => routes.length ? routes.map((route) => `- \`${route.path}\` (assets: ${route.evidenceAssets.join(", ")})`) : ["None."];
  const markdown = [
    "# FOMO endpoint discovery", "", `- Generated: ${report.generatedAt}`, `- Source: ${report.source.url}`, `- Manifest: ${report.source.manifestVersion ?? report.source.manifestUrl}`, `- Assets: ${report.source.assetCount}`, `- Route references: ${report.routeReferences}`, `- Reviewed candidates: ${report.candidates.length}`, "",
    "## Reviewed candidates", "", ...(report.candidates.length ? report.candidates.map((item) => `- \`${item.endpoint.id}\`: \`${item.endpoint.method} ${item.endpoint.base}${item.endpoint.path}\` (${item.evidenceAssets.join(", ")})`) : ["No new reviewed candidates were found."]), "",
    "## Unmapped references requiring review", "", ...list(report.unmappedRoutes), "",
    "## Catalog records not observed", "", ...(report.catalogOnly.length ? report.catalogOnly.map((id) => `- \`${id}\``) : ["None."]), "",
    ...(report.changes ? ["## Changes since baseline", "", `Baseline: ${report.changes.baselineGeneratedAt}`, "", ...Object.entries(report.changes).filter(([key]) => key !== "baselineGeneratedAt").map(([key, values]) => `- ${key}: ${(values as string[]).length ? (values as string[]).map((value) => `\`${value}\``).join(", ") : "none"}`), ""] : []),
    "## All route references", "", ...list(report.discoveredRoutes), "", "## Evidence limits", "", ...report.limitations.map((limitation) => `- ${limitation}`), "", `Machine-readable report with asset URLs and SHA-256 hashes: \`${jsonPath}\``, "",
  ].join("\n");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(markdownPath, markdown, { mode: 0o600 });
  return { jsonPath, markdownPath };
}

export async function saveEndpointMap(endpointMap: EndpointMap, filePath: string): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const mode = (await stat(filePath)).mode & 0o777;
    await writeFile(temporary, `${JSON.stringify(endpointMap, null, 2)}\n`, { mode });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readDiscoveryReport(filePath: string): Promise<EndpointDiscoveryReport> {
  const report = JSON.parse(await readFile(filePath, "utf8")) as EndpointDiscoveryReport;
  if (report.reportVersion !== 2 || !Array.isArray(report.assets) || !Array.isArray(report.discoveredRoutes) || !report.source?.url) throw new Error("Invalid version 2 discovery report");
  return report;
}

import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as ts from "typescript";
import { z } from "zod/v4";
import { applyDiscoveryCandidates, canonicalPath, discoverEndpointMap, extractRouteReferences, readDiscoveryReport, saveEndpointMap, writeDiscoveryReport } from "../dist/endpoint-discovery.js";
import { assertReadOnly, buildRequest, exposedEndpoints, inputSchema } from "../dist/endpoints/catalog.js";

const catalog = JSON.parse(await readFile(new URL("../config/endpoints.json", import.meta.url), "utf8"));
const runtime = JSON.parse(await readFile(new URL("../config/runtime.json", import.meta.url), "utf8"));
const endpoint = (id) => catalog.endpoints.find((item) => item.id === id);

test("parses actual query and template route forms without executing JavaScript", () => {
  const source = [
    'throw new Error("do not execute application code");',
    'get(`/feed?limit=${limit}&lastFeedId=${id}`);',
    'get(`/trades?${params.toString()}`);',
    'get(`/v2/users/${id}/swaps${query ? `?${query}` : ""}`);',
    'get(`/v2/users/${id}/followingPaginate${cursor ? `?lastId=${cursor}` : ""}`);',
    'get(`/v2/clans/${clanId}/thesis`);',
    'fetch(`${base}/api/2/pulse`, {method: "POST"});',
    'fetch("https://mobula-api.fomo.family/api/2/token/ohlcv-history?chainId=solana");',
    'get("/config"); get("/follows");',
    '// get("/v2/fake-comment-route");',
  ].join("\n");
  assert.deepEqual(extractRouteReferences(ts, source, "fixture.js").map((route) => route.path).sort(), [
    "/api/2/pulse", "/api/2/token/ohlcv-history", "/config", "/feed", "/follows", "/trades",
    "/v2/clans/{param}/thesis", "/v2/users/{param}/followingPaginate", "/v2/users/{param}/swaps",
  ].sort());
  assert.equal(canonicalPath("/v2/clans/{clanId}/thesis"), canonicalPath("/v2/clans/{id}/thesis"));
  assert.equal(canonicalPath("/v2/clans/${clanId}/thesis?limit=20"), "/v2/clans/{param}/thesis");
});

test("catalog contracts build correct cursor, auth and wire values", () => {
  const search = endpoint("fomo_search_tokens");
  assert.throws(() => buildRequest(search, {}), /non-empty/);
  assert.throws(() => buildRequest(search, { phrase: "  ", token: "" }), /non-empty/);
  assert.deepEqual(buildRequest(search, { token: "mint" }).body, { token: "mint" });
  assert.deepEqual(buildRequest(search, { phrase: "SOL" }).body, { phrase: "SOL" });
  assert.throws(() => buildRequest(endpoint("fomo_get_trades"), {}), /userId/);
  assert.deepEqual(buildRequest(endpoint("fomo_get_trades"), { userId: "user", lastTradeId: "cursor" }).query, { userId: "user", orderBy: "closedAt", lastTradeId: "cursor" });
  assert.deepEqual(buildRequest(endpoint("fomo_get_user_swaps"), { id: "user/id", lastSwapIdV2: "cursor" }), { path: "/v2/users/user%2Fid/swaps", query: { lastSwapIdV2: "cursor" } });
  assert.equal(buildRequest(endpoint("fomo_get_leaderboard"), { window: "all" }).path, "/v2/leaderboard");
  assert.equal(buildRequest(endpoint("fomo_ohlcv"), { address: "mint", chain: "solana", from: 1, to: 2 }).query.chainId, "solana");
  assert.equal(endpoint("fomo_ohlcv").auth, "access");
  assert.deepEqual(buildRequest(endpoint("fomo_top_holders"), { tokens: [{ tokenAddress: "mint", networkId: 1 }] }).query.tokens, '[{"networkId":1,"address":"mint"}]');
  assert.deepEqual(buildRequest(endpoint("fomo_filter_tokens"), { tokenIds: ["solana:mint"] }).body, ["solana:mint"]);
  const schema = z.object(inputSchema(endpoint("fomo_trading_activity")));
  assert.equal(schema.safeParse({ limit: 100 }).success, true);
  assert.equal(schema.safeParse({ limit: 101 }).success, false);
  for (const item of catalog.endpoints.filter((item) => item.sideEffect === "mutation")) assert.throws(() => assertReadOnly(item));
  assert.equal(exposedEndpoints(catalog.endpoints, false, false).some((item) => item.id === "fomo_mobula_pulse"), false);
});

test("discovery compares evidence and only applies reviewed read-only candidates", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-discovery-"));
  let script = 'get("/feed?limit=50"); get(`/v2/clans/${id}/thesis`); get("/proxy/trendingTokens"); post("/v2/users/exportedKeys");';
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/javascript");
    if (request.url === "/") response.end('<script src="/assets/manifest-fixture.js"></script>');
    else if (request.url === "/assets/manifest-fixture.js") response.end('window.__reactRouterManifest={"version":"fixture","routes":{"root":{"module":"/assets/routes.js"}}};');
    else if (request.url === "/assets/routes.js") response.end(script);
    else { response.statusCode = 404; response.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const settings = { ...runtime, discovery: { sourceUrl: `http://127.0.0.1:${server.address().port}/`, outputDir: directory, maxAssets: 10, maxAssetBytes: 1024, maxTotalBytes: 4096, concurrency: 2 } };
  const trending = endpoint("fomo_trending_tokens");
  const pending = { ...catalog, endpoints: catalog.endpoints.filter((item) => item.id !== trending.id), discoveryCandidates: [trending] };
  const before = JSON.stringify(pending);
  const report = await discoverEndpointMap(settings, pending);
  assert.equal(JSON.stringify(pending), before);
  assert.equal(report.candidates.length, 1);
  assert.equal(report.unmappedRoutes.some((route) => route.path === "/v2/users/exportedKeys"), true);
  assert.equal(report.catalogOnly.includes("fomo_get_global_feed"), false);
  assert.equal(report.catalogOnly.includes("fomo_get_clan_thesis"), false);
  const paths = await writeDiscoveryReport(report, directory);
  assert.deepEqual(await readDiscoveryReport(paths.jsonPath), report);
  assert.match(await readFile(paths.markdownPath, "utf8"), /Unmapped references requiring review/);
  const stable = await discoverEndpointMap(settings, pending, report);
  assert.deepEqual(stable.changes.addedRoutes, []);
  assert.deepEqual(stable.changes.changedEvidenceRoutes, []);
  script += ' get("/proxy/newReadRoute");';
  const changed = await discoverEndpointMap(settings, pending, report);
  assert.deepEqual(changed.changes.addedRoutes, ["/proxy/newReadRoute"]);
  assert.ok(changed.changes.changedEvidenceRoutes.includes("/feed"));
  const applied = applyDiscoveryCandidates(pending, report);
  assert.equal(applied.endpoints.length, catalog.endpoints.length);
  assert.equal(applied.version, pending.version + 1);
  assert.deepEqual(applied.discoveryCandidates, []);
  assert.equal(applied.endpoints.some((item) => item.path === "/v2/users/exportedKeys"), false);
  assert.throws(() => applyDiscoveryCandidates({ ...pending, version: 999 }, report), /Catalog changed/);
  assert.throws(() => applyDiscoveryCandidates(pending, { ...report, candidates: [{ ...report.candidates[0], endpoint: { ...trending, sideEffect: "mutation" } }] }), /not reviewed/);
  const mutationMap = { ...pending, discoveryCandidates: [{ ...trending, sideEffect: "mutation" }] };
  await assert.rejects(discoverEndpointMap(settings, mutationMap), /side effects/);
  const catalogPath = path.join(directory, "catalog.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(catalogPath, JSON.stringify(pending));
  await saveEndpointMap(applied, catalogPath);
  assert.deepEqual(JSON.parse(await readFile(catalogPath, "utf8")), applied);
  await assert.rejects(discoverEndpointMap({ ...settings, discovery: { ...settings.discovery, maxAssetBytes: 1 } }, pending), /budget exceeded/);
  await assert.rejects(discoverEndpointMap({ ...settings, discovery: { ...settings.discovery, maxTotalBytes: 1 } }, pending), /budget exceeded/);
  await assert.rejects(discoverEndpointMap({ ...settings, discovery: { ...settings.discovery, maxAssets: 0 } }, pending), /Invalid discovery setting/);
});

test("generated API reference documents every catalog id and parameter", async () => {
  const docs = await readFile(new URL("../docs/API.md", import.meta.url), "utf8");
  const sections = new Map([...docs.matchAll(/^### (\S+)\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)].map((match) => [match[1], match[2]]));
  for (const item of catalog.endpoints) {
    assert.ok(sections.has(item.id), `Missing section: ${item.id}`);
    const section = sections.get(item.id);
    assert.ok(section.includes(`${item.method} ${runtime.apiBases[item.base]}${item.path}`), `Missing route: ${item.id}`);
    for (const parameter of item.request.params) assert.ok(section.includes(`| \`${parameter.name}\` |`), `Missing parameter: ${item.id}.${parameter.name}`);
    assert.ok(section.includes(`auth: \`${item.auth}\``));
  }
  assert.equal(sections.size, catalog.endpoints.length);
});

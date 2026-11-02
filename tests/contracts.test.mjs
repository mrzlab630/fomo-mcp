import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod/v4";
import { validateEndpointMap } from "../dist/config/validate.js";
import { buildRequest, exposedEndpoints, inputSchema } from "../dist/endpoints/catalog.js";
import { checkApiDoc, renderApiDoc } from "../scripts/generate-api-doc.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const catalog = JSON.parse(await readFile(new URL("../config/endpoints.json", import.meta.url), "utf8"));
const runtime = JSON.parse(await readFile(new URL("../config/runtime.json", import.meta.url), "utf8"));
const endpoint = (id) => catalog.endpoints.find((item) => item.id === id);

test("catalog loading rejects malformed shape, unsafe policy and inconsistent wire contracts", async (t) => {
  assert.deepEqual(validateEndpointMap(catalog), catalog);
  const cases = [
    (map) => { map.version = "1"; },
    (map) => { delete map.source.commit; },
    (map) => { map.endpoints[0].auth = "unknown"; },
    (map) => { map.endpoints[0].expose = "true"; },
    (map) => { map.endpoints[0].sideEffect = "unknown"; },
    (map) => { map.endpoints[0].response = null; },
    (map) => { map.endpoints[0].request.params[0].type = "unknown"; },
    (map) => { map.endpoints.push(structuredClone(map.endpoints[0])); },
    (map) => { map.endpoints[1].tool = map.endpoints[0].tool; },
    (map) => { map.endpoints[0].tool = "fomo_auth_status"; },
    (map) => { map.endpoints[0].internalOnly = true; },
    (map) => { map.endpoints[0].sideEffect = "mutation"; },
    (map) => { map.endpoints[0].path = "//evil.test/read"; },
    (map) => { map.endpoints[0].path = "/read/../outside"; },
    (map) => { map.endpoints[0].path = "/read/{missing}"; },
    (map) => { map.endpoints[0].path = "/read/{handle"; },
    (map) => { map.endpoints[0].request.params.push(structuredClone(map.endpoints[0].request.params[0])); },
    (map) => { map.endpoints[0].request.atLeastOneOf = ["missing"]; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_leaderboard").request.params[0]; p.default = "5d"; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_leaderboard").request.params[0]; p.enum = []; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_leaderboard").request.params[0]; p.enum = ["24h", "24h"]; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_leaderboard"); p.pathOverrides.evil = "//evil.test/"; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_global_feed").request.params.find((p) => p.type === "array"); delete p.items; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_global_feed").request.params.find((p) => p.type === "array"); p.minItems = -1; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_get_global_feed").request.params.find((p) => p.type === "number"); p.minimum = 200; p.maximum = 100; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_top_holders").request.params[0]; p.rename = { absent: "address" }; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_top_holders").request.params[0]; p.rename = { tokenAddress: "networkId" }; },
    (map) => { const p = map.endpoints.find((e) => e.id === "fomo_filter_tokens"); p.request.body = "object"; },
    (map) => { map.discoveryCandidates = [{ id: "incomplete" }]; },
  ];
  for (const damage of cases) {
    const map = structuredClone(catalog);
    damage(map);
    assert.throws(() => validateEndpointMap(map), damage.toString());
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-catalog-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const broken = path.join(directory, "endpoints.json");
  await writeFile(broken, JSON.stringify({ ...catalog, endpoints: [{ ...catalog.endpoints[0], auth: "unknown" }] }));
  await assert.rejects(promisify(execFile)(process.execPath, ["--input-type=module", "-e", `import {loadEndpointMap} from ${JSON.stringify(new URL("../dist/config/load.js", import.meta.url).href)}; await loadEndpointMap();`], {
    cwd: directory, env: { ...process.env, FOMO_MCP_ENDPOINTS_CONFIG: broken },
  }), (error) => /auth/.test(error.stderr));
});

test("shared MCP and direct argument parsing enforce leaderboard enums and nonempty collections", () => {
  for (const id of ["fomo_get_leaderboard", "fomo_get_clan_leaderboard"]) {
    const item = endpoint(id);
    const schema = z.object(inputSchema(item));
    for (const window of ["24h", "7d", "30d", "all"]) {
      assert.equal(schema.safeParse({ window }).success, true);
      assert.doesNotThrow(() => buildRequest(item, { window }));
    }
    assert.equal(schema.safeParse({ window: "5d" }).success, false);
    assert.throws(() => buildRequest(item, { window: "5d" }));
  }
  assert.equal(buildRequest(endpoint("fomo_get_leaderboard"), {}).path, "/v2/leaderboard/24h");
  assert.equal(buildRequest(endpoint("fomo_get_leaderboard"), { window: "all" }).path, "/v2/leaderboard");
  for (const id of ["fomo_get_clan_feed", "fomo_get_global_feed", "fomo_get_users_batch", "fomo_filter_tokens", "fomo_top_holders", "fomo_friends_holdings"]) {
    const item = endpoint(id);
    const collection = item.request.params.find((p) => p.type === "array");
    const args = { id: "clan", [collection.name]: [] };
    assert.equal(z.object(inputSchema(item)).safeParse(args).success, false, id);
    assert.throws(() => buildRequest(item, args), undefined, id);
  }
  const lookup = { ...endpoint("fomo_get_users_batch"), request: { params: [{ name: "ids", source: "query", type: "array", items: { type: "string" }, required: false, serialize: "repeat" }], atLeastOneOf: ["ids"] } };
  assert.throws(() => buildRequest(lookup, { ids: [] }), /non-empty/);
  assert.throws(() => buildRequest(endpoint("fomo_get_clan_feed"), { id: "clan", feedTypes: [7] }));
});

test("legacy inclusion flags never advertise mutation or internal tools", () => {
  const unsafe = [
    { ...endpoint("fomo_get_trades"), id: "mutation", tool: "mutation", sideEffect: "mutation", expose: true },
    { ...endpoint("fomo_get_trades"), id: "internal", tool: "internal", internalOnly: true, expose: true },
  ];
  for (const includeMutation of [true, false]) for (const includeInternal of [true, false]) {
    assert.deepEqual(exposedEndpoints(unsafe, includeMutation, includeInternal), []);
    assert.equal(exposedEndpoints(catalog.endpoints, includeMutation, includeInternal).length, 59);
  }
});

test("external runtime and default configured paths resolve consistently across launch directories", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-path-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtimePath = path.join(directory, "runtime.json");
  await writeFile(runtimePath, JSON.stringify(runtime));
  const moduleUrl = new URL("../dist/config/load.js", import.meta.url).href;
  const code = `import {loadRuntimeConfig,resolveConfiguredPath,resolveEndpointMapPath} from ${JSON.stringify(moduleUrl)};
    const runtime=await loadRuntimeConfig(); console.log(JSON.stringify({state:resolveConfiguredPath(runtime.auth.stateFile),snapshot:resolveConfiguredPath(runtime.discovery.snapshotFile),absolute:resolveConfiguredPath('/tmp/fomo-synthetic.json'),catalog:resolveEndpointMapPath()}));`;
  for (const cwd of [root, directory]) for (const external of [false, true]) {
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
      cwd, env: { ...process.env, FOMO_MCP_RUNTIME_CONFIG: external ? runtimePath : "", FOMO_MCP_ENDPOINTS_CONFIG: "" },
    });
    assert.deepEqual(JSON.parse(stdout), {
      state: path.join(root, "data/auth-state.enc.json"), snapshot: path.join(root, "data/endpoint-discovery.json"),
      absolute: "/tmp/fomo-synthetic.json", catalog: external ? path.join(directory, "endpoints.json") : path.join(root, "config/endpoints.json"),
    });
  }
});

test("docs exact-byte check detects drift and never rewrites its target", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-docs-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "API.md");
  const rendered = renderApiDoc(catalog, runtime);
  await writeFile(target, rendered);
  const originalStat = await stat(target);
  await checkApiDoc(target, rendered);
  assert.equal((await stat(target)).mtimeMs, originalStat.mtimeMs);
  for (const changed of [`${rendered}\n`, rendered.replace("Read the user leaderboard.", "Wrong description."), rendered.replace(/\n/g, "\r\n")]) {
    await writeFile(target, changed);
    const before = await readFile(target);
    const modified = await stat(target);
    await assert.rejects(checkApiDoc(target, rendered), /exact generated bytes/);
    assert.deepEqual(await readFile(target), before);
    assert.equal((await stat(target)).mtimeMs, modified.mtimeMs);
  }
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../dist/mcp/server.js";
import { AuthManager } from "../dist/auth/auth-manager.js";

const baseRuntime = JSON.parse(await readFile(new URL("../config/runtime.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../config/endpoints.json", import.meta.url), "utf8"));
const userId = "d6a85eb5-d3fb-5b8a-8445-019af88ba512";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-mcp-test-"));
  const requests = [];
  let flow = { id: "test-flow", status: "awaiting_login" };
  const data = { swaps: [{ id: "stale", createdAt: "2026-08-15T00:00:00Z", pinned: true }], hasNextPage: true };
  const daemon = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/auth/session/start" || request.url === "/auth/session/test-flow") {
      response.end(JSON.stringify({ ...flow, authorizationUrl: "https://example.test/?code=should-not-appear" }));
    } else response.end(JSON.stringify({ success: true, responseObject: data }));
  });
  daemon.listen(0, "127.0.0.1");
  await once(daemon, "listening");
  const origin = `http://127.0.0.1:${daemon.address().port}`;
  const runtime = structuredClone(baseRuntime);
  runtime.apiBases.fomo = origin;
  runtime.daemon.healthPort = daemon.address().port;
  runtime.transport.mode = "direct";
  runtime.auth.stateFile = path.join(directory, "auth.enc.json");
  runtime.auth.allowEnvironmentTokens = false;
  runtime.auth.masterKeyEnv = "FOMO_MCP_TEST_MASTER_KEY";
  process.env.FOMO_MCP_TEST_MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const auth = new AuthManager(runtime);
  await auth.initialize();
  const setExpiry = (offset) => auth.importState({
    idToken: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString("base64url")}.x`,
    cookies: [],
  });
  const endpoint = catalog.endpoints.find((item) => item.id === "fomo_get_trades");
  const server = await createMcpServer(runtime, { ...catalog, endpoints: [endpoint] });
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map();
  let nextId = 0;
  client.onmessage = (message) => {
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  };
  await client.start();
  await server.connect(transport);
  const request = async (method, params) => {
    const id = ++nextId;
    const result = new Promise((resolve) => pending.set(id, resolve));
    await client.send({ jsonrpc: "2.0", id, method, params });
    const reply = await result;
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    return reply.result;
  };
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  t.after(async () => {
    await server.close();
    daemon.closeAllConnections();
    await new Promise((resolve) => daemon.close(resolve));
    await rm(directory, { recursive: true, force: true });
    delete process.env.FOMO_MCP_TEST_MASTER_KEY;
  });
  return { requests, data, setExpiry, setFlow: (next) => { flow = next; },
    call: (name, args = {}) => request("tools/call", { name, arguments: args }) };
}

test("MCP rejects wallet userId and preserves every field of the upstream page", async (t) => {
  const f = await fixture(t);
  await f.setExpiry(3600);
  const invalid = await f.call("fomo_get_trades", { userId: "wallet-address" });
  assert.equal(invalid.isError, true);
  assert.equal(f.requests.length, 0);
  const valid = await f.call("fomo_get_trades", { userId });
  assert.equal(valid.isError, undefined);
  assert.deepEqual(valid.structuredContent.data, f.data);
  assert.equal(f.requests.length, 1);
  assert.equal(new URL(f.requests[0].url, "http://local").searchParams.get("userId"), userId);
});

test("expired identity starts one flow, polls current status and can authorize a later expiry", async (t) => {
  const f = await fixture(t);
  await f.setExpiry(-60);
  const replies = await Promise.all([f.call("fomo_get_trades", { userId }), f.call("fomo_get_trades", { userId })]);
  for (const reply of replies) {
    assert.equal(reply.structuredContent.reauthRequired, true);
    assert.equal(reply.structuredContent.browser.started, true);
    assert.doesNotMatch(JSON.stringify(reply), /should-not-appear/);
  }
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 1);
  f.setFlow({ id: "test-flow", status: "failed", error: "Browser closed" });
  const failed = await f.call("fomo_auth_status");
  assert.equal(failed.structuredContent.browser.started, false);
  assert.equal(failed.structuredContent.browser.status, "failed");
  await f.call("fomo_auth_status");
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 1);
  f.setFlow({ id: "test-flow", status: "awaiting_login" });
  await f.call("fomo_auth_start");
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 2);
  await f.setExpiry(3600);
  assert.equal((await f.call("fomo_auth_status")).structuredContent.ready, true);
  await f.setExpiry(-60);
  await f.call("fomo_get_trades", { userId });
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 3);
  assert.equal(f.requests.some((r) => r.url.startsWith("/trades")), false);
});

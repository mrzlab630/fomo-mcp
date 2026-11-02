import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthManager } from "../dist/auth/auth-manager.js";
import { ManualOAuthManager } from "../dist/auth/manual-oauth.js";
import { cookieHeader, mergeSetCookies, normalizeCookie, parseSetCookie } from "../dist/auth/cookie-jar.js";
import { boundedFetch } from "../dist/http/bounded-fetch.js";
import { BrowserTransport, browserFetch } from "../dist/http/browser-transport.js";
import { FetchTransport } from "../dist/http/fetch-transport.js";
import { MAX_TIMER_DELAY_MS, retryAfterMs, retryDelayMs } from "../dist/http/retry-policy.js";

const base = JSON.parse(await readFile(new URL("../config/runtime.json", import.meta.url), "utf8"));
const cookie = (name, extra = {}) => ({ name, value: "fixture", domain: "api.example.test", path: "/", ...extra });
const browserArgs = { url: "https://api.example.test/read", method: "GET", headers: {}, timeoutMs: 50, maxBytes: 8 };
const currentIdentity = () => `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.x`;

async function authFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-security-"));
  const runtime = structuredClone(base);
  runtime.auth = { ...runtime.auth, stateFile: path.join(directory, "auth.json"), allowEnvironmentTokens: false, masterKeyEnv: "FOMO_SECURITY_TEST_KEY" };
  runtime.http.requestTimeoutMs = 50;
  runtime.http.maxResponseBytes = 1024;
  runtime.apiBases.privy = "https://auth.example.test";
  process.env.FOMO_SECURITY_TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const auth = new AuthManager(runtime);
  await auth.initialize();
  t.after(async () => { delete process.env.FOMO_SECURITY_TEST_KEY; await rm(directory, { recursive: true, force: true }); });
  return { runtime, auth };
}

test("cookie scope fails closed and preserves host-only versus Domain", async (t) => {
  const { auth } = await authFixture(t);
  await assert.rejects(auth.importState({ cookies: [{ name: "x", value: "fixture" }] }), /explicit domain/);
  assert.equal(cookieHeader([{ name: "legacy", value: "fixture" }], "https://unrelated.test/"), undefined);
  assert.throws(() => normalizeCookie(cookie("x", { value: "bad\r\nvalue" })), /valid name/);
  const host = parseSetCookie("host=fixture; Secure; HttpOnly", "https://api.example.test/api/v1/login");
  const domain = parseSetCookie("domain=fixture; Domain=example.test", "https://api.example.test/api/v1/login");
  assert.equal(host.hostOnly, true);
  assert.equal(domain.hostOnly, false);
  assert.equal(cookieHeader([host], "https://sub.api.example.test/api/v1/read"), undefined);
  assert.equal(cookieHeader([domain], "https://sub.example.test/api/v1/read"), "domain=fixture");
  assert.equal(cookieHeader([host], "http://api.example.test/api/v1/read"), undefined);
  assert.equal(cookieHeader([host, domain], "https://example.test.evil.test/api/v1/read"), undefined);
  assert.equal(parseSetCookie("bad=fixture; Domain=evil.test", "https://api.example.test/"), null);
  assert.equal(cookieHeader([cookie("exact")], "https://sub.api.example.test/"), undefined);
  assert.equal(cookieHeader([cookie("explicit", { hostOnly: false })], "https://sub.api.example.test/"), "explicit=fixture");
  assert.equal(cookieHeader([cookie("dot", { domain: ".example.test" })], "https://sub.example.test/"), "dot=fixture");
});

test("cookie default paths, slash boundaries, expiry and Max-Age precedence", () => {
  const host = parseSetCookie("a=fixture", "https://api.example.test/api/v1/login");
  assert.equal(host.path, "/api/v1");
  assert.equal(cookieHeader([host], "https://api.example.test/"), undefined);
  assert.equal(cookieHeader([host], "https://api.example.test/api/v10"), undefined);
  assert.equal(cookieHeader([host], "https://api.example.test/api/v1/read"), "a=fixture");
  assert.equal(parseSetCookie("a=fixture; Path=relative", "https://api.example.test/api/login").path, "/api");
  assert.equal(cookieHeader([cookie("slash", { path: "/api/" })], "https://api.example.test/api/read"), "slash=fixture");
  assert.equal(cookieHeader([cookie("slash", { path: "/api/" })], "https://api.example.test/api"), undefined);
  for (const attrs of ["Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=3600"]) {
    assert.ok(parseSetCookie(`a=fixture; ${attrs}`, "https://api.example.test/").expiresAt > Date.now());
  }
  assert.equal(cookieHeader([cookie("zero", { expiresAt: 0 })], "https://api.example.test/"), undefined);
  const jar = mergeSetCookies([cookie("a")], ["a=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 2099 00:00:00 GMT"], "https://api.example.test/");
  assert.deepEqual(jar, []);
});

test("manual OAuth retains init/authenticate cookies in a fresh encrypted import and never replays a code", async (t) => {
  const { runtime, auth } = await authFixture(t);
  let state;
  let exchanges = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    if (url.endsWith("/init")) {
      state = JSON.parse(init.body).state_code;
      return new Response(JSON.stringify({ url: "https://login.example.test/" }), { headers: { "set-cookie": "init=fixture; Secure; HttpOnly" } });
    }
    exchanges += 1;
    assert.equal(init.headers.cookie, "init=fixture");
    return new Response(JSON.stringify({ token: currentIdentity(), privy_access_token: "fixture-access", refresh_token: "fixture-refresh" }), {
      headers: { "set-cookie": "session=fixture; Path=/; Secure; HttpOnly" },
    });
  });
  const manager = new ManualOAuthManager(runtime, auth);
  const flow = await manager.create();
  const callback = `https://fomo.family/favicon.ico?privy_oauth_code=fixture&privy_oauth_state=${state}`;
  const result = await manager.complete(flow.id, callback);
  assert.equal(result.status, "captured");
  assert.equal(await auth.cookiesFor("https://auth.example.test/api/v1/oauth/read"), "init=fixture; session=fixture");
  const reloaded = new AuthManager(runtime);
  assert.equal((await reloaded.browserCookies()).length, 2);
  await assert.rejects(manager.complete(flow.id, callback), /already attempted/);
  assert.equal(exchanges, 1);
});

test("manual OAuth init and code exchange enforce deadlines and streaming limits without retries", async (t) => {
  const { runtime, auth } = await authFixture(t);
  for (const phase of ["init", "authenticate"]) {
    for (const failure of ["timeout", "size"]) {
      let state;
      let calls = 0;
      t.mock.method(globalThis, "fetch", async (url, init) => {
        calls += 1;
        if (url.endsWith("/init")) {
          state = JSON.parse(init.body).state_code;
          if (phase !== "init") return new Response(JSON.stringify({ url: "https://login.example.test/" }));
        }
        if (failure === "timeout") return new Promise(() => {});
        return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1025)); } }));
      });
      const manager = new ManualOAuthManager(runtime, auth);
      const flow = await manager.create();
      const result = phase === "init" ? flow : await manager.complete(flow.id, `https://fomo.family/token?privy_oauth_code=fixture&privy_oauth_state=${state}`);
      assert.equal(result.status, "failed");
      assert.match(result.error, failure === "timeout" ? /timed out/ : /configured limit/);
      assert.equal(calls, phase === "init" ? 1 : 2);
      if (phase === "authenticate") await assert.rejects(manager.complete(flow.id, `https://fomo.family/token?privy_oauth_code=fixture&privy_oauth_state=${state}`), /already attempted/);
      t.mock.restoreAll();
    }
  }
});

test("browser and OAuth bounded readers stop early, count bytes and handle stalled bodies", async (t) => {
  for (const browser of [false, true]) {
    let reads = 0;
    let cancelled = false;
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
      pull(controller) { reads += 1; controller.enqueue(new Uint8Array(9)); },
      cancel() { cancelled = true; },
    })));
    if (browser) assert.match((await browserFetch(browserArgs)).error, /configured limit/);
    else await assert.rejects(boundedFetch(browserArgs.url, {}, 50, 8), /configured limit/);
    assert.ok(reads <= 2, `read too many chunks: ${reads}`);
    assert.equal(cancelled, true);
    t.mock.restoreAll();
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })));
    if (browser) assert.match((await browserFetch(browserArgs)).error, /timed out/);
    else await assert.rejects(boundedFetch(browserArgs.url, {}, 50, 8), /timed out/);
    t.mock.restoreAll();
    t.mock.method(globalThis, "fetch", async () => new Response("🙂"));
    if (browser) assert.equal((await browserFetch({ ...browserArgs, maxBytes: 4 })).body, "🙂");
    else assert.equal((await boundedFetch(browserArgs.url, {}, 50, 4)).body, "🙂");
    t.mock.restoreAll();
  }
});

test("browser transport seeds persisted scope and saves rotations and deletions without Set-Cookie access", async (t) => {
  const { runtime, auth } = await authFixture(t);
  await auth.importState({ idToken: currentIdentity(), cookies: [cookie("old"), cookie("other", { domain: "other.example.test" })] });
  let jar = [];
  let stage = 0;
  const context = {
    clearCookies: async () => { jar = []; },
    addCookies: async (values) => { jar = values.map((value) => ({ ...value, expires: value.expires ?? -1, sameSite: value.sameSite ?? "Lax" })); },
    cookies: async () => jar,
  };
  const page = { context: () => context, evaluate: async (fn, args) => fn(args) };
  const transport = new BrowserTransport(runtime, auth);
  transport.sharedPage = async () => page;
  transport.close = async () => {};
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.credentials, "include");
    assert.equal(jar.some((c) => c.name === "other" && c.domain === "other.example.test"), true);
    if (stage++ === 0) {
      assert.equal(jar.find((c) => c.name === "old").domain, "api.example.test");
      jar = jar.filter((c) => c.name !== "old");
      jar.push({ name: "rotated", value: "fixture", domain: ".example.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax", expires: -1 });
    } else {
      assert.equal(jar.some((c) => c.name === "old"), false);
      assert.equal(jar.find((c) => c.name === "rotated").domain, ".example.test");
      jar = jar.filter((c) => c.name !== "rotated");
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
  });
  const request = { url: browserArgs.url, method: "GET", auth: "identity", retryable: true };
  await Promise.all([transport.request(request), transport.request(request)]);
  const persisted = await new AuthManager(runtime).browserCookies();
  assert.deepEqual(persisted.map((c) => c.name), ["other"]);
  assert.equal(stage, 2);
});

test("browser transport also bounds a stalled page.evaluate", async (t) => {
  const { runtime, auth } = await authFixture(t);
  const transport = new BrowserTransport(runtime, auth);
  transport.sharedPage = async () => ({ context: () => ({ clearCookies: async () => {}, addCookies: async () => {} }), evaluate: () => new Promise(() => {}) });
  transport.close = async () => {};
  await assert.rejects(transport.request({ url: browserArgs.url, method: "GET", auth: "none", retryable: false }), /timed out/);
});

test("Retry-After and backoff respect configuration and Node timer bounds in both transports", async (t) => {
  assert.equal(retryAfterMs("9999999999999999999999999999"), MAX_TIMER_DELAY_MS);
  assert.equal(retryAfterMs("Thu, 01 Jan 2099 00:00:00 GMT"), MAX_TIMER_DELAY_MS);
  assert.equal(retryAfterMs("-2"), 0);
  assert.equal(retryAfterMs("invalid"), undefined);
  const http = { ...base.http, requestTimeoutMs: 25, retryBaseDelayMs: 0, respectRetryAfter: false };
  assert.equal(retryDelayMs(http, 1, "99999999999"), 0);
  assert.equal(retryDelayMs({ ...http, respectRetryAfter: true }, 1, "99999999999"), 25);
  assert.equal(retryDelayMs({ ...http, retryBaseDelayMs: 300 }, 1024), 25);
  for (const browser of [false, true]) {
    const runtime = { ...structuredClone(base), http: { ...http, maxRetries: 1 } };
    const auth = { ensureSession: async () => undefined, cookiesFor: async () => undefined, updateCookies: async () => {}, browserCookies: async () => [], replaceBrowserCookies: async () => {} };
    const transport = browser ? new BrowserTransport(runtime, auth) : new FetchTransport(runtime, auth);
    let attempts = 0;
    const context = { clearCookies: async () => {}, addCookies: async () => {}, cookies: async () => [] };
    if (browser) {
      transport.sharedPage = async () => ({ context: () => context, evaluate: async (fn, args) => fn(args) });
      transport.close = async () => {};
    }
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: ++attempts === 1 ? 429 : 200, headers: { "retry-after": "9999999999999999" } }));
    const result = await transport.request({ url: browserArgs.url, method: "GET", auth: "none", retryable: true });
    assert.equal(result.attempts, 2);
    t.mock.restoreAll();
  }
});

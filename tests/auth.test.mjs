import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthManager, sessionTokensFromCookies } from "../dist/auth/auth-manager.js";
import { BrowserLoginManager } from "../dist/auth/browser-login.js";
import { ManualOAuthManager } from "../dist/auth/manual-oauth.js";
import { FetchTransport } from "../dist/http/fetch-transport.js";

const base = JSON.parse(await readFile(new URL("../config/runtime.json", import.meta.url), "utf8"));
const jwt = (offset) => `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString("base64url")}.x`;

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-auth-test-"));
  const runtime = structuredClone(base);
  runtime.apiBases.privy = "https://auth.example.test";
  runtime.http.requestTimeoutMs = 50;
  runtime.http.maxResponseBytes = 1024;
  runtime.auth = { ...runtime.auth, allowEnvironmentTokens: false, stateFile: path.join(directory, "auth.enc.json"), masterKeyEnv: "FOMO_AUTH_TEST_KEY" };
  process.env.FOMO_AUTH_TEST_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  t.after(async () => { delete process.env.FOMO_AUTH_TEST_KEY; await rm(directory, { recursive: true, force: true }); });
  const auth = new AuthManager(runtime);
  await auth.importState({ idToken: jwt(-60), accessToken: jwt(-60), refreshToken: "fixture-refresh", cookies: [] });
  return { runtime, auth };
}

test("refresh uses the configured Privy base, forbids redirects and shares rotation", async (t) => {
  const { runtime, auth } = await fixture(t);
  const fresh = jwt(3600);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls += 1;
    assert.equal(url, `${runtime.apiBases.privy}/api/v1/sessions`);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ token: fresh, privy_access_token: fresh, refresh_token: "rotated-refresh" }));
  });
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => auth.ensureSession("identity"))), Array(6).fill(fresh));
  assert.equal(calls, 1);
  assert.equal((await new AuthManager(runtime).status()).reauthRequired, false);
});

test("refresh bounds a stalled streamed body and response size without rotating state", async (t) => {
  for (const failure of ["timeout", "size"]) {
    await t.test(failure, async (t) => {
      const { runtime, auth } = await fixture(t);
      let calls = 0;
      t.mock.method(globalThis, "fetch", async (_url, init) => {
        calls += 1;
        if (failure === "timeout") {
          return new Response(new ReadableStream({ start(controller) {
            init.signal.addEventListener("abort", () => controller.error(new Error("fixture aborted")), { once: true });
          } }));
        }
        return new Response("x".repeat(runtime.http.maxResponseBytes + 1));
      });
      const before = await readFile(runtime.auth.stateFile, "utf8");
      await assert.rejects(auth.refreshSession(), failure === "timeout" ? /timed out/ : /configured limit/);
      assert.equal(calls, 1);
      assert.equal(await readFile(runtime.auth.stateFile, "utf8"), before);
    });
  }
});

test("refresh rejects malformed token pairs and reports rejected sessions without secrets", async (t) => {
  const { runtime, auth } = await fixture(t);
  const before = await readFile(runtime.auth.stateFile, "utf8");
  for (const value of [null, [], { privy_access_token: { secret: "fixture-secret" }, refresh_token: "fixture-refresh" }, { privy_access_token: "fixture-access", refresh_token: "" }]) {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(value)));
    await assert.rejects(auth.refreshSession(), /complete rotated token pair/);
    assert.equal(await readFile(runtime.auth.stateFile, "utf8"), before);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("fixture-secret", { status: 401 }));
  await assert.rejects(auth.refreshSession(), (error) => error.name === "ReauthRequiredError" && !error.message.includes("fixture-secret"));
});

test("a refresh network failure is not retried by the data transport", async (t) => {
  const { runtime, auth } = await fixture(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; throw new TypeError("fixture-secret"); });
  const transport = new FetchTransport(runtime, auth);
  await assert.rejects(transport.request({ method: "GET", url: "https://api.example.test/read", auth: "identity", retryable: true }),
    (error) => error.name === "TransportError" && error.message === "Privy refresh request failed");
  assert.equal(calls, 1);
});

test("an in-flight refresh cannot overwrite a later login", async (t) => {
  const { runtime, auth } = await fixture(t);
  const fresh = jwt(7200);
  t.mock.method(globalThis, "fetch", async () => {
    await new AuthManager(runtime).importState({ idToken: fresh, accessToken: fresh, refreshToken: "new-login-refresh" });
    return new Response(JSON.stringify({ token: jwt(3600), privy_access_token: jwt(3600), refresh_token: "old-session-rotation" }));
  });
  assert.equal(await auth.ensureSession("identity"), fresh);
  assert.equal(await new AuthManager(runtime).ensureSession("identity"), fresh);
});

test("browser navigation errors never return the callback code", async (t) => {
  const { runtime, auth } = await fixture(t);
  const manager = new BrowserLoginManager(runtime, auth);
  const id = "fixture-flow";
  manager.pages.set(id, { goto: async (url) => { throw new Error(`Navigation failed at ${url}`); } });
  manager.flows.set(id, { id, status: "awaiting_login", authorizationUrl: "https://accounts.google.com/oauth?state=fixture-secret" });
  const safeError = (error) => !error.message.includes("fixture-secret") && /Could not open/.test(error.message);
  await assert.rejects(manager.submitRedirect(id, "https://fomo.family/token?privy_oauth_code=fixture-secret&privy_oauth_state=fixture-state"), safeError);
  await assert.rejects(manager.openAuthorization(id), safeError);
});

test("identity readiness derives from JWT exp and ignores supplied expiry overrides", async (t) => {
  const { auth } = await fixture(t);
  for (const idToken of ["fixture-opaque", "e30.bnVsbA.x", jwt(-60), jwt(0)]) {
    await auth.importState({ idToken, identityTokenExpiresAt: "2099-01-01T00:00:00Z" });
    assert.equal((await auth.status()).reauthRequired, true);
    await assert.rejects(auth.ensureSession("identity"), /Identity token is expired/);
  }
  const fresh = jwt(3600);
  await auth.importState({ idToken: fresh, identityTokenExpiresAt: "2000-01-01T00:00:00Z" });
  assert.equal((await auth.status()).reauthRequired, false);
  assert.equal(await auth.ensureSession("identity"), fresh);
});

test("manual OAuth expires unused flows and rejects callbacks outside the exact origin", async (t) => {
  const { runtime, auth } = await fixture(t);
  let state;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls += 1;
    assert.equal(init.redirect, "error");
    state = JSON.parse(init.body).state_code;
    return new Response(JSON.stringify({ url: "https://accounts.google.com/oauth" }));
  });
  const manager = new ManualOAuthManager(runtime, auth);
  const flow = await manager.create();
  for (const prefix of ["https://fomo.family:444/token", "https://user@fomo.family/token", "https://fomo.family/other"]) {
    await assert.rejects(manager.complete(flow.id, `${prefix}?privy_oauth_code=fixture&privy_oauth_state=${state}`), /Redirect URL/);
  }
  const realNow = Date.now();
  t.mock.method(Date, "now", () => realNow + runtime.auth.browserLoginTimeoutMs + 1);
  assert.equal(manager.get(flow.id).status, "failed");
  assert.equal(manager.get(flow.id).authorizationUrl, undefined);
  await assert.rejects(manager.complete(flow.id, `https://fomo.family/token?privy_oauth_code=fixture&privy_oauth_state=${state}`), /expired/);
  assert.equal(calls, 1);
});

test("manual OAuth never imports an expired or unreadable identity", async (t) => {
  const { runtime, auth } = await fixture(t);
  const before = await readFile(runtime.auth.stateFile, "utf8");
  for (const token of [jwt(-60), "fixture-opaque"]) {
    let state;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url.endsWith("/init")) {
        state = JSON.parse(init.body).state_code;
        return new Response(JSON.stringify({ url: "https://accounts.google.com/oauth" }));
      }
      return new Response(JSON.stringify({ token, privy_access_token: "fixture-access", refresh_token: "fixture-refresh" }));
    });
    const manager = new ManualOAuthManager(runtime, auth);
    const flow = await manager.create();
    const result = await manager.complete(flow.id, `https://fomo.family/token?privy_oauth_code=fixture&privy_oauth_state=${state}`);
    assert.equal(result.status, "failed");
    assert.match(result.error, /expired or unreadable identity/);
    assert.equal(await readFile(runtime.auth.stateFile, "utf8"), before);
    t.mock.restoreAll();
  }
});

test("browser capture ignores untrusted origins and stale tokens without replacing auth", async (t) => {
  const { runtime, auth } = await fixture(t);
  runtime.auth.browserLoginTimeoutMs = 1;
  const before = await readFile(runtime.auth.stateFile, "utf8");
  for (const untrusted of [false, true]) {
    const handlers = {};
    const page = {
      on: (event, handler) => { handlers[event] = handler; },
      url: () => "https://accounts.google.com/oauth",
      evaluate: async () => assert.fail("must not read Google localStorage"),
      goto: async () => {
        handlers.request({ url: () => untrusted ? `${runtime.apiBases.fomo}.untrusted.test/read` : `${runtime.apiBases.fomo}/read`, headers: () => ({ authorization: `Bearer ${untrusted ? jwt(3600) : jwt(-60)}` }) });
        await handlers.response({ url: () => untrusted ? `https://untrusted.test/?next=${runtime.apiBases.privy}/api/v1/oauth/authenticate` : `${runtime.apiBases.privy}/api/v1/oauth/authenticate`, ok: () => true,
          json: async () => ({ identity_token: untrusted ? jwt(3600) : jwt(-60), privy_access_token: "fixture-access", refresh_token: "fixture-refresh" }) });
      },
    };
    const context = { pages: () => [page], cookies: async () => [], close: async () => {} };
    const manager = new BrowserLoginManager(runtime, auth);
    manager.launchOrdinaryChrome = async () => ({ contexts: () => [context], close: async () => {} });
    const started = manager.create();
    for (let attempt = 0; attempt < 50 && manager.get(started.id).status !== "failed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(manager.get(started.id).status, "failed");
    assert.match(manager.get(started.id).error, /timed out|required session tokens/);
    assert.equal(await readFile(runtime.auth.stateFile, "utf8"), before);
  }
});

test("browser captures current identity without losing it to a token-pair-only response", async (t) => {
  const { runtime, auth } = await fixture(t);
  const fresh = jwt(3600);
  const handlers = {};
  const page = {
    on: (event, handler) => { handlers[event] = handler; },
    url: () => runtime.http.origin,
    evaluate: async () => assert.fail("must not replace a captured token pair from localStorage"),
    goto: async () => {
      handlers.request({ url: () => `${runtime.apiBases.fomo}/read`, headers: () => ({ authorization: `Bearer ${fresh}` }) });
      await handlers.response({ url: () => `${runtime.apiBases.privy}/api/v1/oauth/authenticate`, ok: () => true,
        json: async () => ({ privy_access_token: "fixture-access", refresh_token: "fixture-refresh" }) });
    },
  };
  const context = { pages: () => [page], cookies: async () => [], close: async () => {} };
  const manager = new BrowserLoginManager(runtime, auth);
  manager.launchOrdinaryChrome = async () => ({ contexts: () => [context], close: async () => {} });
  const started = manager.create();
  for (let attempt = 0; attempt < 50 && manager.get(started.id).status !== "captured"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(manager.get(started.id).status, "captured");
  assert.equal(await auth.ensureSession("identity"), fresh);
});

function cookieSession(runtime, token) {
  return [
    { name: "privy-token", value: token, domain: new URL(runtime.http.origin).hostname },
    { name: "privy-access-token", value: token, domain: new URL(runtime.apiBases.privy).hostname },
    { name: "privy-refresh-token", value: "fixture-cookie-refresh", domain: new URL(runtime.apiBases.privy).hostname },
  ].map((cookie) => ({ ...cookie, path: "/", secure: true, httpOnly: true }));
}

function cookieResponse(runtime, token) {
  const headers = new Headers();
  for (const cookie of cookieSession(runtime, token)) headers.append("set-cookie", `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=/; Secure; HttpOnly`);
  return new Response("{}", { headers });
}

test("HttpOnly session cookies require configured origins and a current scope", async (t) => {
  const { runtime } = await fixture(t);
  const fresh = jwt(3600);
  const cookies = cookieSession(runtime, fresh);
  assert.deepEqual(sessionTokensFromCookies(cookies, runtime), { idToken: fresh, accessToken: fresh, refreshToken: "fixture-cookie-refresh" });
  assert.deepEqual(sessionTokensFromCookies(cookies.map((cookie) => ({ ...cookie, domain: "untrusted.test" })), runtime), { idToken: undefined, accessToken: undefined, refreshToken: undefined });
  assert.equal(sessionTokensFromCookies(cookies.map((cookie) => ({ ...cookie, expiresAt: 0 })), runtime).idToken, undefined);
  assert.equal(sessionTokensFromCookies(cookies.map((cookie) => ({ ...cookie, value: "deprecated" })), runtime).refreshToken, undefined);
});

test("browser captures HttpOnly credentials when legacy localStorage is deprecated", async (t) => {
  const { runtime, auth } = await fixture(t);
  runtime.apiBases.privy = "https://privy.fomo.family";
  const fresh = jwt(3600);
  const page = { on: () => {}, url: () => runtime.http.origin, goto: async () => {},
    evaluate: async () => assert.fail("current HttpOnly cookies must not require deprecated storage") };
  const context = { pages: () => [page], cookies: async () => cookieSession(runtime, fresh).map((cookie) => ({ ...cookie, expires: -1, sameSite: "Lax" })), close: async () => {} };
  const manager = new BrowserLoginManager(runtime, auth);
  manager.launchOrdinaryChrome = async () => ({ contexts: () => [context], close: async () => {} });
  const started = manager.create();
  for (let attempt = 0; attempt < 50 && manager.get(started.id).status !== "captured"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(manager.get(started.id).status, "captured");
  assert.equal(await new AuthManager(runtime).ensureSession("identity"), fresh);
});

test("refresh accepts fresh HttpOnly rotation cookies without JSON credentials", async (t) => {
  const { runtime, auth } = await fixture(t);
  runtime.apiBases.privy = "https://privy.fomo.family";
  const fresh = jwt(3600);
  t.mock.method(globalThis, "fetch", async () => cookieResponse(runtime, fresh));
  assert.equal(await auth.ensureSession("identity"), fresh);
  assert.equal((await new AuthManager(runtime).status()).reauthRequired, false);
});

test("manual OAuth imports credentials supplied only in scoped HttpOnly cookies", async (t) => {
  const { runtime, auth } = await fixture(t);
  runtime.apiBases.privy = "https://privy.fomo.family";
  const fresh = jwt(3600);
  let state;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/init")) { state = JSON.parse(init.body).state_code; return new Response(JSON.stringify({ url: "https://accounts.google.com/oauth" })); }
    return cookieResponse(runtime, fresh);
  });
  const manager = new ManualOAuthManager(runtime, auth);
  const flow = await manager.create();
  const result = await manager.complete(flow.id, `https://fomo.family/token?privy_oauth_code=fixture&privy_oauth_state=${state}`);
  assert.equal(result.status, "captured");
  assert.equal(await new AuthManager(runtime).ensureSession("identity"), fresh);
});

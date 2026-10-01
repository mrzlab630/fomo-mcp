import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthManager } from "../dist/auth/auth-manager.js";
import { BrowserTransport } from "../dist/http/browser-transport.js";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const baseRuntime = JSON.parse(await readFile(path.join(projectRoot, "config/runtime.json"), "utf8"));

function tokenWithExpiry(exp) {
  return `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.x`;
}

async function waitForResponse(child, url) {
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetch(url);
    } catch {
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`daemon did not listen: ${stderr}`);
}

async function stop(child, signal = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill(signal);
  await exited;
}

test("/readyz is false when identity reauthorization is required", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-readyz-"));
  const port = 18387;
  const runtimePath = path.join(directory, "runtime.json");
  const authPath = path.join(directory, "auth-state.enc.json");
  await writeFile(runtimePath, JSON.stringify({ ...baseRuntime, daemon: { ...baseRuntime.daemon, healthPort: port }, auth: { ...baseRuntime.auth, stateFile: authPath } }));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const run = async (exp) => {
    const child = spawn(process.execPath, ["dist/daemon.js"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        FOMO_MCP_RUNTIME_CONFIG: runtimePath,
        FOMO_MCP_ENDPOINTS_CONFIG: path.join(projectRoot, "config/endpoints.json"),
        FOMO_MCP_AUTH_FILE: authPath,
        FOMO_MCP_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        FOMO_ID_TOKEN: tokenWithExpiry(exp),
        FOMO_ACCESS_TOKEN: "",
        FOMO_REFRESH_TOKEN: "",
        FOMO_COOKIES_JSON: "",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    try {
      const response = await waitForResponse(child, `http://127.0.0.1:${port}/readyz`);
      const body = await response.json();
      return { status: response.status, ready: body.ready, reauthRequired: body.auth.reauthRequired };
    } finally {
      await stop(child);
    }
  };

  assert.deepEqual(await run(Math.floor(Date.now() / 1000) - 60), { status: 503, ready: false, reauthRequired: true });
  assert.deepEqual(await run(Math.floor(Date.now() / 1000) + 3600), { status: 200, ready: true, reauthRequired: false });
});

test("/auth/form serves a user-facing connection screen", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-auth-form-"));
  const port = 18388;
  const runtimePath = path.join(directory, "runtime.json");
  const authPath = path.join(directory, "auth-state.enc.json");
  await writeFile(runtimePath, JSON.stringify({ ...baseRuntime, daemon: { ...baseRuntime.daemon, healthPort: port }, auth: { ...baseRuntime.auth, stateFile: authPath } }));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const child = spawn(process.execPath, ["dist/daemon.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FOMO_MCP_RUNTIME_CONFIG: runtimePath,
      FOMO_MCP_ENDPOINTS_CONFIG: path.join(projectRoot, "config/endpoints.json"),
      FOMO_MCP_AUTH_FILE: authPath,
      FOMO_MCP_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      FOMO_ID_TOKEN: "",
      FOMO_ACCESS_TOKEN: "",
      FOMO_REFRESH_TOKEN: "",
      FOMO_COOKIES_JSON: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    const response = await waitForResponse(child, `http://127.0.0.1:${port}/auth/form`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Connect your FOMO account/);
    assert.match(html, /Continue with FOMO/);
    assert.doesNotMatch(html, /<pre|privy_oauth_code|reauthRequired|accessToken|refreshToken/);
  } finally {
    await stop(child);
  }
});

test("browser startup failure removes its temporary profile", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-browser-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = structuredClone(baseRuntime);
  runtime.auth.stateFile = path.join(directory, "auth-state.enc.json");
  runtime.transport.browser = { ...runtime.transport.browser, executablePath: "/bin/false" };
  const auth = new AuthManager(runtime);
  await auth.initialize();
  const before = new Set((await readdir(os.tmpdir())).filter((name) => name.startsWith("fomo-mcp-api-")));
  const transport = new BrowserTransport(runtime, auth);
  await assert.rejects(transport.request({ method: "GET", url: `${runtime.apiBases.fomo}/health`, auth: "none", retryable: false }));
  await transport.close();
  const after = (await readdir(os.tmpdir())).filter((name) => name.startsWith("fomo-mcp-api-"));
  assert.deepEqual(after.filter((name) => !before.has(name)), []);
});

test("SIGTERM during browser startup removes the temporary profile", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-browser-signal-"));
  const fakeChrome = path.join(directory, "fake-chrome.sh");
  const runtimePath = path.join(directory, "runtime.json");
  await writeFile(fakeChrome, "#!/bin/sh\nsleep 60\n");
  await chmod(fakeChrome, 0o700);
  const runtime = structuredClone(baseRuntime);
  runtime.auth.stateFile = path.join(directory, "auth-state.enc.json");
  runtime.transport.browser = { ...runtime.transport.browser, executablePath: fakeChrome };
  await writeFile(runtimePath, JSON.stringify(runtime));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { readFile } from "node:fs/promises";
    import { AuthManager } from "${path.join(projectRoot, "dist/auth/auth-manager.js")}";
    import { BrowserTransport } from "${path.join(projectRoot, "dist/http/browser-transport.js")}";
    const runtime = JSON.parse(await readFile(${JSON.stringify(runtimePath)}, "utf8"));
    const auth = new AuthManager(runtime);
    await auth.initialize();
    const transport = new BrowserTransport(runtime, auth);
    await transport.request({ method: "GET", url: runtime.apiBases.fomo + "/health", auth: "none", retryable: false }).catch(() => undefined);
  `], { cwd: projectRoot, env: { ...process.env, FOMO_MCP_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", FOMO_ID_TOKEN: "", FOMO_ACCESS_TOKEN: "", FOMO_REFRESH_TOKEN: "", FOMO_COOKIES_JSON: "" }, stdio: ["ignore", "ignore", "pipe"] });
  try {
    let profile;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const names = (await readdir(os.tmpdir())).filter((name) => name.startsWith("fomo-mcp-api-"));
      if (names.length > 0) { profile = names[0]; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(profile, "browser profile was not created before signal");
    await stop(child, "SIGTERM");
    assert.equal((await readdir(os.tmpdir())).filter((name) => name.startsWith("fomo-mcp-api-" )).includes(profile), false);
  } finally {
    if (child.exitCode === null) await stop(child, "SIGKILL");
  }
});

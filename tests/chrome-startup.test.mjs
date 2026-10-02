import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { waitForChromeEndpoint } from "../dist/http/chrome-startup.js";

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

test("Chrome startup reads split stderr and removes its listeners", { timeout: 5000 }, async (t) => {
  const child = spawn(process.execPath, ["-e", `
    process.stderr.write("DevTools listening on ws://127.0.0.1:9222/devtools/");
    setTimeout(() => process.stderr.write("browser/test\\n"), 50);
    process.stdin.resume();
  `], { stdio: ["pipe", "ignore", "pipe"] });
  t.after(() => stop(child));
  assert.equal(await waitForChromeEndpoint(child), "ws://127.0.0.1:9222/devtools/browser/test");
  assert.equal(child.stderr.listenerCount("data"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("Chrome startup accepts a fresh active-port file without stderr", { timeout: 5000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fomo-cdp-startup-"));
  await writeFile(path.join(directory, "DevToolsActivePort"), "not-ready\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { writeFile } from "node:fs/promises";
    import { join } from "node:path";
    await writeFile(join(process.argv[1], "DevToolsActivePort"), "9223\\n/devtools/browser/test\\n");
    process.stdin.resume();
  `, directory], { stdio: ["pipe", "ignore", "pipe"] });
  t.after(async () => {
    await stop(child);
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(await waitForChromeEndpoint(child, { temporaryProfile: directory }), "ws://127.0.0.1:9223/devtools/browser/test");
  assert.equal(child.stderr.listenerCount("data"), 0);
  assert.equal(child.listenerCount("exit"), 0);
});

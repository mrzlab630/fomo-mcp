import { createServer } from "node:http";
import { loadEndpointMap, loadRuntimeConfig } from "./config/load.js";
import { AuthManager } from "./auth/auth-manager.js";
import { BrowserLoginManager } from "./auth/browser-login.js";
import { ManualOAuthManager } from "./auth/manual-oauth.js";

const runtime = await loadRuntimeConfig();
const endpointMap = await loadEndpointMap();
const auth = new AuthManager(runtime);
await auth.initialize();
const browserLogin = new BrowserLoginManager(runtime, auth);
const manualOAuth = new ManualOAuthManager(runtime, auth);
const startedAt = new Date().toISOString();

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.url === "/healthz") {
    response.writeHead(200);
    response.end(JSON.stringify({ ok: true, service: runtime.appName, startedAt }));
    return;
  }
  if (request.url === "/readyz") {
    const status = await auth.status();
    response.writeHead(status.available ? 200 : 503);
    response.end(JSON.stringify({ ready: status.available, auth: status }));
    return;
  }
  if (request.url === "/auth/status") {
    response.writeHead(200);
    response.end(JSON.stringify(await auth.status()));
    return;
  }
  if (request.url === "/auth/form" || request.url?.startsWith("/auth/form?")) {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.writeHead(200);
    response.end(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FOMO authorization</title>
<style>body{font:16px system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.7rem 1rem}pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem;border-radius:.4rem}</style>
<h1>FOMO authorization</h1>
<p>Start a separate visible Chrome login window. Complete login at fomo.family; this local page stores only the resulting session tokens and cookies in the encrypted local store.</p>
<button id="start">Start authorization</button><pre id="status">Idle</pre>
<hr><button id="manualStart">Start Google link flow</button>
<div id="manualOAuth" hidden>
<p>Open the link in your normal browser. After login, copy the complete callback address (usually <code>https://fomo.family/favicon.ico?...privy_oauth_code=...</code>) and paste it below. The redirect is processed locally.</p>
<a id="manualLink" target="_blank" rel="noreferrer"></a>
<form id="manualForm"><input id="manualRedirect" required size="70" placeholder="https://fomo.family/?privy_oauth_code=..."><button>Complete authorization</button></form>
</div>
<div id="manual" hidden>
<p>If Google opened in the regular browser, copy the complete callback address after login and paste it here. The address is processed only by the local daemon.</p>
<button id="google" type="button" hidden>Open Google authorization in auth window</button>
<form id="redirectForm"><input id="redirect" required size="70" placeholder="https://fomo.family/?privy_oauth_code=..."><button>Submit redirect</button></form>
</div>
<script>
const status = document.getElementById('status');
const manual = document.getElementById('manual');
const google = document.getElementById('google');
const redirect = document.getElementById('redirect');
let flowId;
let manualId;
const existingOAuth = new URLSearchParams(location.search).get('oauth');
const showManual = (current) => {
  manualId = current.id;
  status.textContent = JSON.stringify(current, null, 2);
  if (current.authorizationUrl) {
    document.getElementById('manualOAuth').hidden = false;
    const link = document.getElementById('manualLink');
    link.href = current.authorizationUrl;
    link.textContent = 'Open Google authorization';
  }
};
const pollManual = async (id) => {
  const current = await fetch('/auth/oauth/' + encodeURIComponent(id)).then(r => r.json());
  showManual(current);
  if (current.status !== 'captured' && current.status !== 'failed') setTimeout(() => pollManual(id), 1000);
};
const existingFlow = new URLSearchParams(location.search).get('flow');
const poll = async (id) => {
  flowId = id;
  const current = await fetch('/auth/session/' + encodeURIComponent(id)).then(r => r.json());
  status.textContent = JSON.stringify(current, null, 2);
  if (current.authorizationUrl) {
    manual.hidden = false;
    google.hidden = false;
  }
  if (current.status !== 'captured' && current.status !== 'failed') setTimeout(() => poll(id), 1000);
};
document.getElementById('start').onclick = async () => {
  status.textContent = 'Starting browser…';
  const started = await fetch('/auth/session/start', {method:'POST'}).then(r => r.json());
  if (!started.id) { status.textContent = JSON.stringify(started, null, 2); return; }
  poll(started.id);
};
document.getElementById('redirectForm').onsubmit = async (event) => {
  event.preventDefault();
  const result = await fetch('/auth/session/' + encodeURIComponent(flowId) + '/redirect', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({url: redirect.value})
  }).then(r => r.json());
  status.textContent = JSON.stringify(result, null, 2);
};
document.getElementById('manualStart').onclick = async () => {
  const started = await fetch('/auth/oauth/start', {method:'POST'}).then(r => r.json());
  showManual(started);
};
if (existingOAuth) pollManual(existingOAuth);
document.getElementById('manualForm').onsubmit = async (event) => {
  event.preventDefault();
  const result = await fetch('/auth/oauth/' + encodeURIComponent(manualId) + '/complete', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({url: document.getElementById('manualRedirect').value})
  }).then(r => r.json());
  status.textContent = JSON.stringify(result, null, 2);
};
google.onclick = async () => {
  const result = await fetch('/auth/session/' + encodeURIComponent(flowId) + '/open', {method: 'POST'}).then(r => r.json());
  status.textContent = JSON.stringify(result, null, 2);
};
if (existingFlow) poll(existingFlow);
</script></html>`);
    return;
  }
  if (request.url === "/auth/start") {
    response.writeHead(200);
    response.end(JSON.stringify({ authUrl: `http://${runtime.daemon.healthHost}:${runtime.daemon.healthPort}/auth/form`, expiresInMs: runtime.auth.browserLoginTimeoutMs }));
    return;
  }
  if (request.url === "/auth/oauth/start" && request.method === "POST") {
    response.writeHead(202);
    response.end(JSON.stringify(await manualOAuth.create("google")));
    return;
  }
  const manualOpenMatch = request.url?.match(/^\/auth\/oauth\/([^/?]+)\/open$/);
  if (manualOpenMatch && request.method === "GET") {
    const current = manualOAuth.get(decodeURIComponent(manualOpenMatch[1]!));
    if (!current) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "oauth_flow_not_found" }));
    } else if (!current.authorizationUrl) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: "oauth_authorization_url_not_ready" }));
    } else {
      response.writeHead(302, { location: current.authorizationUrl });
      response.end();
    }
    return;
  }
  const manualStatusMatch = request.url?.match(/^\/auth\/oauth\/([^/?]+)$/);
  if (manualStatusMatch && request.method === "GET") {
    const current = manualOAuth.get(decodeURIComponent(manualStatusMatch[1]!));
    if (!current) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "oauth_flow_not_found" }));
    } else {
      response.writeHead(200);
      response.end(JSON.stringify(current));
    }
    return;
  }
  const manualCompleteMatch = request.url?.match(/^\/auth\/oauth\/([^/?]+)\/complete$/);
  if (manualCompleteMatch && request.method === "POST") {
    try {
      const parsed = JSON.parse(await requestBody(request)) as { url?: unknown };
      if (typeof parsed.url !== "string") throw new Error("JSON body must contain a string url");
      const result = await manualOAuth.complete(decodeURIComponent(manualCompleteMatch[1]!), parsed.url);
      if (!response.headersSent) {
        response.writeHead(200);
        response.end(JSON.stringify(result));
      }
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    }
    return;
  }
  if (request.url === "/auth/session/start" && request.method === "POST") {
    response.writeHead(202);
    response.end(JSON.stringify(browserLogin.create()));
    return;
  }
  const flowMatch = request.url?.match(/^\/auth\/session\/([^/?]+)$/);
  const redirectMatch = request.url?.match(/^\/auth\/session\/([^/?]+)\/redirect$/);
  const openMatch = request.url?.match(/^\/auth\/session\/([^/?]+)\/open$/);
  if (openMatch && request.method === "POST") {
    try {
      response.writeHead(202);
      response.end(JSON.stringify(await browserLogin.openAuthorization(decodeURIComponent(openMatch[1]!))));
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (redirectMatch && request.method === "POST") {
    try {
      const parsed = JSON.parse(await requestBody(request)) as { url?: unknown };
      if (typeof parsed.url !== "string") throw new Error("JSON body must contain a string url");
      response.writeHead(202);
      response.end(JSON.stringify(await browserLogin.submitRedirect(decodeURIComponent(redirectMatch[1]!), parsed.url)));
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (flowMatch) {
    const flow = browserLogin.get(decodeURIComponent(flowMatch[1]!));
    if (!flow) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "auth_flow_not_found" }));
      return;
    }
    response.writeHead(200);
    response.end(JSON.stringify(flow));
    return;
  }
  if (request.url === "/config/status") {
    response.writeHead(200);
    response.end(JSON.stringify({ endpoints: endpointMap.endpoints.length, exposed: endpointMap.endpoints.filter((entry) => entry.expose).length, source: endpointMap.source }));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(runtime.daemon.healthPort, runtime.daemon.healthHost, () => {
  console.log(JSON.stringify({ event: "daemon_started", host: runtime.daemon.healthHost, port: runtime.daemon.healthPort, startedAt }));
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

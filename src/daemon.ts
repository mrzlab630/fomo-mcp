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
    const ready = status.available && !status.reauthRequired;
    response.writeHead(ready ? 200 : 503);
    response.end(JSON.stringify({ ready, auth: status }));
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to FOMO</title>
<style>
:root{color-scheme:light dark;--bg:#f3f6fb;--card:#fff;--text:#172033;--muted:#647089;--line:#dfe5ef;--accent:#635bff;--accent-strong:#5148e8;--accent-soft:#eeedff;--success:#16794c;--success-bg:#e9f8f0;--danger:#a43d3d;--danger-bg:#fff0f0;--shadow:0 24px 70px rgba(37,53,88,.14)}
@media(prefers-color-scheme:dark){:root{--bg:#0f131b;--card:#181e29;--text:#eef2fa;--muted:#a7b1c4;--line:#2d3748;--accent:#8d87ff;--accent-strong:#aaa6ff;--accent-soft:#28264b;--success:#70d5a0;--success-bg:#173528;--danger:#ff9d9d;--danger-bg:#432326;--shadow:0 24px 70px rgba(0,0,0,.35)}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 0%,rgba(99,91,255,.14),transparent 38%),var(--bg);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text)}
.shell{width:min(100%,480px)}.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:36px;box-shadow:var(--shadow)}.brand{display:flex;align-items:center;gap:10px;font-weight:750;letter-spacing:.03em;margin-bottom:28px}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:var(--accent);color:#fff;font-weight:800}.eyebrow{margin:0 0 8px;color:var(--accent-strong);font-size:13px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}h1{margin:0;font-size:clamp(27px,6vw,35px);line-height:1.15;letter-spacing:-.03em}h2{margin:0;font-size:20px;line-height:1.25}.lead{margin:14px 0 0;color:var(--muted);max-width:38ch}.steps{display:grid;gap:14px;margin:30px 0;padding:0;list-style:none}.steps li{display:flex;gap:12px;align-items:flex-start;color:var(--muted)}.step-number{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:50%;background:var(--accent-soft);color:var(--accent-strong);font-size:13px;font-weight:750}.actions{display:grid;gap:12px;margin-top:26px}button,.link-button{min-height:48px;border:0;border-radius:12px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;text-align:center;transition:transform .15s ease,background .15s ease,opacity .15s ease}button:focus-visible,.link-button:focus-visible,input:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:3px}button:hover:not(:disabled),.link-button:hover{transform:translateY(-1px)}button:disabled{cursor:wait;opacity:.65}.primary{background:var(--accent);color:#fff}.primary:hover:not(:disabled){background:var(--accent-strong)}.secondary{background:transparent;color:var(--accent-strong);border:1px solid var(--line)}.link-button{display:grid;place-items:center;background:var(--accent-soft);color:var(--accent-strong);text-decoration:none}.status{display:flex;gap:10px;align-items:flex-start;margin-top:24px;padding:14px 16px;border-radius:14px;background:var(--accent-soft);color:var(--text)}.status.success{background:var(--success-bg);color:var(--success)}.status.error{background:var(--danger-bg);color:var(--danger)}.status-icon{font-size:19px;line-height:1.3}.panel{margin-top:26px;padding-top:26px;border-top:1px solid var(--line)}.panel p{margin:8px 0 18px;color:var(--muted)}.panel-actions{display:grid;gap:12px}.field{display:grid;gap:8px;margin-top:18px}.field label{font-weight:650}.field input{width:100%;min-height:48px;border:1px solid var(--line);border-radius:12px;padding:11px 13px;background:transparent;color:var(--text);font:inherit}.help{margin-top:24px;color:var(--muted);font-size:13px;text-align:center}.hidden{display:none!important}@media(max-width:520px){body{padding:14px}.card{padding:28px 22px;border-radius:20px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important}}
</style></head>
<body><main class="shell"><section class="card" aria-labelledby="title">
<div class="brand"><span class="brand-mark" aria-hidden="true">F</span><span>FOMO</span></div>
<p class="eyebrow">Local connection</p><h1 id="title">Connect your FOMO account</h1>
<p class="lead">Sign in once to let this local app read your FOMO data.</p>
<ol class="steps" aria-label="Connection steps"><li><span class="step-number">1</span><span>Open the secure FOMO sign-in window.</span></li><li><span class="step-number">2</span><span>Complete sign-in with your usual account.</span></li><li><span class="step-number">3</span><span>Return here when the connection is confirmed.</span></li></ol>
<div id="status" class="status hidden" role="status" aria-live="polite"><span id="statusIcon" class="status-icon" aria-hidden="true"></span><span id="statusText"></span></div>
<div id="actions" class="actions"><button id="start" class="primary" type="button">Continue with FOMO</button><button id="manualStart" class="secondary" type="button">Use another browser</button></div>
<section id="browserPanel" class="panel hidden" aria-live="polite"><h2 id="browserTitle">Connecting to FOMO</h2><p id="browserText"></p><div class="panel-actions"><button id="google" class="link-button hidden" type="button">Open sign-in window</button><button id="browserRestart" class="secondary hidden" type="button">Try again</button></div><form id="browserRedirectForm" class="hidden"><div class="field"><label for="browserRedirect">Did sign-in open in another browser?</label><input id="browserRedirect" required autocomplete="off" inputmode="url" placeholder="Paste the address shown after sign-in"></div><div class="panel-actions"><button class="secondary" type="submit">Finish here</button></div></form></section>
<section id="manualPanel" class="panel hidden"><h2>Continue in your browser</h2><p id="manualText">Open the sign-in page, complete the connection, then return here.</p><div class="panel-actions"><a id="manualLink" class="link-button hidden" target="_blank" rel="noreferrer">Open sign-in page</a></div><form id="manualForm" class="hidden"><div class="field"><label for="manualRedirect">Browser address</label><input id="manualRedirect" required autocomplete="off" inputmode="url" placeholder="Paste the address shown after sign-in"></div><div class="panel-actions"><button class="primary" type="submit">Finish connection</button></div></form><div class="panel-actions"><button id="manualRestart" class="secondary" type="button">Start over</button></div></section>
<p class="help">This page stays on your computer. Close it after the connection succeeds.</p>
</section></main>
<script>
const $ = (id) => document.getElementById(id);
const status = $('status');
const statusIcon = $('statusIcon');
const statusText = $('statusText');
const actions = $('actions');
const browserPanel = $('browserPanel');
const browserTitle = $('browserTitle');
const browserText = $('browserText');
const google = $('google');
const browserRestart = $('browserRestart');
const browserRedirectForm = $('browserRedirectForm');
const browserRedirect = $('browserRedirect');
const manualPanel = $('manualPanel');
const manualText = $('manualText');
const manualLink = $('manualLink');
const manualForm = $('manualForm');
const manualRedirect = $('manualRedirect');
const manualRestart = $('manualRestart');
let flowId;
let manualId;
let browserTimer;
let manualTimer;
const setStatus = (message, tone, icon) => { status.className = 'status' + (tone ? ' ' + tone : ''); statusIcon.textContent = icon || ''; statusText.textContent = message; };
const showStatus = (message, tone, icon) => { setStatus(message, tone, icon); status.classList.remove('hidden'); };
const hideStatus = () => status.classList.add('hidden');
const friendlyError = (error) => { const value = String(error || '').toLowerCase(); if (value.includes('closed')) return 'The sign-in window was closed before the connection finished.'; if (value.includes('timed out') || value.includes('timeout')) return 'The sign-in took too long. Please start again.'; return 'We could not finish the connection. Please try again.'; };
const request = async (url, options) => { const response = await fetch(url, options); let body = {}; try { body = await response.json(); } catch {} if (!response.ok) throw new Error(body.error || 'Request failed'); return body; };
const post = (url, body) => request(url, { method: 'POST', headers: body ? {'content-type':'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined });
const stopTimers = () => { clearTimeout(browserTimer); clearTimeout(manualTimer); };
const showReady = () => { stopTimers(); actions.classList.add('hidden'); browserPanel.classList.add('hidden'); manualPanel.classList.add('hidden'); browserRedirectForm.classList.add('hidden'); showStatus('Your FOMO account is connected. You can close this page.', 'success', '✓'); };
const showBrowserState = (current) => { browserPanel.classList.remove('hidden'); if (current.status === 'starting') { browserTitle.textContent = 'Preparing secure sign-in'; browserText.textContent = 'A sign-in window will open shortly.'; google.classList.add('hidden'); browserRedirectForm.classList.add('hidden'); browserRestart.classList.add('hidden'); showStatus('Preparing your connection…', '', ''); return; } if (current.status === 'awaiting_login') { browserTitle.textContent = 'Complete sign-in'; browserText.textContent = 'Finish signing in in the FOMO window. This page will update automatically.'; google.classList.toggle('hidden', !current.authorizationUrl); browserRedirectForm.classList.toggle('hidden', !current.authorizationUrl); browserRestart.classList.add('hidden'); showStatus('Waiting for sign-in…', '', ''); return; } if (current.status === 'capturing') { browserTitle.textContent = 'Finishing connection'; browserText.textContent = 'Your sign-in was received. We are finishing the connection.'; google.classList.add('hidden'); browserRedirectForm.classList.add('hidden'); browserRestart.classList.add('hidden'); showStatus('Finishing connection…', '', ''); return; } if (current.status === 'captured') { showReady(); return; } browserTitle.textContent = 'Connection not completed'; browserText.textContent = friendlyError(current.error); google.classList.add('hidden'); browserRedirectForm.classList.add('hidden'); browserRestart.classList.remove('hidden'); showStatus(friendlyError(current.error), 'error', '!'); };
const pollBrowser = async (id) => { try { const current = await request('/auth/session/' + encodeURIComponent(id)); showBrowserState(current); if (current.status !== 'captured' && current.status !== 'failed') browserTimer = setTimeout(() => pollBrowser(id), 1000); } catch (error) { browserRestart.classList.remove('hidden'); showStatus(friendlyError(error), 'error', '!'); } };
const startBrowser = async () => { stopTimers(); hideStatus(); actions.classList.add('hidden'); manualPanel.classList.add('hidden'); browserPanel.classList.remove('hidden'); google.classList.add('hidden'); browserRedirectForm.classList.add('hidden'); browserRestart.classList.add('hidden'); browserTitle.textContent = 'Preparing secure sign-in'; browserText.textContent = 'A sign-in window will open shortly.'; showStatus('Preparing your connection…', '', ''); try { const started = await post('/auth/session/start'); if (!started.id) throw new Error('Could not start sign-in'); flowId = started.id; pollBrowser(flowId); } catch (error) { browserTitle.textContent = 'Connection not started'; browserText.textContent = friendlyError(error); browserRestart.classList.remove('hidden'); showStatus(friendlyError(error), 'error', '!'); } };
const showManualState = (current) => { manualPanel.classList.remove('hidden'); if (current.authorizationUrl) { manualLink.href = current.authorizationUrl; manualLink.classList.remove('hidden'); } if (current.status === 'starting') { manualText.textContent = 'Preparing the sign-in page…'; manualForm.classList.add('hidden'); showStatus('Preparing your connection…', '', ''); return; } if (current.status === 'awaiting_login') { manualText.textContent = 'Complete sign-in in your browser, then paste the address shown after sign-in below.'; manualForm.classList.remove('hidden'); showStatus('Waiting for sign-in…', '', ''); return; } if (current.status === 'captured') { showReady(); return; } manualText.textContent = friendlyError(current.error); manualForm.classList.add('hidden'); showStatus(friendlyError(current.error), 'error', '!'); };
const pollManual = async (id) => { try { const current = await request('/auth/oauth/' + encodeURIComponent(id)); showManualState(current); if (current.status !== 'captured' && current.status !== 'failed') manualTimer = setTimeout(() => pollManual(id), 1000); } catch (error) { showStatus(friendlyError(error), 'error', '!'); } };
const startManual = async () => { stopTimers(); hideStatus(); actions.classList.add('hidden'); browserPanel.classList.add('hidden'); manualPanel.classList.remove('hidden'); manualLink.classList.add('hidden'); manualForm.classList.add('hidden'); try { const started = await post('/auth/oauth/start'); if (!started.id) throw new Error('Could not start sign-in'); manualId = started.id; showManualState(started); pollManual(manualId); } catch (error) { showStatus(friendlyError(error), 'error', '!'); } };
$('start').onclick = startBrowser;
$('manualStart').onclick = startManual;
browserRestart.onclick = startBrowser;
manualRestart.onclick = startManual;
google.onclick = async () => { google.disabled = true; try { const current = await post('/auth/session/' + encodeURIComponent(flowId) + '/open'); showBrowserState(current); } catch (error) { showStatus(friendlyError(error), 'error', '!'); } finally { google.disabled = false; } };
browserRedirectForm.onsubmit = async (event) => { event.preventDefault(); const value = browserRedirect.value.trim(); if (!value || !flowId) return; browserRedirectForm.querySelector('button').disabled = true; try { const current = await post('/auth/session/' + encodeURIComponent(flowId) + '/redirect', {url: value}); showBrowserState(current); if (current.status !== 'captured' && current.status !== 'failed') pollBrowser(flowId); } catch (error) { showStatus(friendlyError(error), 'error', '!'); } finally { browserRedirectForm.querySelector('button').disabled = false; } };
manualForm.onsubmit = async (event) => { event.preventDefault(); const value = manualRedirect.value.trim(); if (!value || !manualId) return; manualForm.querySelector('button').disabled = true; try { const current = await post('/auth/oauth/' + encodeURIComponent(manualId) + '/complete', {url: value}); showManualState(current); if (current.status !== 'captured' && current.status !== 'failed') pollManual(manualId); } catch (error) { showStatus(friendlyError(error), 'error', '!'); } finally { manualForm.querySelector('button').disabled = false; } };
const params = new URLSearchParams(location.search); const existingOAuth = params.get('oauth'); const existingFlow = params.get('flow'); if (existingOAuth) { actions.classList.add('hidden'); manualId = existingOAuth; pollManual(existingOAuth); } else if (existingFlow) { actions.classList.add('hidden'); flowId = existingFlow; pollBrowser(existingFlow); }
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

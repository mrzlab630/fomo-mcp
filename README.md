# fomo-mcp

Read-only MCP gateway for research data from `fomo.family` and explicitly configured auxiliary sources.

The project is intentionally built as replaceable components:

```text
config/endpoints.json       endpoint map and wire shapes
config/runtime.json         operational settings
src/auth/                   encrypted tokens and cookie jar
src/http/                   replaceable HTTP transport
src/endpoints/              endpoint request builder and invoker
src/mcp/                    read-only MCP registration
src/daemon.ts               PM2-managed health daemon
```

## Scope

The MCP surface is read-only. The endpoint map retains the swap quote and watchlist mutation routes as reference records from `ColinEdw/fomo-mcp`, but they are disabled (`expose: false`) and cannot be called by the MCP server. No wallet, signing, swap execution or transfer mutation code is included.

The endpoint map is a reverse-engineered reference, not an official FOMO API contract. Its provenance is recorded in `config/endpoints.json`; each route must be verified against an authorized source before production collection.

## Agent documentation

- [AI agent rules](AGENTS.md): sources of truth, read-only boundaries, auth gates, proof, and Git rules.
- [API catalog](docs/API.md): every MCP tool, upstream route, parameter shape, disabled record, and local daemon route.
- [Authentication](docs/AUTH.md): token model, Google/Privy flows, reauthorization, storage, and proof commands.

## Configuration

- `config/endpoints.json` is the single endpoint catalog. Add or change a route there instead of scattering paths through code.
- `config/runtime.json` contains fast-changing timeout, retry, auth, MCP and daemon settings.
- Override paths with `FOMO_MCP_RUNTIME_CONFIG`, `FOMO_MCP_ENDPOINTS_CONFIG` and `FOMO_MCP_AUTH_FILE`.

Endpoint parameters are exposed as top-level MCP input fields. The adapter builds path, query and body values from the catalog and handles the known `tokenAddress` to upstream `address` conversion for holders routes.

The configured transport is `hybrid`: Privy and auxiliary sources use direct fetch, while FOMO API calls run from an ordinary headed Chrome page because the FOMO edge rejects non-browser clients. The browser transport does not disable automation flags or spoof browser properties. It uses Chrome app mode (no tabs or address bar), starts minimized at the configured minimal window size (`1x1` by default), and requires a graphical Chrome session.

## Auth state

Tokens and cookies are never logged. The persistent state is encrypted with AES-256-GCM and written with mode `0600` under `data/`.

Generate a key and keep it in a secret manager or the process environment:

```bash
export FOMO_MCP_MASTER_KEY="$(npm run --silent auth:keygen)"
```

Create an import file outside the repository and import a manually obtained authorized session:

```json
{
  "idToken": "...",
  "accessToken": "...",
  "refreshToken": "...",
  "caId": "...",
  "cookies": [
    { "name": "name", "value": "value", "domain": ".fomo.family", "path": "/", "secure": true }
  ]
}
```

```bash
npm run auth:import -- /secure/path/auth-import.json
npm run auth:status
npm run auth:refresh
```

`auth:refresh` rotates the Privy access/refresh pair. It does not mint a new FOMO identity token; an expired identity token still requires interactive re-authentication and a new explicit import. Environment tokens are supported for ephemeral runs but are not persisted by default.

The project does not automate Google credential entry, scrape the user's normal Chrome profile, or extract credentials from DevTools. It uses only the dedicated FOMO MCP profile described below. Cookie values are accepted only through an explicit import or response `Set-Cookie` handling and are filtered by domain/path before sending.

### Interactive local authorization

The PM2 daemon provides a user-driven local flow. The MCP tool `fomo_auth_start` returns this link:

```text
http://127.0.0.1:8387/auth/form
```

The page starts a separate visible Chrome window with a dedicated persistent profile. On the first run, the user completes the normal FOMO/Google login there. Later runs reuse that profile's Google session, so the user normally only confirms the login instead of entering credentials again. The flow observes only that browser session, captures the ID/access/refresh values emitted by the FOMO/Privy login and the session cookies, then writes them to the encrypted auth store. It never prints the values. `fomo_auth_status` exposes only boolean availability, cookie count and an optional expiry timestamp.

The dedicated profile defaults to `~/.local/share/fomo-mcp/google-profile`. Override it with `FOMO_MCP_BROWSER_PROFILE_DIR` or `auth.browserProfileDir` in `config/runtime.json`. Do not point it at the user's normal Chrome profile. The profile contains a Google browser session and must be protected as sensitive local data.

When an identity token expires, a data tool returns `reauthRequired: true` and the same local link. The agent can send that link to the user and retry after `fomo_auth_status` reports a fresh session. The refresh endpoint can rotate access/refresh tokens, but it cannot mint a new identity token.

The browser flow uses ordinary visible Chrome and does not disable automation flags or spoof `navigator.webdriver`. It is a local interactive login helper, not a stealth collector. It requires a graphical session and a locally installed Google Chrome; on a headless host it fails with a status message and leaves the existing auth state untouched.

## Run MCP over stdio

```bash
npm install
npm run build
node dist/main.js
```

The MCP process is intended to be launched by an MCP host. It does not expose an HTTP control plane.

## PM2 daemon

PM2 manages the long-running health/readiness daemon. It does not put credentials in `ecosystem.config.cjs`.
Install PM2 separately as an operations dependency (the application dependency tree stays free of PM2's CLI transitive packages):

```bash
npm install --global pm2
```

```bash
npm run pm2:start
npm run pm2:status
curl http://127.0.0.1:8387/healthz
curl -i http://127.0.0.1:8387/readyz
npm run pm2:logs
```

`/healthz` proves the process is alive. `/readyz` returns `503` until an identity token is available. `/auth/status` returns metadata only and never token values. `collectorEnabled` is false until an authorized source and collection policy are accepted.

## Design differences from `ColinEdw/fomo-mcp`

- endpoint definitions are data, not hard-coded across the server;
- read-only policy excludes mutation and internal auth tools from MCP;
- auth state is encrypted and file permissions are restricted;
- token refresh is isolated and explicit;
- cookies use a domain/path-aware jar;
- transport has timeout, bounded body size, request IDs, retry policy and `Retry-After` support;
- endpoint responses include provenance metadata;
- response envelopes are checked for `success: false`;
- MCP registration is generated from the endpoint map;
- browser stealth automation is not a mandatory dependency;
- FOMO requests use a separate ordinary Chrome transport while auth and auxiliary requests remain direct;
- package entrypoint and PM2 daemon are separate from the MCP stdio process.

Live FOMO access is runtime-dependent: an authorized identity token and a successful read-only request are required. Build and offline MCP checks do not prove that the private upstream routes still work; use the auth and proof procedures in [docs/AUTH.md](docs/AUTH.md).

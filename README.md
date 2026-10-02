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

The [disabled and internal records table](docs/API.md#disabled-and-internal-records) explains each exclusion. Watchlist writes are mutations, swap preparation is outside the analytics scope, Privy refresh is internal credential rotation, and Mobula pulse awaits provider-contract verification. Internal Privy refresh continues to work through AuthManager.

The endpoint map is a reverse-engineered reference, not an official FOMO API contract. Its provenance is recorded in `config/endpoints.json`; each route must be verified against an authorized source before production collection.

`config/endpoints.json` is the single endpoint map and [docs/API.md](docs/API.md) is generated from it. The catalog currently has no endpoint confirmed as deprecated: a route absent from the current frontend bundle is recorded as `catalogOnly` evidence, not automatically marked obsolete. Disabled and internal records carry an explicit exclusion reason. `fomo_trading_activity` is active upstream but may return stale events; that is a freshness limitation, not endpoint deprecation.

## Agent documentation

- [AI agent rules](AGENTS.md): sources of truth, read-only boundaries, auth gates, proof, and Git rules.
- [AI agent workflow](docs/AGENT_WORKFLOW.md): shortest normal path, reauthorization sequence, tool selection, and failure handling.
- [API catalog](docs/API.md): every MCP tool, upstream route, parameter shape, disabled record, and local daemon route.
- [Authentication](docs/AUTH.md): token model, Google/Privy flows, reauthorization, storage, and proof commands.

## Configuration

- `config/endpoints.json` is the single endpoint catalog. Add or change a route there instead of scattering paths through code.
- `config/runtime.json` contains fast-changing timeout, retry, auth, MCP and daemon settings.
- Override paths with `FOMO_MCP_RUNTIME_CONFIG`, `FOMO_MCP_ENDPOINTS_CONFIG` and `FOMO_MCP_AUTH_FILE`.

Endpoint parameters are exposed as top-level MCP input fields. The adapter builds path, query and body values from the catalog and handles the known `tokenAddress` to upstream `address` conversion for holders routes.

The refreshed catalog contains 63 upstream records, with 58 read-only data tools exposed and five disabled/internal references. Two local authentication tools are registered separately. Detailed parameter tables, wire serialization, path overrides, auth modes, time units, and MCP argument examples are generated in [docs/API.md](docs/API.md).

Use `fomo_get_users_batch` to retrieve multiple profiles in one request using repeated `userIds` fields. `fomo_get_relay_fee_balance` reads the current account's fee balance without claiming it. FOMO `tokenIds`, `tokenId` and chart `symbol` use `<tokenAddress>:<numeric networkId>` (Solana: `<tokenAddress>:1399811149`); Mobula OHLCV uses a separate `chain` value such as `solana` and requires the identity token.

`fomo_get_trades.userId` requires the UUID from a FOMO user profile or leaderboard `id` field. Wallet addresses and handles are different identifiers and are rejected before an upstream request.

Every data tool returns `{ data, meta }`. `data` contains the upstream payload after only transport-envelope unwrapping; MCP does not normalize or add business metrics. `meta.provenance.data` is `upstream`, while `meta.provenance.metadata` is `mcp_generated`. Scope and freshness fields are MCP metadata and must not be presented as fields returned by FOMO.

Time bounds for `fomo_token_sorted_thesis` use Unix epoch milliseconds; `afterTime` is required by the upstream API. Clan feeds require at least one supported `feedTypes` value and send it as a repeated query field. `fomo_get_clan` can return a windowed clan snapshot with aggregate rank/PnL, trade count, top tokens, and an embedded `members` array containing user profiles, roles and member PnL. The route has no documented member cursor; compare `members.length` with the upstream `memberCount` before treating the snapshot as complete. Any rankings or aggregates calculated from that array are MCP-agent derived data.

The global feed accepts upstream `limit` values from 1 through 100. A pinned `manual` announcement can add one record beyond the requested limit. The feed has no `afterTime` or `beforeTime`; MCP passes the FOMO page through unchanged. Pagination, deduplication, pinned-item handling and time-window counts are user/agent analysis, not upstream fields. `fomo_trading_activity` is still exposed because its upstream route is active, but its events may be stale and it has no time-bound filter; treat its timestamps as provider data.

### Endpoint discovery and maintenance

Install the development dependencies and build before running maintenance:

```bash
npm ci
npm run build
npm run endpoints:discover
npm run endpoints:discover -- --baseline latest
npm run endpoints:check
```

Discovery reads public production HTML and JavaScript assets without starting a browser or requiring authentication. The normal command stores one machine-readable snapshot at ignored `data/endpoint-discovery.json`; it does not create a reports directory. Pass `--output-dir reports` only for an explicit test/export run to write JSON and Markdown reports with new route references, missing catalog references, evidence URLs/hashes, and changes since the optional baseline. Download limits and concurrency are in `config/runtime.json`. Missing references do not prove removal; frontend assets are evidence, not an official API specification.

Manual agent requests are supported in any language. A request to check endpoint changes maps to `npm run endpoints:check`, which compares with the latest saved snapshot, rejects `--apply`, and never edits the catalog. A request to refresh endpoints starts with that check, continues through source review and catalog edits, and uses `npm run endpoints:refresh` to apply reviewed records staged in `discoveryCandidates`. The refresh command itself does not infer or rewrite contracts. Both aliases work when the snapshot or its parent directory is absent. Use `npm run endpoints:refresh -- --report-only` for a non-mutating refresh, pass an explicit `--baseline <snapshot.json>`, or pass `--output-dir reports` only for a disposable test/export report.

An agent can run this command periodically as a separate maintenance task using [the endpoint maintenance procedure](docs/AGENT_WORKFLOW.md#endpoint-maintenance-run). `--baseline latest` compares with the last saved snapshot. Review unknown routes and changed evidence, then update existing contracts in `config/endpoints.json`. Approved new read-only records may be staged in that same file's optional top-level `discoveryCandidates` array, which does not register MCP tools. Promote staged records with current route evidence and regenerate documentation:

```bash
npm run endpoints:refresh
npm run docs:api
npm run build
npm run test:endpoints
```

Default discovery is report-only. `--apply` accepts only reviewed records in the configured catalog, rejects mutations/internal records/conflicts and catalog changes during discovery, writes atomically, and refreshes provenance. It never removes endpoints or infers new schemas from arbitrary route strings. Run one apply process at a time. Restart affected MCP hosts and the daemon after updating schemas; they load the catalog at startup. Confirm new routes with authorized read-only requests and recorded HTTP status/request ids before treating them as live verified.

The configured transport is `hybrid`: Privy and auxiliary sources use direct fetch, while FOMO API calls run from an ordinary headed Chrome page because the FOMO edge rejects non-browser clients. The browser transport does not disable automation flags or spoof browser properties. With `transport.browser.avoidFocus` enabled (the default), Chrome starts without an initial startup window, creates a background tab through CDP, and minimizes its short-lived page before navigation. This prevents the API browser from taking focus; `appMode` is used only by the explicit focus-allowed fallback. The configured work-area edge (`10000,10000` by default under Xwayland) and minimal window size (`1x1` by default) remain available as fallback controls. A pure Wayland compositor may ignore window-position flags, while the background-target path still avoids initial activation. The transport terminates the detached Chrome process group and removes its temporary profile on normal close, startup failure, and process shutdown. The interactive authorization browser is separate and remains visible for login.

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

`auth:refresh` rotates the Privy access/refresh pair and uses a returned identity token when Privy supplies one. If no fresh identity token is returned, an expired identity token still requires interactive re-authentication and a new explicit import. Environment tokens are supported for ephemeral runs but are not persisted by default.

The project does not automate Google credential entry, scrape the user's normal Chrome profile, or extract credentials from DevTools. It uses only the dedicated FOMO MCP profile described below. Cookie values are accepted only through an explicit import or response `Set-Cookie` handling and are filtered by domain/path before sending.

### Interactive local authorization

The PM2 daemon provides a user-driven local flow. When identity authorization
expires, data tools and `fomo_auth_start` start the visible headed browser flow
automatically when the daemon is available. The MCP response also returns this
local fallback link:

```text
http://127.0.0.1:8387/auth/form
```

The page starts a separate visible Chrome window with a dedicated persistent profile. On the first run, the user completes the normal FOMO/Google login there. Later runs reuse that profile's Google session, so the user normally only confirms the login instead of entering credentials again. The flow observes only that browser session, captures the ID/access/refresh values emitted by the FOMO/Privy login and the session cookies, then writes them to the encrypted auth store. It never prints the values. `fomo_auth_status` exposes only boolean availability, cookie count and optional JWT expiry timestamps for the access, refresh and identity tokens.

The dedicated profile defaults to `~/.local/share/fomo-mcp/google-profile`. Override it with `FOMO_MCP_BROWSER_PROFILE_DIR` or `auth.browserProfileDir` in `config/runtime.json`. Do not point it at the user's normal Chrome profile. The profile contains a Google browser session and must be protected as sensitive local data.

Before an authenticated request, the gateway can perform one shared Privy refresh when the stored access or identity token has expired. A read-only request may also perform one refresh-and-retry after an upstream HTTP 401; mutating requests are never retried. When an identity token remains expired, the data tool returns `reauthRequired: true` and starts the visible headed browser authorization flow through the local daemon. The agent tells the user to complete that window, then polls `fomo_auth_status` and retries once. If the daemon cannot start a browser, the response includes the local auth-form link as a fallback. The refresh endpoint can rotate access/refresh tokens, but it normally cannot mint a new identity token.

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

`/healthz` proves the process is alive. `/readyz` returns `503` whenever the identity token is missing or expired (`auth.reauthRequired=true`), and returns `200` when an available identity token has not expired. It does not probe FOMO. `/auth/status` returns metadata only and never token values. The daemon does not run a data collector.

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

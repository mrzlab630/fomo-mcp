# FOMO MCP handoff

Read `AGENTS.md` first, then verify the repository state before editing. Keep
this project read-only: do not add wallet signing, swaps, transfers, watchlist
mutations, scraping, stealth flags, or browser-property spoofing.

## Repository

- Path: `/home/mrz/projects/fomo/fomo_mcp`
- Remote: `https://github.com/mrzlab630/fomo-mcp.git`
- Branch: `main`
- Release version: `0.1.2`
- Runtime endpoint catalog: `config/endpoints.json`
- Runtime and transport settings: `config/runtime.json`
- Catalog: 63 upstream records, 58 exposed read-only data tools, five
  disabled/internal references. Two local auth tools are registered separately.

## Implemented behavior

- Authorization uses a dedicated persistent Chrome profile and a profile lock.
- The profile is retained for later Google reauthorization and is never the
  user's normal Chrome profile.
- `AuthManager` derives JWT expiry metadata and rereads persisted encrypted
  state before authenticated requests.
- One shared Privy refresh is allowed when credentials are expired and
  refreshable; only expiry of the endpoint-required token triggers it.
  Read-only requests may perform one refresh-and-retry after HTTP 401.
- Manual OAuth accepts callbacks from `/favicon.ico` and `/token` after state
  and PKCE validation.
- The endpoint catalog now requires repeated `feedTypes` for clan feeds and
  uses Unix epoch milliseconds for the required `afterTime` on sorted token
  thesis queries.
- The background FOMO browser transport uses ordinary headed Chrome.
  `transport.browser.avoidFocus` defaults to true, so Chrome starts
  without an initial startup window and CDP minimizes the short-lived page
  before navigation. `transport.browser.windowPositionX/Y` defaults to
  `10000,10000`; with a valid Xwayland session it also starts at that
  work-area edge. Wayland fallback relies on no-startup-window plus CDP
  minimize because the compositor owns placement.
- The interactive authorization browser remains visible because the user must
  complete the login there. Data tools start it automatically on
  `reauthRequired`; MCP auth status polls the active flow without repeatedly
  starting failed flows. HTTP `/auth/status` never launches a browser.
- `fomo_get_trades.userId` is the UUID from the FOMO profile `id` or a
  leaderboard response, not a wallet address or handle. Invalid identifiers
  are rejected before the upstream request.
- Upstream business data is preserved after envelope unwrapping. Pagination,
  filtering, pinned-item handling and analysis belong to the user/agent and
  must be labelled as derived. Read `docs/AGENT_WORKFLOW.md` and `docs/API.md`.
- Shared helpers cover Chrome CDP startup, Retry-After parsing and Privy
  headers. The build rejects unused locals and parameters. Dead collector,
  heartbeat and environment-token persistence settings have been removed.

## Required verification

Run these checks against the current checkout before completing a change:

```bash
npm run build
npm run test:endpoints
npm run docs:api
jq -e . config/endpoints.json
jq -e . config/runtime.json
git diff --check
```

For a runtime change, restart only `fomo-mcp-daemon` and check:

- `/healthz`: HTTP 200.
- `/readyz`: HTTP 200 only with an available, non-expired identity token;
  otherwise HTTP 503. This is a local readiness check, not an upstream probe.
- `/config/status`: 63 catalog records and 58 exposed data tools.
- An authorized authenticated read-only request: HTTP status, endpoint ID,
  attempt count and request ID. Do not print the business payload or secrets
  merely to prove access.
- Temporary browser profiles removed after the controlled request.

Repeat the live request before making a new runtime claim; tokens and upstream
authorization state are time-sensitive.

## Continuation rules

Before a new change:

```bash
git status --short --branch
git log -1 --oneline --decorate
npm run build
```

Do not manually inspect, decrypt, print, copy, or commit encrypted auth state,
`data/`, `logs/`, `.env`, token values, cookies, or Chrome profile contents.
Use the normal AuthManager and secret-free status interfaces for live checks.
Record only safe metadata such as HTTP status, endpoint ID, attempt count, and
request ID. A real graphical login is required before claiming that a fresh
authorization flow works.

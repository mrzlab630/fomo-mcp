# FOMO MCP — handoff for the next session

Read `AGENTS.md` first, then verify the repository state before editing. Keep
this project read-only: do not add wallet signing, swaps, transfers, watchlist
mutations, scraping, stealth flags, or browser-property spoofing.

## Repository

- Path: `/home/mrz/projects/fomo/fomo_mcp`
- Remote: `https://github.com/mrzlab630/fomo-mcp.git`
- Branch: `main`
- Base history before the current working set: `4aa8cda`
- Runtime endpoint catalog: `config/endpoints.json`
- Runtime and transport settings: `config/runtime.json`

## Implemented behavior

- Authorization uses a dedicated persistent Chrome profile and a profile lock.
- The profile is retained for later Google reauthorization and is never the
  user's normal Chrome profile.
- `AuthManager` derives JWT expiry metadata and rereads persisted encrypted
  state before authenticated requests.
- One shared Privy refresh is allowed when credentials are expired and
  refreshable. Read-only requests may perform one refresh-and-retry after HTTP
  401; mutation requests are not retried.
- Manual OAuth accepts callbacks from `/favicon.ico` and `/token` after state
  and PKCE validation.
- The background FOMO browser transport uses ordinary headed Chrome in app
  mode. `transport.browser.windowPositionX/Y` defaults to `10000,10000`.
  With a valid Xwayland session it starts at that work-area edge before CDP
  minimizes it; Wayland fallback still minimizes through CDP.
- The interactive authorization browser remains visible because the user must
  complete the login there.

## Validation completed

The following checks passed for this working set:

```bash
npm run build
jq -e . config/endpoints.json
jq -e . config/runtime.json
git diff --check
```

After PM2 restart:

- `/healthz` returned HTTP 200.
- `/readyz` returned HTTP 200.
- `/config/status` reported 43 endpoint records and 39 exposed read-only
  tools.
- A controlled authenticated `fomo_get_leaderboard` request returned HTTP 200,
  endpoint metadata, one attempt, and a request ID.
- Temporary browser profiles were removed after the controlled checks.

Repeat the live request before making a new runtime claim; tokens and upstream
authorization state are time-sensitive.

## Continuation rules

Before a new change:

```bash
git status --short --branch
git log -1 --oneline --decorate
npm run build
```

Do not read, decrypt, print, copy, or commit `data/auth-state.enc.json`,
`data/`, `logs/`, `.env`, token values, cookies, or Chrome profile contents.
Record only safe metadata such as HTTP status, endpoint ID, attempt count, and
request ID. A real graphical login is required before claiming that a fresh
authorization flow works.

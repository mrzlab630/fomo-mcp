# AI agent workflow

Use the shortest valid path for every request.

## Normal data request

1. Select the single `fomo_*` tool that matches the user's intent.
2. Call it with the exact fields shown in its input schema.
3. Read the response envelope:
   - `data` contains the upstream result.
   - `meta.status` is the HTTP status.
   - `meta.endpointId` identifies the catalog record.
   - `meta.requestId` identifies this attempt.
   - `meta.attempts` reports bounded transport retries.
   - `meta.provenance.data` identifies `data` as the upstream payload; `meta.provenance.metadata` identifies `meta` as MCP-generated.
   - `meta.scope` is an MCP catalog interpretation, never a field returned by FOMO.
   - `meta.freshness.basis` distinguishes an upstream date header (`provider-reported`) from the MCP observation time (`client-observed`).

Do not treat MCP-generated scope or freshness metadata as upstream business data.
The adapter may unwrap FOMO's transport envelope, but it does not add business
fields to `data` or normalize upstream metric values.

Do not call `fomo_auth_status` before every request. The transport refreshes an
expired session once when the stored refresh pair can be used.

## Reauthorization path

Follow this path only when a data tool returns `reauthRequired: true`, or when
the user asks to check authentication:

1. Call `fomo_auth_start`.
2. Give the returned `authUrl` to the user. The user must complete the local
   browser flow.
3. Poll `fomo_auth_status` about once per second until `ready` is `true`.
4. Retry the original data tool once with the same arguments.

`fomo_auth_start` returns `nextAction: "open_auth_url_and_poll"` and a polling
contract. `fomo_auth_status` returns `nextAction: "call_data_tool"` when ready
or `"start_authorization"` when another authorization is needed. Never poll
the local daemon directly when the MCP tools are available.

## Tool selection

- Use the exact MCP tool name; do not construct an upstream URL yourself.
- Use the input schema names, even when upstream wire names differ.
- `fomo_get_leaderboard.window` accepts only `24h`, `7d`, `30d`, or `all`.
- `fomo_get_leaderboard` returns users; `fomo_get_clan_leaderboard` returns
  clans.
- `fomo_get_global_feed.limit` accepts `1..100` upstream. A pinned `manual`
  item can make a response contain one more record than requested. The route
  has no `afterTime` or `beforeTime`; paginate with `lastFeedId`, deduplicate
  by event id, and exclude `pinned=true` before counting event types.
- `fomo_trading_activity` remains an active upstream route, but FOMO does not
  provide a time-bound parameter and may return stale or historical events.
  Treat its timestamps as provider data and do not use it as a complete
  current-period market ranking without an independent freshness check.
- Use `fomo_search_users` or `fomo_search_tokens` when the user gives a name
  or phrase and no stable id/address.
- Use a detail tool only after a search result provides the required id or
  address.

## Failure handling

- `reauthRequired: true`: follow the reauthorization path; do not retry in a
  loop.
- A non-auth error: report the error and the safe `meta` fields if present;
  do not invent parameters or switch to an undocumented route.
- Never expose tokens, cookies, OAuth codes, the master key, or a complete auth
  import. All registered data tools are read-only.

## Endpoint maintenance run

Use this sequence for explicit manual requests or a periodic task, separately
from data collection. All project
documentation and catalog descriptions remain in English.

### Manual commands

Interpret equivalent wording in any language. Map user intent to these paths:

- "Check endpoint changes", "check the endpoint map", or "find endpoint drift" -> run
  `npm run endpoints:check`. It compares with the latest version 2 snapshot,
  writes the ignored snapshot, and rejects `--apply`. Inspect the evidence and
  snapshot
  findings without changing catalog records, documentation or running processes.
- "Refresh endpoints", "update endpoints", or "bring the endpoint map up to date" ->
  follow the full review and apply sequence below, beginning with
  `npm run endpoints:check`. Review source contracts, update existing records,
  stage new read-only records, then use `npm run endpoints:refresh` to apply
  reviewed candidates and update provenance. Running refresh alone does not
  research or rewrite existing contracts.
- "Run discovery without changing anything" -> run
  `npm run endpoints:discover -- --report-only`.

Both manual commands perform an initial snapshot when no previous report exists.
Use `--baseline <report.json>` for a specific snapshot and
`npm run endpoints:refresh -- --report-only` to inspect the refresh path without
applying. With no baseline, the output contains `baseline: null` and no historical
diff. Do not report that as proof of no endpoint changes.

### Review and apply sequence

1. Run `npm run build`, then `npm run endpoints:check`. Retain the generated
   snapshot at `data/endpoint-discovery.json`.
2. Read `unmappedRoutes`, `catalogOnly`, and `changes`. Open only the referenced
   public asset URLs needed to inspect each change. A missing string is not
   proof of deprecation; a changed SHA-256 hash signals possible contract drift.
3. Verify method, base, auth, parameters, wire names, cursors and side effects.
   Edit existing schemas in `config/endpoints.json`. Put approved new complete
   read-only records in its optional `discoveryCandidates` array, then run
   `npm run endpoints:refresh`. Never stage wallet/signing/mutation
   or sensitive credential-export routes. Never enable disabled records from
   discovery alone. Use one apply process at a time.
4. Run `npm run docs:api`, `npm run build`, `npm run test:endpoints`, and
   `git diff --check`. Inspect the catalog and generated API reference. The
   normal path keeps only `data/endpoint-discovery.json`; use
   `--output-dir reports` only for a disposable test/export report.
5. Restart affected MCP processes and the daemon to reload the catalog. When
   auth is ready, probe each added/changed read-only route and record status
   and request id. If `reauthRequired` is true, report live verification as
   pending and follow the reauthorization path; do not launch repeated requests.

Return the absolute snapshot path and any explicit test-export paths, comparison
baseline, routes requiring review, and source evidence for findings. For update
requests, also list catalog changes, proof results, and pending live validation.
If no supported contract change is found, state that explicitly instead of
inventing a new schema.

Discovery downloads bounded public assets and parses them without executing
JavaScript, starting a browser, or accessing auth state. It does not infer
parameter contracts or establish live readiness. It requires the development
TypeScript dependency (`npm ci`, without `--omit=dev`).

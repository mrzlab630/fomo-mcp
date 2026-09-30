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

# API and MCP tools

> Generated from `config/endpoints.json` by `npm run docs:api`. Keep the catalog as the source of truth; edit this file only through the generator.

- Catalog version: `3`
- Records: **63**
- Exposed read-only records: **58**
- Disabled/internal references: **5**
- Source status: reverse-engineered reference; refreshed from production frontend; verify before live use
- Production evidence: https://fomo.family/; manifest `86d0b4f8`; collected 2026-09-30T14:33:25.227Z.

## Contract and usage

Every registered data tool accepts top-level fields shown below and returns `{ data, meta }`. `data` is the upstream payload after only envelope unwrapping; MCP does not normalize or invent its business fields. `meta` is MCP-generated and includes the catalog id, source base, HTTP status, request id, retry attempts, fetch time, response type, provenance, scope and freshness metadata. `meta.provenance.data` identifies the payload as upstream, while `meta.provenance.metadata` identifies the envelope as MCP-generated. `meta.scope` comes from the MCP catalog. `meta.freshness` uses provider date headers when available and otherwise reports only the MCP observation time. Parameter names are the MCP names; the adapter applies path encoding, query serialization, body construction, and wire-name conversions.

The catalog contains private, reverse-engineered routes. A route appearing here is not proof that it is stable or authorized for every account. Live readiness requires the non-expired token selected by each endpoint's auth field, followed by a successful read-only request. Enabled FOMO routes and Mobula OHLCV use the identity token; Privy session operations use the access/refresh pair internally.

The catalog is the single endpoint map: every record, including disabled and internal references, is listed in this document. A route is not marked deprecated merely because the current frontend bundle does not reference it; `catalogOnly` discovery results require a reviewed source contract or an authorized probe before deprecation. `fomo_trading_activity` is active upstream but may return stale events, which is a freshness limitation rather than a deprecated route.

Response type names describe observed payload purposes, not validated upstream JSON schemas. Only the envelope is checked by the adapter. Do not assume undocumented response fields. Time units are specified per parameter; chart bars use Unix seconds, while sorted thesis and Mobula OHLCV use Unix milliseconds.

FOMO tokenIds, tokenId and chart symbol values use `<tokenAddress>:<numeric networkId>`, such as `<tokenAddress>:1399811149` for Solana. Obtain both parts from a token response. The Mobula OHLCV chain query is a separate provider identifier (`solana` or `evm:<chain id>`); do not use it as the prefix of a FOMO token id. Batch user lookups use GET `/v2/users` with repeated userIds query fields; POST on that path is account registration and is not exposed.

Use the final item or the cursor provided by the actual response when fetching another page. Stop when the page is empty, the cursor repeats, or the requested time boundary is reached. A current trending list does not represent seven-day activity: combine it with the 7d user leaderboard, paginated swaps, and timestamp-filtered thesis.

For the normal request and reauthorization sequence, read [AI agent workflow](AGENT_WORKFLOW.md). Two additional auth tools are registered outside the endpoint catalog: `fomo_auth_status` accepts `{}` and returns secret-free metadata plus `ready`/`nextAction`; `fomo_auth_start` accepts `{}` and returns the local authorization URL and polling contract. Neither performs a data request or automatically starts a browser.

## Endpoint index

| Catalog id | Method | Route | State |
| --- | --- | --- | --- |
| [fomo_get_user_by_handle](#fomo_get_user_by_handle) | GET | `/v2/users/userHandle/{handle}` | exposed |
| [fomo_get_user](#fomo_get_user) | GET | `/v2/users/{id}` | exposed |
| [fomo_get_following_ids](#fomo_get_following_ids) | GET | `/v2/users/current/followingIds` | exposed |
| [fomo_search_users](#fomo_search_users) | GET | `/v2/users/fuzzy-search` | exposed |
| [fomo_get_user_swaps](#fomo_get_user_swaps) | GET | `/v2/users/{id}/swaps` | exposed |
| [fomo_get_user_rank](#fomo_get_user_rank) | GET | `/v2/users/{id}/leaderboard` | exposed |
| [fomo_get_spotlight](#fomo_get_spotlight) | GET | `/v2/users/{id}/spotlight` | exposed |
| [fomo_get_recommended_users](#fomo_get_recommended_users) | GET | `/v2/users/{id}/recommendedUsers` | exposed |
| [fomo_get_balances](#fomo_get_balances) | GET | `/v2/users/{id}/balances` | exposed |
| [fomo_get_pnl_equity_series](#fomo_get_pnl_equity_series) | GET | `/v2/userTokens/aggregatedSnapshot` | exposed |
| [fomo_get_snapshot_by_id](#fomo_get_snapshot_by_id) | GET | `/v2/userTokens/aggregatedSnapshotById` | exposed |
| [fomo_get_leaderboard](#fomo_get_leaderboard) | GET | `/v2/leaderboard/{window}` | exposed |
| [fomo_get_clan_leaderboard](#fomo_get_clan_leaderboard) | GET | `/v2/clans/leaderboard` | exposed |
| [fomo_search_clans](#fomo_search_clans) | GET | `/v2/clans/search` | exposed |
| [fomo_get_clan](#fomo_get_clan) | GET | `/v2/clans/{id}` | exposed |
| [fomo_get_clan_holdings](#fomo_get_clan_holdings) | GET | `/v2/clans/{id}/holdings` | exposed |
| [fomo_get_clan_holding_breakdown](#fomo_get_clan_holding_breakdown) | GET | `/v2/clans/{id}/holdings/breakdown` | exposed |
| [fomo_get_clan_feed](#fomo_get_clan_feed) | GET | `/v2/clans/{id}/feed` | exposed |
| [fomo_get_trades](#fomo_get_trades) | GET | `/trades` | exposed |
| [fomo_get_trade](#fomo_get_trade) | GET | `/trades/{id}` | exposed |
| [fomo_get_trade_comments](#fomo_get_trade_comments) | GET | `/trades/{tradeId}/comments` | exposed |
| [fomo_request_swap_quote](#fomo_request_swap_quote) | POST | `/swaps/v2` | disabled/internal |
| [fomo_filter_tokens](#fomo_filter_tokens) | POST | `/proxy/filterTokens` | exposed |
| [fomo_search_tokens](#fomo_search_tokens) | POST | `/proxy/filterTokensSearch` | exposed |
| [fomo_token_details](#fomo_token_details) | POST | `/proxy/tokenDetails` | exposed |
| [fomo_token_warnings](#fomo_token_warnings) | POST | `/proxy/tokenWarnings` | exposed |
| [fomo_verified_tokens](#fomo_verified_tokens) | GET | `/proxy/verifiedTokens` | exposed |
| [fomo_top_holders](#fomo_top_holders) | GET | `/hodlers/top` | exposed |
| [fomo_dev_holdings](#fomo_dev_holdings) | GET | `/hodlers/devs` | exposed |
| [fomo_friends_holdings](#fomo_friends_holdings) | POST | `/hodlers/friends` | exposed |
| [fomo_token_allow_list](#fomo_token_allow_list) | GET | `/tokenAllowList/detailed` | exposed |
| [fomo_ohlcv](#fomo_ohlcv) | GET | `/api/2/token/ohlcv-history` | exposed |
| [fomo_token_feed](#fomo_token_feed) | GET | `/feed/token` | exposed |
| [fomo_token_thesis](#fomo_token_thesis) | GET | `/feed/token/thesis` | exposed |
| [fomo_token_sorted_thesis](#fomo_token_sorted_thesis) | GET | `/feed/token/sortedThesis` | exposed |
| [fomo_trading_activity](#fomo_trading_activity) | GET | `/feed/tradingActivity` | exposed |
| [fomo_get_watchlist](#fomo_get_watchlist) | GET | `/watchlist` | exposed |
| [fomo_add_watchlist](#fomo_add_watchlist) | POST | `/watchlist` | disabled/internal |
| [fomo_remove_watchlist](#fomo_remove_watchlist) | DELETE | `/watchlist` | disabled/internal |
| [fomo_transfers_with](#fomo_transfers_with) | GET | `/v2/transfers/with/{userId}` | exposed |
| [fomo_supported_transfer_tokens](#fomo_supported_transfer_tokens) | GET | `/transfers/v2/supportedTokens` | exposed |
| [fomo_get_config](#fomo_get_config) | GET | `/config` | exposed |
| [privy_refresh_session](#privy_refresh_session) | POST | `/api/v1/sessions` | disabled/internal |
| [fomo_get_global_feed](#fomo_get_global_feed) | GET | `/feed` | exposed |
| [fomo_trending_tokens](#fomo_trending_tokens) | POST | `/proxy/trendingTokens` | exposed |
| [fomo_most_held_tokens](#fomo_most_held_tokens) | POST | `/proxy/mostHeld` | exposed |
| [fomo_graduated_tokens](#fomo_graduated_tokens) | POST | `/proxy/graduatedTokens` | exposed |
| [fomo_crypto_tokens](#fomo_crypto_tokens) | POST | `/proxy/cryptoTokens` | exposed |
| [fomo_get_bars](#fomo_get_bars) | POST | `/proxy/getBars` | exposed |
| [fomo_get_bars_new](#fomo_get_bars_new) | POST | `/proxy/getBarsNew` | exposed |
| [fomo_get_following_leaderboard](#fomo_get_following_leaderboard) | GET | `/v2/leaderboard/following` | exposed |
| [fomo_get_clan_thesis](#fomo_get_clan_thesis) | GET | `/v2/clans/{id}/thesis` | exposed |
| [fomo_get_pnl_equity_intervals](#fomo_get_pnl_equity_intervals) | GET | `/v2/userTokens/aggregatedSnapshot/interval` | exposed |
| [fomo_get_current_user](#fomo_get_current_user) | GET | `/v2/users/current` | exposed |
| [fomo_get_followers](#fomo_get_followers) | GET | `/v2/users/{id}/followers` | exposed |
| [fomo_get_following_paginated](#fomo_get_following_paginated) | GET | `/v2/users/{id}/followingPaginate` | exposed |
| [fomo_get_mutuals](#fomo_get_mutuals) | GET | `/v2/users/{id}/mutuals` | exposed |
| [fomo_get_user_top_theses](#fomo_get_user_top_theses) | GET | `/v2/users/{id}/topTheses` | exposed |
| [fomo_get_user_transfers](#fomo_get_user_transfers) | GET | `/v2/users/{id}/transfers` | exposed |
| [fomo_get_push_preferences](#fomo_get_push_preferences) | GET | `/v2/users/pushToken/preferences` | exposed |
| [fomo_mobula_pulse](#fomo_mobula_pulse) | POST | `/api/2/pulse` | disabled/internal |
| [fomo_get_users_batch](#fomo_get_users_batch) | GET | `/v2/users` | exposed |
| [fomo_get_relay_fee_balance](#fomo_get_relay_fee_balance) | GET | `/proxy/relay/appFees` | exposed |

## Disabled and internal records

These records are retained for reference and are not registered as MCP data tools. Their exclusions are independent of authentication expiry and are not evidence that the upstream routes have been removed. Privy refresh remains available internally to AuthManager.

| Catalog id | Reason for exclusion |
| --- | --- |
| [fomo_request_swap_quote](#fomo_request_swap_quote) | Disabled by the analytics-only MCP scope: swap preparation is excluded even though this quote reference is marked sideEffect: none. No signing or swap execution is exposed; this is a policy exclusion, not evidence of route removal. |
| [fomo_add_watchlist](#fomo_add_watchlist) | Disabled because POST /watchlist changes the authenticated user's watchlist. The MCP surface permits retrieval only; GET /watchlist remains available. |
| [fomo_remove_watchlist](#fomo_remove_watchlist) | Disabled because DELETE /watchlist changes the authenticated user's watchlist. The MCP surface permits retrieval only; GET /watchlist remains available. |
| [privy_refresh_session](#privy_refresh_session) | Internal credential-rotation endpoint used by AuthManager, not a data tool. It accepts a refresh token and returns session credentials, which must never be exposed to an MCP consumer. Catalog exclusion does not disable internal session refresh. |
| [fomo_mobula_pulse](#fomo_mobula_pulse) | Disabled pending verification of the provider views/model names, chainId values, access-token requirements and response contract. Frontend route evidence alone does not prove a usable read-only contract; keep disabled until an authorized provider probe verifies it. |

## Endpoint reference

## users

### fomo_get_user_by_handle

- MCP tool: `fomo_get_user_by_handle`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/userHandle/{handle}` (base: `fomo`; auth: `identity`)
- Description: Read a FOMO user by handle.
- Response: `User`: User profile for the requested handle.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `handle` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "handle": "<handle>"
}
```

### fomo_get_user

- MCP tool: `fomo_get_user`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}` (base: `fomo`; auth: `identity`)
- Description: Read a FOMO user by id.
- Response: `User`: User profile for the requested id.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_following_ids

- MCP tool: `fomo_get_following_ids`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/current/followingIds` (base: `fomo`; auth: `identity`)
- Description: Read ids followed by the current account.
- Response: `FollowingIds`: Ids followed by the authenticated account.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_search_users

- MCP tool: `fomo_search_users`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/fuzzy-search` (base: `fomo`; auth: `identity`)
- Description: Fuzzy-search users by term.
- Response: `UserSearch`: Matching user profiles.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `searchTerm` | query | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "searchTerm": "<searchTerm>"
}
```

### fomo_get_user_swaps

- MCP tool: `fomo_get_user_swaps`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/swaps` (base: `fomo`; auth: `identity`)
- Description: Read swap history for a user.
- Response: `UserSwaps`: Swap history returned by the upstream service; no swap is executed.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `tokenAddress` | query | `string` | no | same | none |
| `lastSwapIdV2` | query | `string` | no | same | none; Cursor returned by the previous swaps page. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_user_rank

- MCP tool: `fomo_get_user_rank`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/leaderboard` (base: `fomo`; auth: `identity`)
- Description: Read leaderboard rank data for a user.
- Response: `UserRank`: Rank cuts returned by FOMO.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_spotlight

- MCP tool: `fomo_get_spotlight`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/spotlight` (base: `fomo`; auth: `identity`)
- Description: Read a user's spotlight data.
- Response: `UserSpotlight`: Best trades and comments returned by FOMO.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_recommended_users

- MCP tool: `fomo_get_recommended_users`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/recommendedUsers` (base: `fomo`; auth: `identity`)
- Description: Read recommended users.
- Response: `RecommendedUsers`: Recommended users returned by FOMO.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_current_user

- MCP tool: `fomo_get_current_user`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/current` (base: `fomo`; auth: `identity`)
- Description: Read the authenticated user's profile.
- Response: `User`: Authenticated current user profile.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_get_followers

- MCP tool: `fomo_get_followers`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/followers` (base: `fomo`; auth: `identity`)
- Description: Read a user's followers.
- Response: `UserList`: Users following the requested user.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_following_paginated

- MCP tool: `fomo_get_following_paginated`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/followingPaginate` (base: `fomo`; auth: `identity`)
- Description: Read a user's following graph with a cursor.
- Response: `UserList`: Cursor-paginated users followed by a user.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `lastId` | query | `string` | no | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_mutuals

- MCP tool: `fomo_get_mutuals`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/mutuals` (base: `fomo`; auth: `identity`)
- Description: Read mutual connections with a cursor.
- Response: `UserList`: Mutual connections for a user.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `lastId` | query | `string` | no | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_user_top_theses

- MCP tool: `fomo_get_user_top_theses`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/topTheses` (base: `fomo`; auth: `identity`)
- Description: Read a user's top thesis.
- Response: `UserThesis`: Top thesis for a user.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_user_transfers

- MCP tool: `fomo_get_user_transfers`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/transfers` (base: `fomo`; auth: `identity`)
- Description: Read a user's transfer history.
- Response: `Transfers`: Cursor-paginated user transfer history.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `lastTransferId` | query | `string` | no | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_users_batch

- MCP tool: `fomo_get_users_batch`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users` (base: `fomo`; auth: `identity`)
- Description: Read several user profiles in one request using repeated userIds query fields. Does not register or edit users.
- Response: `UsersBatch`: An object containing a users array for the requested ids.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `userIds` | query | `array<string>` | yes | same | none; User ids from a search, leaderboard or profile response; send at least one id as repeated userIds query fields. Only GET is supported; POST on this path registers an account and is excluded. Serialization: repeat. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "userIds": [
    "<userIds>"
  ]
}
```

## portfolio

### fomo_get_balances

- MCP tool: `fomo_get_balances`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/{id}/balances` (base: `fomo`; auth: `identity`)
- Description: Read token balances.
- Response: `Balances`: Token balances for a user.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_pnl_equity_series

- MCP tool: `fomo_get_pnl_equity_series`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/userTokens/aggregatedSnapshot` (base: `fomo`; auth: `identity`)
- Description: Read a user's PnL and equity series.
- Response: `PnlEquitySeries`: Historical PnL/equity series from the requested timestamp.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `userId` | query | `string` | yes | same | none |
| `timestamp` | query | `string` | yes | same | none |
| `interval` | query | `number` | no | same | none; Production UI uses 4 for 30-day aggregation. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "userId": "<userId>",
  "timestamp": "<timestamp>"
}
```

### fomo_get_snapshot_by_id

- MCP tool: `fomo_get_snapshot_by_id`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/userTokens/aggregatedSnapshotById` (base: `fomo`; auth: `identity`)
- Description: Read one PnL/equity snapshot.
- Response: `PnlSnapshot`: One historical PnL/equity snapshot.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `userId` | query | `string` | yes | same | none |
| `snapshotId` | query | `number` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "userId": "<userId>",
  "snapshotId": 1
}
```

### fomo_get_pnl_equity_intervals

- MCP tool: `fomo_get_pnl_equity_intervals`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/userTokens/aggregatedSnapshot/interval` (base: `fomo`; auth: `identity`)
- Description: Read all-time interval PnL and equity snapshots.
- Response: `PnlEquityIntervals`: Interval portfolio PnL and equity series.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `userId` | query | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "userId": "<userId>"
}
```

## leaderboards

### fomo_get_leaderboard

- MCP tool: `fomo_get_leaderboard`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/leaderboard/{window}` (base: `fomo`; auth: `identity`)
- Path overrides: `all` uses `/v2/leaderboard`.
- Description: Read the user leaderboard.
- Response: `Leaderboard`: User leaderboard for the selected window.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `window` | path | `string` | no | same | `"24h"`; 24h, 7d, 30d, or all. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "window": "24h"
}
```

### fomo_get_clan_leaderboard

- MCP tool: `fomo_get_clan_leaderboard`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/leaderboard` (base: `fomo`; auth: `identity`)
- Description: Read the clan leaderboard.
- Response: `ClanLeaderboard`: Clan leaderboard for the selected window.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `window` | query | `string` | no | same | `"24h"`; 24h, 7d, 30d, or all. |
| `limit` | query | `number >= 1 <= 50` | no | same | `50` |
| `cursor` | query | `string` | no | same | none; Cursor for the next page. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "window": "24h",
  "limit": 50
}
```

### fomo_get_following_leaderboard

- MCP tool: `fomo_get_following_leaderboard`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/leaderboard/following` (base: `fomo`; auth: `identity`)
- Description: Read the following leaderboard.
- Response: `Leaderboard`: Leaderboard for the authenticated user's following graph.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

## clans

### fomo_search_clans

- MCP tool: `fomo_search_clans`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/search` (base: `fomo`; auth: `identity`)
- Description: Search clans by term.
- Response: `ClanSearch`: Matching clans.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `searchTerm` | query | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "searchTerm": "<searchTerm>"
}
```

### fomo_get_clan

- MCP tool: `fomo_get_clan`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/{id}` (base: `fomo`; auth: `identity`)
- Description: Read clan details and the member/PnL snapshot returned by FOMO.
- Response: `Clan`: Clan snapshot for the selected window. Observed payloads include aggregate rank, PnL, tradeCount, memberCount and topTokens, plus members containing an embedded User profile, role and member PnL. This route has no documented member pagination parameter; treat members as an upstream snapshot and compare its length with memberCount.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `window` | query | `string` | no | same | none; Optional upstream reporting window, for example 7d; accepted values are provider-defined for this route. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_clan_holdings

- MCP tool: `fomo_get_clan_holdings`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/{id}/holdings` (base: `fomo`; auth: `identity`)
- Description: Read clan holdings.
- Response: `ClanHoldings`: Token holdings for a clan.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `limit` | query | `number >= 1 <= 20` | no | same | `20` |
| `cursor` | query | `string` | no | same | none; Cursor in tokenAddress:networkId form. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>",
  "limit": 20
}
```

### fomo_get_clan_holding_breakdown

- MCP tool: `fomo_get_clan_holding_breakdown`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/{id}/holdings/breakdown` (base: `fomo`; auth: `identity`)
- Description: Read the breakdown of a clan holding.
- Response: `ClanHoldingBreakdown`: Per-member holdings breakdown.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `tokenAddress` | query | `string` | yes | same | none |
| `networkId` | query | `number` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>",
  "tokenAddress": "<tokenAddress>",
  "networkId": 1399811149
}
```

### fomo_get_clan_feed

- MCP tool: `fomo_get_clan_feed`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/{id}/feed` (base: `fomo`; auth: `identity`)
- Description: Read clan activity.
- Response: `ClanFeed`: Clan activity feed.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `limit` | query | `number` | no | same | `50` |
| `feedTypes` | query | `array<string>` | yes | same | none; One or more clan activity types. Supported values: single_user_sell, single_user_transfer_out, user_trade_profit_milestone, large_buy, large_sell, large_transfer_in, large_transfer_out, manual, multi_user_buy, multi_user_sell, new_token_listing, price_since_listing, user_with_smart_following, thesis_created. Serialization: repeat. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>",
  "limit": 50,
  "feedTypes": [
    "<feedTypes>"
  ]
}
```

### fomo_get_clan_thesis

- MCP tool: `fomo_get_clan_thesis`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/clans/{id}/thesis` (base: `fomo`; auth: `identity`)
- Description: Read clan thesis posts.
- Response: `ClanThesis`: Paginated clan thesis records.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |
| `limit` | query | `number >= 1 <= 20` | no | same | `20` |
| `lastId` | query | `string` | no | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>",
  "limit": 20
}
```

## trades

### fomo_get_trades

- MCP tool: `fomo_get_trades`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/trades` (base: `fomo`; auth: `identity`)
- Description: Read trades with optional filters.
- Response: `Trades`: Trade records matching filters.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `userId` | query | `string` | yes | same | none; The user whose trades are requested. |
| `orderBy` | query | `string` | no | same | `"closedAt"`; Sort field; the production UI uses closedAt. |
| `tokenAddress` | query | `string` | no | same | none |
| `lastTradeId` | query | `string` | no | same | none; Cursor returned by the previous trades page. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "userId": "<userId>",
  "orderBy": "closedAt"
}
```

### fomo_get_trade

- MCP tool: `fomo_get_trade`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/trades/{id}` (base: `fomo`; auth: `identity`)
- Description: Read one trade.
- Response: `Trade`: One trade with token metadata.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `id` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "id": "<id>"
}
```

### fomo_get_trade_comments

- MCP tool: `fomo_get_trade_comments`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/trades/{tradeId}/comments` (base: `fomo`; auth: `identity`)
- Description: Read comments for a trade.
- Response: `TradeComments`: Comments for a trade with optional cursor.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tradeId` | path | `string` | yes | same | none |
| `lastCommentId` | query | `string` | no | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tradeId": "<tradeId>"
}
```

## swaps

### fomo_request_swap_quote

- MCP tool: not registered (reference name: `fomo_request_swap_quote`)
- State: **catalog reference / disabled**
- Upstream: `POST https://prod-api.fomo.family/swaps/v2` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Disabled by the analytics-only MCP scope: swap preparation is excluded even though this quote reference is marked sideEffect: none. No signing or swap execution is exposed; this is a policy exclusion, not evidence of route removal.
- Response: `SwapQuote`: Quote only; execution is intentionally excluded.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `inTokenId` | body | `string` | yes | same | none |
| `outTokenId` | body | `string` | yes | same | none |
| `amount` | body | `string` | yes | same | none |
| `retry` | body | `number` | no | same | `0` |

## tokens

### fomo_filter_tokens

- MCP tool: `fomo_filter_tokens`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/filterTokens` (base: `fomo`; auth: `identity`); body mode: `tokenIds`
- Description: Read market data for a list of token ids.
- Response: `TokenMarketData[]`: Market data for requested token ids.
- MCP-generated interpretation (not an upstream field): scope = `requested-token-set`.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenIds` | body | `array<string>` | yes | same | none; Token ids in <tokenAddress>:<numeric networkId> form, using the address and networkId from a token response. This is not a solana:<address> identifier. Sent as the complete request body. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenIds": [
    "<tokenAddress>:1399811149"
  ]
}
```

### fomo_search_tokens

- MCP tool: `fomo_search_tokens`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/filterTokensSearch` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Search tokens by phrase or address; provide at least one non-empty phrase or token.
- Response: `TokenSearch`: Matching tokens.
- Validation: provide at least one non-empty value from `phrase`, `token`.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `phrase` | body | `string` | no | same | none; Token name or symbol search phrase; provide a non-empty phrase or token. |
| `token` | body | `string` | no | same | none; Token address search accepted by the current frontend. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "phrase": "<phrase>"
}
```

### fomo_token_details

- MCP tool: `fomo_token_details`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/tokenDetails` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Read detailed token information.
- Response: `TokenDetails`: Token volumes, counts and holder metadata.
- MCP-generated interpretation (not an upstream field): scope = `single-token`.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenId` | body | `string` | yes | same | none; Token address followed by its numeric network id: <tokenAddress>:<networkId>. For Solana use <tokenAddress>:1399811149. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenId": "<tokenAddress>:1399811149"
}
```

### fomo_token_warnings

- MCP tool: `fomo_token_warnings`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/tokenWarnings` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Read token warning flags.
- Response: `TokenWarnings`: Token allowlist and buy/sell warning flags.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenAddress` | body | `string` | yes | `address` | none |
| `networkId` | body | `number` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenAddress": "<tokenAddress>",
  "networkId": 1399811149
}
```

### fomo_verified_tokens

- MCP tool: `fomo_verified_tokens`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/proxy/verifiedTokens` (base: `fomo`; auth: `identity`)
- Description: Read verified tokens.
- Response: `VerifiedTokens`: Verified token list.
- MCP-generated interpretation (not an upstream field): scope = `provider-wide-verified-list`.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_top_holders

- MCP tool: `fomo_top_holders`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/hodlers/top` (base: `fomo`; auth: `identity`)
- Description: Read top holders. The wire adapter normalizes tokenAddress to upstream address.
- Response: `TopHolders`: Top holder data for requested tokens.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokens` | query | `array<object { tokenAddress: string, networkId: number }>` | yes | same | none; Serialization: json. Nested wire renames: {"tokenAddress":"address"}. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokens": [
    {
      "tokenAddress": "<tokenAddress>",
      "networkId": 1399811149
    }
  ]
}
```

### fomo_dev_holdings

- MCP tool: `fomo_dev_holdings`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/hodlers/devs` (base: `fomo`; auth: `identity`)
- Description: Read developer holdings.
- Response: `DeveloperHoldings`: Developer holdings for a token.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenAddress` | query | `string` | yes | same | none |
| `networkId` | query | `number` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenAddress": "<tokenAddress>",
  "networkId": 1399811149
}
```

### fomo_friends_holdings

- MCP tool: `fomo_friends_holdings`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/hodlers/friends` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Read friends' holdings. The wire adapter normalizes tokenAddress to upstream address.
- Response: `FriendsHoldings`: Which friends hold requested tokens.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokens` | body | `array<object { tokenAddress: string, networkId: number }>` | yes | same | none; Nested wire renames: {"tokenAddress":"address"}. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokens": [
    {
      "tokenAddress": "<tokenAddress>",
      "networkId": 1399811149
    }
  ]
}
```

### fomo_token_allow_list

- MCP tool: `fomo_token_allow_list`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/tokenAllowList/detailed` (base: `fomo`; auth: `identity`)
- Description: Read the detailed token allowlist.
- Response: `TokenAllowList`: Detailed token allowlist.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_ohlcv

- MCP tool: `fomo_ohlcv`
- State: **exposed read-only**
- Upstream: `GET https://mobula-api.fomo.family/api/2/token/ohlcv-history` (base: `mobula`; auth: `identity`)
- Description: Read OHLCV history from the FOMO Mobula base.
- Response: `Ohlcv`: OHLCV candle history.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `address` | query | `string` | yes | same | none |
| `chain` | query | `string` | yes | `chainId` | none; Use solana or evm:<chain id>; the provider wire name is chainId. |
| `period` | query | `string` | no | same | `"1m"` |
| `usd` | query | `string` | no | same | `"true"` |
| `from` | query | `number` | no | same | none; Optional start time in Unix milliseconds. |
| `to` | query | `number` | no | same | none; Optional end time in Unix milliseconds. |
| `amount` | query | `number` | no | same | none; Optional number of candles. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "address": "<address>",
  "chain": "solana",
  "period": "1m",
  "usd": "true"
}
```

### fomo_trending_tokens

- MCP tool: `fomo_trending_tokens`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/trendingTokens` (base: `fomo`; auth: `identity`)
- Description: Read the current trending token list.
- Response: `TokenList`: Current trending token list.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_most_held_tokens

- MCP tool: `fomo_most_held_tokens`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/mostHeld` (base: `fomo`; auth: `identity`)
- Description: Read the current most-held token list.
- Response: `TokenList`: Current most-held token list.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_graduated_tokens

- MCP tool: `fomo_graduated_tokens`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/graduatedTokens` (base: `fomo`; auth: `identity`)
- Description: Read graduated tokens.
- Response: `TokenList`: Graduated token list.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_crypto_tokens

- MCP tool: `fomo_crypto_tokens`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/cryptoTokens` (base: `fomo`; auth: `identity`)
- Description: Read the current crypto token list.
- Response: `TokenList`: Crypto token list.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_get_bars

- MCP tool: `fomo_get_bars`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/getBars` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Read chart bars using the production fallback route.
- Response: `Bars`: TradingView-compatible price bars.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `from` | body | `number` | yes | same | none; Start time in Unix seconds. |
| `to` | body | `number` | yes | same | none; End time in Unix seconds. |
| `resolution` | body | `string` | yes | same | none; TradingView resolution. |
| `symbol` | body | `string` | yes | same | none; Token address followed by its numeric network id: <tokenAddress>:<networkId>. For Solana use <tokenAddress>:1399811149. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "from": 1790121600,
  "to": 1790726400,
  "resolution": "60",
  "symbol": "<tokenAddress>:1399811149"
}
```

### fomo_get_bars_new

- MCP tool: `fomo_get_bars_new`
- State: **exposed read-only**
- Upstream: `POST https://prod-api.fomo.family/proxy/getBarsNew` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Read chart bars using the current production route.
- Response: `Bars`: TradingView-compatible price bars.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `to` | body | `number` | yes | same | none; End time in Unix seconds. |
| `countBack` | body | `number` | yes | same | none; Number of bars requested. |
| `resolution` | body | `string` | yes | same | none; TradingView resolution. |
| `symbol` | body | `string` | yes | same | none; Token address followed by its numeric network id: <tokenAddress>:<networkId>. For Solana use <tokenAddress>:1399811149. |
| `from` | body | `number` | yes | same | none; Start time in Unix seconds. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "to": 1790726400,
  "countBack": 1,
  "resolution": "60",
  "symbol": "<tokenAddress>:1399811149",
  "from": 1790121600
}
```

### fomo_mobula_pulse

- MCP tool: not registered
- State: **catalog reference / disabled**
- Upstream: `POST https://mobula-api.fomo.family/api/2/pulse` (base: `mobula`; auth: `access`); body mode: `object`
- Description: Disabled pending verification of the provider views/model names, chainId values, access-token requirements and response contract. Frontend route evidence alone does not prove a usable read-only contract; keep disabled until an authorized provider probe verifies it.
- Response: `MobulaPulse`: Mobula token market views.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `assetMode` | body | `boolean` | yes | same | none |
| `views` | body | `array<object { name: string, model: string, chainId: array<number> }>` | yes | same | none |

## feed

### fomo_token_feed

- MCP tool: `fomo_token_feed`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/feed/token` (base: `fomo`; auth: `identity`)
- Description: Read a token feed.
- Response: `TokenFeed`: Swap feed for a token.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenAddress` | query | `string` | yes | same | none |
| `networkId` | query | `number` | yes | same | none |
| `limit` | query | `number >= 1 <= 50` | no | same | `50` |
| `threshold` | query | `number` | no | same | `1000` |
| `excludeThesis` | query | `boolean` | no | same | `true` |
| `lastId` | query | `string` | no | same | none; Cursor returned by the previous page. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenAddress": "<tokenAddress>",
  "networkId": 1399811149,
  "limit": 50,
  "threshold": 1000,
  "excludeThesis": true
}
```

### fomo_token_thesis

- MCP tool: `fomo_token_thesis`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/feed/token/thesis` (base: `fomo`; auth: `identity`)
- Description: Read thesis posts for a token.
- Response: `TokenThesis`: Thesis posts for a token.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenAddress` | query | `string` | yes | same | none |
| `networkId` | query | `number` | yes | same | none |
| `limit` | query | `number >= 1 <= 50` | no | same | `50` |
| `threshold` | query | `number` | no | same | `1000` |
| `lastId` | query | `string` | no | same | none; Cursor returned by the previous page. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenAddress": "<tokenAddress>",
  "networkId": 1399811149,
  "limit": 50,
  "threshold": 1000
}
```

### fomo_token_sorted_thesis

- MCP tool: `fomo_token_sorted_thesis`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/feed/token/sortedThesis` (base: `fomo`; auth: `identity`)
- Description: Read time-paged thesis posts.
- Response: `SortedTokenThesis`: Time-paged thesis posts.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `tokenAddress` | query | `string` | yes | same | none |
| `networkId` | query | `number` | yes | same | none |
| `limit` | query | `number >= 1 <= 500` | no | same | `50` |
| `threshold` | query | `number` | no | same | `1000` |
| `afterTime` | query | `number` | yes | same | none; Inclusive lower bound as Unix epoch milliseconds. |
| `beforeTime` | query | `number` | no | same | none; Exclusive upper bound as Unix epoch milliseconds. |
| `userId` | query | `string` | no | same | none; Optional user filter. |
| `followingOnly` | query | `boolean` | no | same | `false` |
| `orderBy` | query | `string` | no | same | none; Production UI value: positionSize. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "tokenAddress": "<tokenAddress>",
  "networkId": 1399811149,
  "limit": 50,
  "threshold": 1000,
  "afterTime": 1790121600000,
  "followingOnly": false
}
```

### fomo_trading_activity

- MCP tool: `fomo_trading_activity`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/feed/tradingActivity` (base: `fomo`; auth: `identity`)
- Description: Read global trading activity. The upstream route remains active, but its event freshness is not guaranteed; do not treat this response as a complete current-period market ranking.
- Response: `TradingActivity`: Global trading activity feed. Upstream does not expose a time-bound parameter and may return stale or historical events; timestamps and freshness remain provider data.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `limit` | query | `number >= 1 <= 100` | no | same | `50`; Upstream maximum is 100. |
| `threshold` | query | `number` | no | same | `1000` |
| `lastId` | query | `string` | no | same | none; Cursor returned by the previous page. |
| `minEquity` | query | `number >= 0` | no | same | none |
| `minMarketCap` | query | `number` | no | same | none |
| `maxMarketCap` | query | `number` | no | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "limit": 50,
  "threshold": 1000
}
```

### fomo_get_global_feed

- MCP tool: `fomo_get_global_feed`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/feed` (base: `fomo`; auth: `identity`)
- Description: Read the global social activity feed. Upstream accepts limit values through 100; pinned manual items may make a page exceed the requested count. Use lastFeedId and deduplicate by id for time windows.
- Response: `GlobalFeed`: Global social activity feed. Upstream has no afterTime or beforeTime filter; use lastFeedId for pagination and exclude pinned items before counting requested event types.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `limit` | query | `number >= 1 <= 100` | no | same | `50`; Upstream maximum is 100. A pinned manual item may make the response contain one more record than requested. |
| `lastFeedId` | query | `string` | no | same | none; Cursor returned by the previous page. |
| `feedTypes` | query | `array<string>` | yes | same | none; One or more feed type values. Serialization: repeat. |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "limit": 50,
  "feedTypes": [
    "<feedTypes>"
  ]
}
```

## account-read

### fomo_get_watchlist

- MCP tool: `fomo_get_watchlist`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/watchlist` (base: `fomo`; auth: `identity`)
- Description: Read the current watchlist.
- Response: `Watchlist`: Current watchlist; read-only.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_transfers_with

- MCP tool: `fomo_transfers_with`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/transfers/with/{userId}` (base: `fomo`; auth: `identity`)
- Description: Read transfers with another user.
- Response: `Transfers`: Transfer history with another user.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `userId` | path | `string` | yes | same | none |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{
  "userId": "<userId>"
}
```

### fomo_supported_transfer_tokens

- MCP tool: `fomo_supported_transfer_tokens`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/transfers/v2/supportedTokens` (base: `fomo`; auth: `identity`)
- Description: Read supported transfer tokens; no transfer is performed.
- Response: `SupportedTransferTokens`: Tokens supported by the transfer surface.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_get_push_preferences

- MCP tool: `fomo_get_push_preferences`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/v2/users/pushToken/preferences` (base: `fomo`; auth: `identity`)
- Description: Read push notification preferences.
- Response: `PushPreferences`: Current push notification preferences.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

### fomo_get_relay_fee_balance

- MCP tool: `fomo_get_relay_fee_balance`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/proxy/relay/appFees` (base: `fomo`; auth: `identity`)
- Description: Read the authenticated account's relay fee balance. Does not claim fees, request a signature or execute permits.
- Response: `RelayFeeBalance`: An object containing the authenticated account's relay fee balance; units are determined by the upstream response.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

## account-mutation

### fomo_add_watchlist

- MCP tool: not registered (reference name: `fomo_add_watchlist`)
- State: **catalog reference / disabled**
- Upstream: `POST https://prod-api.fomo.family/watchlist` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Disabled because POST /watchlist changes the authenticated user's watchlist. The MCP surface permits retrieval only; GET /watchlist remains available.
- Response: `WatchlistMutation`: Account mutation; disabled by policy.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `networkId` | body | `number` | yes | same | none |
| `tokenAddress` | body | `string` | yes | same | none |

### fomo_remove_watchlist

- MCP tool: not registered (reference name: `fomo_remove_watchlist`)
- State: **catalog reference / disabled**
- Upstream: `DELETE https://prod-api.fomo.family/watchlist` (base: `fomo`; auth: `identity`); body mode: `object`
- Description: Disabled because DELETE /watchlist changes the authenticated user's watchlist. The MCP surface permits retrieval only; GET /watchlist remains available.
- Response: `WatchlistMutation`: Account mutation; disabled by policy.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `networkId` | body | `number` | yes | same | none |
| `tokenAddress` | body | `string` | yes | same | none |

## meta

### fomo_get_config

- MCP tool: `fomo_get_config`
- State: **exposed read-only**
- Upstream: `GET https://prod-api.fomo.family/config` (base: `fomo`; auth: `identity`)
- Description: Read application configuration.
- Response: `FomoConfig`: Upstream application configuration.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| No parameters | - | - | - | - | - |

MCP arguments (replace placeholders with authorized ids/addresses and documented feed types):

```json
{}
```

## auth

### privy_refresh_session

- MCP tool: not registered
- State: **catalog reference / disabled**
- Upstream: `POST https://auth.privy.io/api/v1/sessions` (base: `privy`; auth: `access`); body mode: `object`
- Description: Internal credential-rotation endpoint used by AuthManager, not a data tool. It accepts a refresh token and returns session credentials, which must never be exposed to an MCP consumer. Catalog exclusion does not disable internal session refresh.
- Response: `PrivySession`: Rotated Privy access and refresh tokens; does not mint an identity token.

| Input | Location | Type | Required | Wire name | Default / description |
| --- | --- | --- | --- | --- | --- |
| `refresh_token` | body | `string` | yes | same | none |

## Local daemon routes

These routes are local control-plane routes on `127.0.0.1:8387`; they are not upstream MCP data tools.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Process liveness. |
| GET | `/readyz` | Readiness; returns 503 when identity auth is unavailable or expired. |
| GET | `/config/status` | Catalog counts and source metadata. |
| GET | `/auth/status` | Secret-free auth metadata. |
| GET | `/auth/form` | Local interactive authorization form. |
| GET | `/auth/start` | Returns the local authorization URL. |
| POST | `/auth/oauth/start` | Starts manual OAuth flow. |
| GET | `/auth/oauth/:id` | Reads manual OAuth flow status. |
| GET | `/auth/oauth/:id/open` | Redirects to the generated authorization URL. |
| POST | `/auth/oauth/:id/complete` | Completes a state/PKCE-checked callback. |
| POST | `/auth/session/start` | Starts the dedicated headed browser flow. |
| GET | `/auth/session/:id` | Reads browser flow status. |
| POST | `/auth/session/:id/open` | Opens the observed authorization URL in the auth browser. |
| POST | `/auth/session/:id/redirect` | Submits a validated callback URL to the browser flow. |

## Endpoint discovery and refresh

Run `npm run endpoints:discover` to fetch the current public FOMO HTML/manifest/JavaScript graph and store one machine-readable snapshot at ignored `data/endpoint-discovery.json`. It does not create a reports directory unless `--output-dir reports` is supplied for a disposable test/export run. The default run never edits the catalog or starts a browser. Manual aliases are available: `npm run endpoints:check` compares with the snapshot and stays report-only; `npm run endpoints:refresh` compares and applies only reviewed `discoveryCandidates`; add `--report-only` to keep refresh non-mutating. Both aliases create an initial snapshot when none exists. The parser uses the installed TypeScript dependency without executing application JavaScript, so maintenance requires a full development install (`npm ci`), not an install that omits development dependencies.

Use `npm run endpoints:discover -- --baseline latest` to compare against the saved snapshot, or pass an explicit snapshot JSON path. An optional `--output-dir <test-report-dir>` writes a Markdown/JSON export for review. Snapshots and exports include added/removed route references, changed SHA-256 evidence, unknown routes, catalog records not observed, and current asset URLs. A changed asset is a prompt to review its contract; no automatic parameter inference is performed.

After review, put approved complete endpoint records in the optional top-level `discoveryCandidates` array of `config/endpoints.json`. Run `npm run endpoints:refresh` (or `npm run endpoints:discover -- --apply`) to promote only those records with current route evidence. It rejects side effects, internal records, conflicts, and catalog edits made during the network run; writes atomically; increments the version only for additions; and updates discovery provenance. Existing contracts are edited directly in `endpoints`, and unseen records are never automatically removed or enabled. Run a single apply process at a time.

After any catalog edit/apply, run `npm run docs:api` and `npm run build`, review the diff, and perform an authorized read-only probe when authentication is ready. Restart affected MCP hosts/daemon to load new catalog schemas; processes load the catalog at startup. The periodic agent procedure is in [AI agent workflow](AGENT_WORKFLOW.md#endpoint-maintenance-run).

## Evidence limits

Static frontend discovery is not an official OpenAPI document. It cannot prove response schemas, permissions, freshness, or stability. Authenticated endpoint probes with recorded HTTP status and request id remain required before relying on a newly discovered route in production collection.

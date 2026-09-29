# API and MCP tools

The complete structured contract is in `config/endpoints.json`. `exposed` means an available MCP tool; `internal` means a catalog record kept for upstream context but not registered. All listed routes require `identity` unless stated otherwise.

Base URLs: `fomo=https://prod-api.fomo.family`, `mobula=https://mobula-api.fomo.family`, `privy=https://auth.privy.io`.

## Users and portfolio

| Tool | Method | Route | Parameters | State |
| --- | --- | --- | --- | --- |
| `fomo_get_user_by_handle` | GET | `/v2/users/userHandle/{handle}` | `handle` path | exposed |
| `fomo_get_user` | GET | `/v2/users/{id}` | `id` path | exposed |
| `fomo_get_following_ids` | GET | `/v2/users/current/followingIds` | none | exposed |
| `fomo_search_users` | GET | `/v2/users/fuzzy-search` | `searchTerm` | exposed |
| `fomo_get_user_swaps` | GET | `/v2/users/{id}/swaps` | `id`, `tokenAddress?` | exposed |
| `fomo_get_user_rank` | GET | `/v2/users/{id}/leaderboard` | `id` | exposed |
| `fomo_get_spotlight` | GET | `/v2/users/{id}/spotlight` | `id` | exposed |
| `fomo_get_recommended_users` | GET | `/v2/users/{id}/recommendedUsers` | `id` | exposed |
| `fomo_get_balances` | GET | `/v2/users/{id}/balances` | `id` | exposed |
| `fomo_get_pnl_equity_series` | GET | `/v2/userTokens/aggregatedSnapshot` | `userId`, `timestamp` | exposed |
| `fomo_get_snapshot_by_id` | GET | `/v2/userTokens/aggregatedSnapshotById` | `userId`, `snapshotId` | exposed |

## Leaderboards and clans

| Tool | Method | Route | Parameters | State |
| --- | --- | --- | --- | --- |
| `fomo_get_leaderboard` | GET | `/v2/leaderboard/{window}` (`all` uses `/v2/leaderboard`) | `window=24h\|7d\|30d\|all` | exposed |
| `fomo_get_clan_leaderboard` | GET | `/v2/clans/leaderboard` | `window?`, `limit?` | exposed |
| `fomo_search_clans` | GET | `/v2/clans/search` | `searchTerm` | exposed |
| `fomo_get_clan` | GET | `/v2/clans/{id}` | `id`, `window?` | exposed |
| `fomo_get_clan_holdings` | GET | `/v2/clans/{id}/holdings` | `id`, `limit?` | exposed |
| `fomo_get_clan_holding_breakdown` | GET | `/v2/clans/{id}/holdings/breakdown` | `id`, `tokenAddress`, `networkId` | exposed |
| `fomo_get_clan_feed` | GET | `/v2/clans/{id}/feed` | `id`, `limit?`, `feedTypes[]?` | exposed |

## Trades

| Tool | Method | Route | Parameters | State |
| --- | --- | --- | --- | --- |
| `fomo_get_trades` | GET | `/trades` | `userId?`, `orderBy?`, `tokenAddress?` | exposed |
| `fomo_get_trade` | GET | `/trades/{id}` | `id` | exposed |
| `fomo_get_trade_comments` | GET | `/trades/{tradeId}/comments` | `tradeId`, `lastCommentId?` | exposed |

## Tokens

| Tool | Method | Route | Parameters | State |
| --- | --- | --- | --- | --- |
| `fomo_filter_tokens` | POST | `/proxy/filterTokens` | body `tokenIds[]` | exposed |
| `fomo_search_tokens` | POST | `/proxy/filterTokensSearch` | body `phrase` | exposed |
| `fomo_token_details` | POST | `/proxy/tokenDetails` | body `tokenId` | exposed |
| `fomo_token_warnings` | POST | `/proxy/tokenWarnings` | body `tokenAddress`, `networkId`; wire `address` | exposed |
| `fomo_verified_tokens` | GET | `/proxy/verifiedTokens` | none | exposed |
| `fomo_top_holders` | GET | `/hodlers/top` | query `tokens[]` JSON; wire `address` | exposed |
| `fomo_dev_holdings` | GET | `/hodlers/devs` | `tokenAddress`, `networkId` | exposed |
| `fomo_friends_holdings` | POST | `/hodlers/friends` | body `tokens[]`; wire `address` | exposed |
| `fomo_token_allow_list` | GET | `/tokenAllowList/detailed` | none | exposed |
| `fomo_ohlcv` | GET | `/api/2/token/ohlcv-history` | `address`, `chain`, `period?`, `usd?`; wire `chainId` | exposed, mobula |

## Feed, account, and meta

| Tool | Method | Route | Parameters | State |
| --- | --- | --- | --- | --- |
| `fomo_token_feed` | GET | `/feed/token` | `tokenAddress`, `networkId`, `limit?`, `threshold?`, `excludeThesis?` | exposed |
| `fomo_token_thesis` | GET | `/feed/token/thesis` | `tokenAddress`, `networkId`, `limit?`, `threshold?` | exposed |
| `fomo_token_sorted_thesis` | GET | `/feed/token/sortedThesis` | token + `afterTime?`, `beforeTime?` | exposed |
| `fomo_trading_activity` | GET | `/feed/tradingActivity` | `limit?`, `threshold?` | exposed |
| `fomo_get_watchlist` | GET | `/watchlist` | none | exposed |
| `fomo_transfers_with` | GET | `/v2/transfers/with/{userId}` | `userId` | exposed |
| `fomo_supported_transfer_tokens` | GET | `/transfers/v2/supportedTokens` | none | exposed, read-only |
| `fomo_get_config` | GET | `/config` | none | exposed |

## Unavailable catalog records

| Tool/route | Reason |
| --- | --- |
| `fomo_request_swap_quote` / `POST /swaps/v2` | reference/internal; not registered |
| `fomo_add_watchlist` / `POST /watchlist` | mutation; forbidden |
| `fomo_remove_watchlist` / `DELETE /watchlist` | mutation; forbidden |
| `privy_refresh_session` / `POST /api/v1/sessions` | internal auth; not an MCP tool |

The current catalog has 43 records: 39 exposed read-only records and 4 disabled/internal records.

## Local daemon routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | process liveness |
| `/readyz` | GET | identity availability and auth metadata |
| `/config/status` | GET | catalog and exposed counts |
| `/auth/status` | GET | auth metadata without secrets |
| `/auth/form` | GET | local authorization HTML form |
| `/auth/start` | GET | returns the form URL |
| `/auth/oauth/start` | POST | creates a manual Google OAuth flow |
| `/auth/oauth/:id` | GET | manual flow status |
| `/auth/oauth/:id/open` | GET | redirects to the authorization URL |
| `/auth/oauth/:id/complete` | POST | accepts callback URL and checks state/PKCE |
| `/auth/session/start` | POST | starts a headed Chrome flow |
| `/auth/session/:id` | GET | browser flow status |
| `/auth/session/:id/open` | POST | opens the observed Google URL |
| `/auth/session/:id/redirect` | POST | passes a callback URL to the browser flow |

The daemon listens on `127.0.0.1:8387` by default. This is a local control plane, not a public API.

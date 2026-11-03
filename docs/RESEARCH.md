# Read-only research methodology

This project can be used as a read-only data source for trader and copy-trading research. Research results are agent-derived analysis; they are not MCP fields, trading instructions, return guarantees, or evidence of insider activity.

## Candidate study workflow

1. Capture the `24h`, `7d`, `30d`, and `all` leaderboard windows and union users by FOMO profile UUID.
2. Filter a candidate pool using positive leaderboard windows and an explicit audience floor. Keep the original snapshots so later ranking changes remain auditable.
3. Read the profile, rank, interval snapshots, daily PnL series, trades, swaps, followers, spotlight, and top theses for the selected pool.
4. Paginate `fomo_get_trades` and `fomo_get_user_swaps` with their provider cursors. Apply the date boundary to closed trade timestamps or swap timestamps only. Keep `activeTrades` separate and deduplicate every row by stable id.
5. Measure recent follower activity with a bounded trades sample. A lifetime `swapCount` or `numTrades` proves historical use, not recent activity.
6. Export raw payloads, normalized tables, call manifests, and derived metrics separately. Preserve nulls as nulls; never turn missing provider values into zero.

The current catalog exposes 59 read-only data tools. Trader research uses a focused subset. A separate endpoint smoke run may cover the wider catalog, but results from different time windows must remain separate evidence.

## Interpreting the metrics

- Leaderboard PnL is a provider snapshot and may include holdings or other exposure outside the observed closed-trade sample.
- Observed realised PnL is computed from returned closed trades and is complete only when the cursor reaches the requested boundary or the provider ends the available history before that boundary.
- Daily positive rate is computed from consecutive PnL-series deltas returned by `fomo_get_pnl_equity_series` with an ISO timestamp and `interval=86400`. It is not a complete accounting ledger.
- Concentration, liquidity and follower-activity fields are risk indicators for further review. They are not calibrated probabilities.
- Timing and peer comparisons require matched time windows and market controls. A `review_signal` is a request for more investigation, never an insider-trading conclusion.
- Copyability requires a separate delay, fee, slippage, liquidity and partial-fill simulation. Historical profitability alone cannot prove that a copied execution would be profitable.

## Authentication proof boundary

Call a normal read-only data tool to prove live access. `auth/status` and `fomo_auth_status` expose metadata only. Before an authenticated request, `AuthManager.ensureSession()` rereads encrypted state and can rotate the Privy session when the required token is expired. A retryable read-only HTTP 401 gets one refresh-and-retry attempt. If refresh is rejected or no usable identity token remains, the gateway returns `reauthRequired: true` and starts the documented manual OAuth flow.

Keep raw research exports under the ignored `reports/` directory. Do not commit tokens, cookies, wallet secrets, or credential-bearing payloads.

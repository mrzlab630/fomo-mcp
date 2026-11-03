# Changelog

## 0.1.6 — 2026-11-03

- Corrected `fomo_get_relay_fee_balance` to use the identity token required by the live FOMO route.
- Documented the ISO-8601 timestamp contract for `fomo_get_pnl_equity_series` and added a catalog regression check.
- Revalidated `fomo_get_current_user` against the current production route; the historical transfer-with-user route remains disabled/internal.

## 0.1.5 — 2026-11-03

- Documented the read-only trader research methodology, corrected cursor and date-boundary rules, derived metric limits, and live-auth proof boundary.
- Clarified that authenticated data requests can refresh an expired identity/access session before manual Google reauthorization is required.
- Added the research methodology reference to the README agent documentation index.
- Synchronized the runtime MCP version and user-agent with the package release.
- Regenerated the API reference from the current endpoint catalog.

## 0.1.4 — 2026-11-02

- Refreshed the production endpoint catalog and generated API documentation.

# FOMO MCP: AI agent rules

This file is the working contract for an agent continuing this project.

## Sources of truth

1. `config/endpoints.json` is the only catalog of upstream routes, parameters,
   wire names, response types, and exposure policy.
2. `config/runtime.json` contains changeable launch, transport, auth, and daemon settings.
3. `src/` is the implementation. Do not add a route or parameter only to README.
4. `README.md`, `docs/API.md`, and `docs/AUTH.md` explain the contract and must be updated with catalog or auth flow changes.

## Security boundaries

- The MCP surface is read-only. `sideEffect: mutation` is rejected by `assertReadOnly`.
- `expose: false` and `internalOnly: true` records are not MCP tools.
- Do not add wallet signing, swaps, transfers, watchlist mutations, scraping, stealth flags, or browser property spoofing.
- Never print tokens, cookies, the master key, OAuth codes, or a complete auth import. Logs may contain only metadata.
- Do not treat `/auth/start`, `/auth/form`, or token presence as proof of access. Live proof requires a real read-only request.

## Choosing a route

- Find the required `id` in `config/endpoints.json` first.
- Pass MCP parameters using `request.params[].name`; the adapter builds path, query, and body values and applies `wireName`/`rename`.
- Leaderboard windows are `24h`, `7d`, `30d`, and `all`; upstream may not support arbitrary windows such as `5d`.
- `fomo_get_leaderboard` returns users. `fomo_get_clan_leaderboard` returns clans.
- MCP responses contain `data` and `meta` (`endpointId`, source, status, requestId, attempts, fetchedAt, responseType).

## Authentication

- FOMO API access requires a valid identity token, not only an access token.
- When `reauthRequired: true`, stop data requests and ask the user to follow `docs/AUTH.md`.
- Secrets are stored in encrypted `data/auth-state.enc.json`; the master key is supplied through `FOMO_MCP_MASTER_KEY`.

## Proof before completing a change

```bash
npm run build
jq -e . config/endpoints.json
curl --noproxy '*' -sS http://127.0.0.1:8387/healthz
curl --noproxy '*' -sS http://127.0.0.1:8387/config/status
```

Live changes additionally require an authorized read-only endpoint and recorded HTTP status/requestId.

## Git

- One logical change per Conventional Commit.
- Never commit `data/`, `logs/`, `dist/`, `.env`, or token-bearing files.
- Before committing, run `git status --short`, `git diff --check`, and `npm run build`.
- If history is absent, create the initial `main` branch; no merge is needed without another branch or remote.

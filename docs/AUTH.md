# Authentication

## Token model

The FOMO API is called through the browser transport with `Authorization: Bearer <identity token>`.
The enabled Mobula OHLCV route uses the same identity token through direct transport.
Privy access/refresh tokens are used for session operations and do not replace the identity token.

| State | Meaning |
| --- | --- |
| `available: true` | An identity token is stored |
| `reauthRequired: false` | The identity token has not expired according to JWT `exp` |
| `reauthRequired: true` | The token is missing or expired; interactive login is required |

`/auth/status` and `fomo_auth_status` may also expose `accessTokenExpiresAt`
and `refreshTokenExpiresAt` when those JWT expiry values are available. Token
values are never returned.

## Recommended agent flow

1. Call the requested data tool directly. If it returns `reauthRequired: true`,
   the MCP gateway starts the visible headed browser flow through the daemon.
   Explicit `fomo_auth_status` checks start it too when authorization is needed;
   HTTP `GET /auth/status` only reads metadata and never opens a browser.
2. Tell the user to complete the visible FOMO sign-in window. If
   `browser.started` is false, use `authUrl` as the local fallback or call
   `fomo_auth_start` for an explicit retry.
3. Poll `fomo_auth_status` while the browser flow is active. It reads the current
   daemon flow state. On `browser.status: failed`, stop polling and offer the
   fallback or an explicit restart; automatic polling does not repeatedly
   launch windows.
4. When `ready: true`, retry the original data request once. A successful
   read-only response, not auth metadata alone, proves FOMO access.

On the fallback page, **Continue with FOMO** launches the dedicated browser.
**Use another browser** starts the manual Google flow. After sign-in, paste the
complete callback URL (`https://fomo.family/favicon.ico?privy_oauth_state=...&privy_oauth_code=...`
or a callback from `/token`) into the form. The daemon checks host/path, state
and PKCE before completing manual OAuth.

## Browser flow

`POST /auth/session/start` launches ordinary headed Chrome with a dedicated persistent profile at `~/.local/share/fomo-mcp/google-profile` by default. The first authorization may require a normal Google login; later authorizations reuse the Google session and usually require only a confirmation click. The profile is separate from the user's normal Chrome profile, protected with mode `0700`, and never copied or scraped. The flow imports tokens and cookies into the encrypted auth store, then closes Chrome while retaining the profile for the next authorization.

Set `FOMO_MCP_BROWSER_PROFILE_DIR` or `auth.browserProfileDir` to choose another dedicated profile path. Only one authorization flow may use the profile at a time. If the profile is deleted, its Google session expires, or Google requires an additional check, the next authorization falls back to the normal login flow.

## Session refresh and reauthorization

`privy_refresh_session` is an internal catalog reference, not an MCP data tool.
Its exclusion prevents refresh-token inputs and session-credential outputs from
being exposed to agents; it does not disable AuthManager's internal refresh.

- Before an authenticated request, the gateway rereads the encrypted state and
  performs one shared Privy refresh when the token required by that endpoint is
  expired and a refresh pair is available. A valid identity token does not
  require rotation merely because the access token is expired.
- A read-only authenticated request may receive one HTTP 401 refresh-and-retry
  cycle. Mutating requests are never retried by the transport.
- If Privy rejects the refresh, or refresh does not provide a usable identity
  token for an identity-authenticated request, the request returns
  `reauthRequired: true` and starts the visible browser flow with a local
  authorization link as fallback.
- OAuth codes are single-use and expire quickly. On `expired or invalid`, create a new flow.
- `auth:refresh` may rotate the access/refresh pair. An expired identity token
  still requires a new Google login unless a refresh response supplies a fresh
  identity token.

## Storage

```text
data/auth-state.enc.json  AES-256-GCM, mode 0600, never commit
FOMO_MCP_MASTER_KEY       32-byte hex or base64url, never print
```

For manual import, use `npm run auth:import -- <file>`. Keep the import file outside the repository and delete it after use.

## Proof

```bash
curl --noproxy '*' -sS http://127.0.0.1:8387/auth/status
curl --noproxy '*' -sS http://127.0.0.1:8387/readyz
```

Readiness is false with HTTP `503` when `auth.reauthRequired` is true, even if an identity token is present but expired. HTTP `200` and `ready: true` require both an available and non-expired identity token.

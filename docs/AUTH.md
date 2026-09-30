# Authentication

## Token model

The FOMO API is called through the browser transport with `Authorization: Bearer <identity token>`.
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

1. Check `GET http://127.0.0.1:8387/auth/status` or MCP `fomo_auth_status`.
2. If `reauthRequired` is `true`, give the user `http://127.0.0.1:8387/auth/form`.
3. The user clicks **Start Google link flow**, opens Google, and provides the complete callback URL:
   `https://fomo.family/favicon.ico?privy_oauth_state=...&privy_oauth_code=...`.
   A callback already received from the live site at `/token` is also accepted.
4. The form sends it to `POST /auth/oauth/:id/complete`. The daemon checks host/path, state, and PKCE verifier.
5. Check auth status again. Only `captured` plus `reauthRequired: false` permits a live read-only request.

## Browser flow

`POST /auth/session/start` launches ordinary headed Chrome with a dedicated persistent profile at `~/.local/share/fomo-mcp/google-profile` by default. The first authorization may require a normal Google login; later authorizations reuse the Google session and usually require only a confirmation click. The profile is separate from the user's normal Chrome profile, protected with mode `0700`, and never copied or scraped. The flow imports tokens and cookies into the encrypted auth store, then closes Chrome while retaining the profile for the next authorization.

Set `FOMO_MCP_BROWSER_PROFILE_DIR` or `auth.browserProfileDir` to choose another dedicated profile path. Only one authorization flow may use the profile at a time. If the profile is deleted, its Google session expires, or Google requires an additional check, the next authorization falls back to the normal login flow.

## Session refresh and reauthorization

- Before an authenticated request, the gateway rereads the encrypted state and
  performs one shared Privy refresh when an access or identity token is expired
  and a refresh pair is available.
- A read-only authenticated request may receive one HTTP 401 refresh-and-retry
  cycle. Mutating requests are never retried by the transport.
- If Privy rejects the refresh, or refresh does not provide a usable identity
  token for an identity-authenticated request, the request returns
  `reauthRequired: true` with the local authorization link.
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

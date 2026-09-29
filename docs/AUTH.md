# Authentication

## Token model

The FOMO API is called through the browser transport with `Authorization: Bearer <identity token>`.
Privy access/refresh tokens are used for session operations and do not replace the identity token.

| State | Meaning |
| --- | --- |
| `available: true` | An identity token is stored |
| `reauthRequired: false` | The identity token has not expired according to JWT `exp` |
| `reauthRequired: true` | The token is missing or expired; interactive login is required |

## Recommended agent flow

1. Check `GET http://127.0.0.1:8387/auth/status` or MCP `fomo_auth_status`.
2. If `reauthRequired` is `true`, give the user `http://127.0.0.1:8387/auth/form`.
3. The user clicks **Start Google link flow**, opens Google, and provides the complete callback URL:
   `https://fomo.family/favicon.ico?privy_oauth_state=...&privy_oauth_code=...`.
4. The form sends it to `POST /auth/oauth/:id/complete`. The daemon checks host/path, state, and PKCE verifier.
5. Check auth status again. Only `captured` plus `reauthRequired: false` permits a live read-only request.

## Browser flow

`POST /auth/session/start` launches ordinary headed Chrome with a temporary profile. It observes FOMO/Privy login, imports tokens and cookies, then deletes the profile. This is a local helper, not a stealth collector.

## Errors and reauthorization

- HTTP 401 or `ReauthRequiredError` stops the current request.
- OAuth codes are single-use and expire quickly. On `expired or invalid`, create a new flow.
- `auth:refresh` may rotate the access/refresh pair. An expired identity token still requires a new Google login.

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

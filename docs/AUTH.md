# Authentication

## Token model

The FOMO API is called through the browser transport with `Authorization: Bearer <identity token>`.
The enabled Mobula OHLCV route uses the same identity token through direct transport.
Privy access/refresh tokens are used for session operations and do not replace the identity token.

| State | Meaning |
| --- | --- |
| `available: true` | An identity token is stored |
| `reauthRequired: false` | The identity token has a readable JWT `exp` in the future |
| `reauthRequired: true` | The stored identity token is missing, expired, or has no readable `exp`; a data request may still recover it through the stored refresh pair before interactive login is required |

`/auth/status` and `fomo_auth_status` may also expose `accessTokenExpiresAt`
and `refreshTokenExpiresAt` when those JWT expiry values are available. Token
values are never returned.

Identity expiry comes from the token payload, even if an import supplies a
different `identityTokenExpiresAt`. Decoding `exp` checks local freshness only;
it does not verify the JWT signature or prove upstream access.

## Recommended agent flow

1. Call the requested data tool directly. If it returns `reauthRequired: true`,
   the MCP gateway starts a manual OAuth flow through the daemon.
   Explicit `fomo_auth_status` checks start it too when authorization is needed;
   HTTP `GET /auth/status` only reads metadata and never starts a flow.
2. Open the flow-specific `authUrl` in the user's normal browser, outside an
   embedded or CDP-controlled window. The local form resumes polling that flow.
   Complete Google sign-in and paste the callback URL into the form.
3. Poll `fomo_auth_status` while the OAuth flow is active. It reads the current
   daemon flow state. On `browser.status: failed`, stop polling and offer an
   explicit restart; automatic polling does not repeatedly create flows.
4. When `ready: true`, retry the original data request once. A successful
   read-only response, not auth metadata alone, proves FOMO access.

Do not use a stale `auth/status` response as the only live-access test. The
status endpoint reads metadata and does not perform a refresh. A normal
authenticated data request calls `ensureSession()`, rereads the encrypted
state, and can refresh the required token before sending the request.

On the local form, **Continue in your browser** starts the manual Google OAuth
flow. This is the normal path because Google may reject OAuth from a browser
that exposes a CDP debugging endpoint with
“This browser or app may not be secure”. **Use the FOMO window** remains a
optional path for environments where that browser flow is accepted. After sign-in, paste the
complete callback URL (`https://fomo.family/favicon.ico?privy_oauth_state=...&privy_oauth_code=...`
or a callback from `/token`) into the form. The daemon checks host/path, state
and PKCE before completing manual OAuth.

Manual OAuth init and code exchange each use `http.requestTimeoutMs` and the
streamed `http.maxResponseBytes` limit. Cookies from init and authenticate are
retained with the imported tokens. A code exchange is attempted only once per
flow, including timeouts; start a new flow after a failed exchange.
Unused manual flows expire after `auth.browserLoginTimeoutMs`. The callback
must use the exact HTTPS FOMO origin (no alternate port or embedded credentials)
and `/token` or `/favicon.ico`. Completed, failed and observed expired flows
discard their PKCE verifier and pending cookies. Credential exchanges reject
HTTP redirects.

## Browser flow

`POST /auth/session/start` launches ordinary headed Chrome with a dedicated persistent profile at `~/.local/share/fomo-mcp/google-profile` by default. The first authorization may require a normal Google login; later authorizations reuse the Google session and usually require only a confirmation click. The profile is separate from the user's normal Chrome profile, protected with mode `0700`, and never copied or scraped. The flow imports tokens and cookies into the encrypted auth store, then closes Chrome while retaining the profile for the next authorization.

Set `FOMO_MCP_BROWSER_PROFILE_DIR` or `auth.browserProfileDir` to choose another dedicated profile path. Only one authorization flow may use the profile at a time. If the profile is deleted, its Google session expires, or Google requires an additional check, the next authorization falls back to the normal login flow.

Capture accepts identity headers only from the configured FOMO origin and
token responses only from a successful response at the configured Privy OAuth
authenticate endpoint. Local storage is read only on the FOMO page. An expired
identity token cannot complete capture, and a response containing only the
access/refresh pair cannot erase an already observed current identity token.

FOMO currently uses Privy's HttpOnly cookie mode at
`https://privy.fomo.family` (`apiBases.privy`). Capture also reads `privy-token`
on the configured FOMO origin and `privy-access-token`/`privy-refresh-token` on
the configured Privy session endpoint. This supports the current frontend,
where the old localStorage refresh value is `deprecated`. Cookie values never
appear in status output. The legacy internal `idToken` field holds the bearer
credential accepted by FOMO; the `privy-token` cookie is a Privy access token,
not proof that the browser issued a separate Privy identity token.

Refresh and manual OAuth can import credentials from fresh response cookies
when the response body omits them. Existing cookies alone cannot stand in for a
new credential pair in either exchange.

## Session refresh and reauthorization

`privy_refresh_session` is an internal catalog reference, not an MCP data tool.
Its exclusion prevents refresh-token inputs and session-credential outputs from
being exposed to agents; it does not disable AuthManager's internal refresh.

- Before an authenticated request, the gateway rereads the encrypted state and
  performs one shared Privy refresh when the token required by that endpoint is
  expired and a refresh pair is available. A valid identity token does not
  require rotation merely because the access token is expired.
- The refresh decision is made per endpoint auth mode: identity endpoints need
  a current identity token, while access endpoints need a current access token.
  The refresh response must contain a complete rotated access/refresh pair; an
  identity token is persisted when the response supplies one.
- A read-only authenticated request may receive one HTTP 401 refresh-and-retry
  cycle. Mutating requests are never retried by the transport.
- A session refresh can return the rotated access/refresh pair and a fresh
  identity token in its JSON response or scoped response cookies. When a usable
  identity token is present, it is encrypted in the auth store and the original
  read-only request continues without another Google sign-in.
- If Privy rejects the refresh, or it does not provide a usable identity token
  for an identity-authenticated request, the request returns
  `reauthRequired: true` and starts the manual OAuth flow with a flow-specific
  local authorization link.
- OAuth codes are single-use and expire quickly. On `expired or invalid`, create a new flow.
- `auth:refresh` rotates the access/refresh pair and stores a fresh identity
  token when the response supplies one. Otherwise, an expired identity token
  requires interactive Google reauthorization through the local form; another
  explicit token import is not needed.

Refresh uses `apiBases.privy`, the HTTP timeout and streamed response-size limit,
and rejects redirects and malformed token pairs. A network failure is not
automatically replayed by the data transport. A refresh response cannot replace
a newer login that changed the stored refresh token while the request was in
flight. Shared refresh applies within one AuthManager instance; it is not a
cross-process lock.

## Local control boundary

The daemon checks Host against the configured listener and its loopback aliases,
rejects a foreign or opaque browser Origin, and rejects cross-site POST requests.
Local CLI/MCP requests without Origin remain supported. Responses disable
caching and framing. This protects the local browser boundary; it does not
authenticate other programs running on the same host. Keep the listener on
loopback.

## Storage

```text
data/auth-state.enc.json  AES-256-GCM, mode 0600, never commit
FOMO_MCP_MASTER_KEY       32-byte hex or base64url, never print
```

For manual import, use `npm run auth:import -- <file>`. Keep the import file outside the repository and delete it after use.

Each imported cookie requires a domain. Without a leading dot, it defaults to
host-only; a leading dot or explicit `hostOnly: false` allows subdomains. A
domainless legacy cookie is never sent. Response cookies preserve Domain versus
host-only scope, default to the response URL's directory path, and give Max-Age
precedence over Expires. The temporary API browser loads the scoped encrypted
jar and saves rotations and deletions back to it; it does not use the login
profile as its request jar.

Relative runtime auth-state and browser-profile paths resolve from the project
root, including when the runtime JSON is outside the repository. Absolute paths
and `~/` browser-profile paths retain their explicit locations.

## Proof

```bash
curl --noproxy '*' -sS http://127.0.0.1:8387/auth/status
curl --noproxy '*' -sS http://127.0.0.1:8387/readyz
```

Readiness is false with HTTP `503` when `auth.reauthRequired` is true, even if an identity token is present but expired or unreadable. HTTP `200` and `ready: true` require an available identity token with a readable future `exp`; a successful read-only request still provides the live proof.

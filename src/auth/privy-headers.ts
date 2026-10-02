import type { RuntimeConfig } from "../config/types.js";

export function privyHeaders(runtime: RuntimeConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    origin: runtime.http.origin,
    referer: runtime.http.referer,
    "privy-client": runtime.auth.privyClient,
    "privy-app-id": runtime.auth.privyAppId,
    "privy-client-id": runtime.auth.privyClientId,
    "user-agent": runtime.http.userAgent,
  };
}

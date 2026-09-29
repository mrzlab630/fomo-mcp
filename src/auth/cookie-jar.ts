import type { StoredCookie } from "../config/types.js";

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,\s*(?=[^;,=]+=[^;,]+)/g);
}

export function getSetCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

export function parseSetCookie(header: string, requestUrl: string): StoredCookie | null {
  const [pair, ...attributes] = header.split(";");
  if (!pair) return null;
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  const url = new URL(requestUrl);
  const cookie: StoredCookie = { name, value, domain: url.hostname, path: "/" };
  for (const rawAttribute of attributes) {
    const attribute = rawAttribute.trim();
    const [rawKey, ...rawValue] = attribute.split("=");
    const key = rawKey?.toLowerCase();
    const valuePart = rawValue.join("=").trim();
    if (key === "domain" && valuePart) cookie.domain = valuePart.toLowerCase();
    if (key === "path" && valuePart) cookie.path = valuePart;
    if (key === "max-age" && valuePart) cookie.expiresAt = Date.now() + Number(valuePart) * 1000;
    if (key === "expires" && valuePart) cookie.expiresAt = Date.parse(valuePart);
    if (key === "secure") cookie.secure = true;
    if (key === "httponly") cookie.httpOnly = true;
    if (key === "samesite" && ["strict", "lax", "none"].includes(valuePart.toLowerCase())) {
      cookie.sameSite = valuePart.toLowerCase() as StoredCookie["sameSite"];
    }
  }
  return cookie;
}

function domainMatches(cookieDomain: string | undefined, hostname: string): boolean {
  if (!cookieDomain) return true;
  const normalized = cookieDomain.replace(/^\./, "").toLowerCase();
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function pathMatches(cookiePath: string | undefined, requestPath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true;
  return requestPath === cookiePath || requestPath.startsWith(`${cookiePath}/`);
}

export function cookieHeader(cookies: StoredCookie[], requestUrl: string): string | undefined {
  const url = new URL(requestUrl);
  const now = Date.now();
  const values = cookies
    .filter((cookie) => !cookie.expiresAt || cookie.expiresAt > now)
    .filter((cookie) => domainMatches(cookie.domain, url.hostname))
    .filter((cookie) => pathMatches(cookie.path, url.pathname))
    .filter((cookie) => !cookie.secure || url.protocol === "https:")
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  return values.length > 0 ? values.join("; ") : undefined;
}

export function mergeSetCookies(
  existing: StoredCookie[],
  headers: string[],
  requestUrl: string,
): StoredCookie[] {
  const result = [...existing];
  for (const header of headers) {
    const parsed = parseSetCookie(header, requestUrl);
    if (!parsed) continue;
    const index = result.findIndex(
      (cookie) => cookie.name === parsed.name && cookie.domain === parsed.domain && cookie.path === parsed.path,
    );
    const expired = parsed.expiresAt !== undefined && parsed.expiresAt <= Date.now();
    if (expired) {
      if (index >= 0) result.splice(index, 1);
    } else if (index >= 0) {
      result[index] = parsed;
    } else {
      result.push(parsed);
    }
  }
  return result;
}

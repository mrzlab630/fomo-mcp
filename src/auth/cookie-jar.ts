import type { StoredCookie } from "../config/types.js";
import { isIP } from "node:net";

/** Imports require an explicit scope. A missing domain must never mean wildcard. */
export function normalizeCookie(cookie: StoredCookie): StoredCookie {
  if (!cookie || typeof cookie.domain !== "string" || !cookie.domain.trim()
    || typeof cookie.name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name)
    || typeof cookie.value !== "string" || /[;\r\n\x00]/.test(cookie.value)) {
    throw new Error("Cookie import requires a valid name, value and explicit domain");
  }
  const domain = cookie.domain.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.endsWith(".") || domain.includes("..")) {
    throw new Error("Cookie import has an invalid domain");
  }
  if (cookie.hostOnly !== undefined && typeof cookie.hostOnly !== "boolean") throw new Error("Invalid cookie hostOnly scope");
  if (cookie.expiresAt !== undefined && !Number.isFinite(cookie.expiresAt)) throw new Error("Invalid cookie expiry");
  if ([cookie.secure, cookie.httpOnly].some((value) => value !== undefined && typeof value !== "boolean")) throw new Error("Invalid cookie flags");
  if (cookie.path !== undefined && (typeof cookie.path !== "string" || !cookie.path.startsWith("/") || /[;\r\n\x00]/.test(cookie.path))) throw new Error("Invalid cookie path");
  return { ...cookie, domain, hostOnly: cookie.hostOnly ?? !cookie.domain.startsWith("."), path: cookie.path?.startsWith("/") ? cookie.path : "/" };
}

export function validCookies(cookies: StoredCookie[]): StoredCookie[] {
  return cookies.flatMap((cookie) => {
    try {
      const normalized = normalizeCookie(cookie);
      return normalized.expiresAt === undefined || normalized.expiresAt > Date.now() ? [normalized] : [];
    } catch { return []; }
  });
}

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
  const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
  const cookie: StoredCookie = { name, value, domain: url.hostname, hostOnly: true, path: defaultPath };
  let maxAge: number | undefined;
  for (const rawAttribute of attributes) {
    const attribute = rawAttribute.trim();
    const [rawKey, ...rawValue] = attribute.split("=");
    const key = rawKey?.toLowerCase();
    const valuePart = rawValue.join("=").trim();
    if (key === "domain" && valuePart) {
      cookie.domain = valuePart.replace(/^\./, "").toLowerCase();
      cookie.hostOnly = false;
      if (!domainMatches(cookie.domain, url.hostname, false)) return null;
    }
    if (key === "path" && valuePart.startsWith("/")) cookie.path = valuePart;
    if (key === "max-age" && /^-?\d+$/.test(valuePart)) maxAge = Number(valuePart);
    if (key === "expires" && Number.isFinite(Date.parse(valuePart))) cookie.expiresAt = Date.parse(valuePart);
    if (key === "secure") cookie.secure = true;
    if (key === "httponly") cookie.httpOnly = true;
    if (key === "samesite" && ["strict", "lax", "none"].includes(valuePart.toLowerCase())) {
      cookie.sameSite = valuePart.toLowerCase() as StoredCookie["sameSite"];
    }
  }
  if (maxAge !== undefined) cookie.expiresAt = maxAge <= 0 ? 0 : Math.min(8.64e15, Date.now() + maxAge * 1000);
  try { return normalizeCookie(cookie); } catch { return null; }
}

function domainMatches(cookieDomain: string | undefined, hostname: string, hostOnly: boolean): boolean {
  if (!cookieDomain) return false;
  const normalized = cookieDomain.replace(/^\./, "").toLowerCase();
  return hostname === normalized || (!hostOnly && !isIP(hostname) && hostname.endsWith(`.${normalized}`));
}

function pathMatches(cookiePath: string | undefined, requestPath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true;
  return requestPath === cookiePath || requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

export function cookieHeader(cookies: StoredCookie[], requestUrl: string): string | undefined {
  const url = new URL(requestUrl);
  const values = validCookies(cookies)
    .filter((cookie) => domainMatches(cookie.domain, url.hostname, cookie.hostOnly!))
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
  const result = validCookies(existing);
  for (const header of headers) {
    const parsed = parseSetCookie(header, requestUrl);
    if (!parsed) continue;
    const index = result.findIndex(
      (cookie) => cookie.name === parsed.name && cookie.domain === parsed.domain && cookie.path === parsed.path && cookie.hostOnly === parsed.hostOnly,
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

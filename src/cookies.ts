import { parse, serialize } from "cookie";
import type { IncomingMessage, ServerResponse } from "http";
import type { FortaConfig } from "./config";
import type { TokenPair } from "./types";

export const COOKIE_ACCESS_TOKEN = "forta-access-token";
export const COOKIE_REFRESH_TOKEN = "forta-refresh-token";
export const COOKIE_OAUTH_STATE = "forta-oauth-state";

/** Parses cookies from the incoming request's Cookie header. */
export function parseCookies(req: IncomingMessage): Record<string, string> {
    return parse(req.headers.cookie || "");
}

/**
 * setAuthCookies writes the access and refresh token cookies to the response
 * using the configured domain and security settings.
 */
export function setAuthCookies(
    res: ServerResponse,
    config: FortaConfig,
    tokens: TokenPair
): void {
    const secure = !config.cookieInsecure;
    const cookies: string[] = [];

    cookies.push(
        serialize(COOKIE_ACCESS_TOKEN, tokens.access_token, {
            domain: config.cookieDomain || undefined,
            path: "/",
            expires: new Date(tokens.expires_at),
            httpOnly: true,
            secure,
            sameSite: "lax",
        })
    );

    cookies.push(
        serialize(COOKIE_REFRESH_TOKEN, tokens.refresh_token, {
            domain: config.cookieDomain || undefined,
            path: "/",
            maxAge: 7 * 24 * 60 * 60, // 7 days
            httpOnly: true,
            secure,
            sameSite: "lax",
        })
    );

    appendCookies(res, cookies);
}

/** clearAuthCookies immediately expires both auth cookies. */
export function clearAuthCookies(
    res: ServerResponse,
    config: FortaConfig
): void {
    const secure = !config.cookieInsecure;
    const cookies: string[] = [];

    cookies.push(
        serialize(COOKIE_ACCESS_TOKEN, "", {
            domain: config.cookieDomain || undefined,
            path: "/",
            maxAge: 0,
            httpOnly: true,
            secure,
            sameSite: "lax",
        })
    );

    cookies.push(
        serialize(COOKIE_REFRESH_TOKEN, "", {
            domain: config.cookieDomain || undefined,
            path: "/",
            maxAge: 0,
            httpOnly: true,
            secure,
            sameSite: "lax",
        })
    );

    appendCookies(res, cookies);
}

/** setStateCookie writes a short-lived CSRF state cookie. */
export function setStateCookie(
    res: ServerResponse,
    config: FortaConfig,
    state: string
): void {
    const secure = !config.cookieInsecure;
    appendCookies(res, [
        serialize(COOKIE_OAUTH_STATE, state, {
            path: "/",
            expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
            httpOnly: true,
            secure,
            sameSite: "lax",
        }),
    ]);
}

/** clearStateCookie immediately expires the CSRF state cookie. */
export function clearStateCookie(
    res: ServerResponse,
    config: FortaConfig
): void {
    appendCookies(res, [
        serialize(COOKIE_OAUTH_STATE, "", {
            path: "/",
            maxAge: 0,
            httpOnly: true,
            secure: !config.cookieInsecure,
            sameSite: "lax",
        }),
    ]);
}

/** Appends Set-Cookie headers without clobbering previously set cookies. */
function appendCookies(res: ServerResponse, newCookies: string[]): void {
    const existing = res.getHeader("Set-Cookie");
    let all: string[];
    if (Array.isArray(existing)) {
        all = [...(existing as string[]), ...newCookies];
    } else if (typeof existing === "string") {
        all = [existing, ...newCookies];
    } else {
        all = newCookies;
    }
    res.setHeader("Set-Cookie", all);
}

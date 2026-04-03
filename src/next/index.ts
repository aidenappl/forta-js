/**
 * forta-js/next — Next.js App Router adapter for Forta authentication.
 *
 * Provides route handlers and a protect wrapper compatible with Next.js App
 * Router conventions (NextRequest / NextResponse).
 *
 * Usage:
 *
 *   // app/forta/login/route.ts
 *   import { loginHandler } from 'forta-js/next';
 *   export const GET = loginHandler;
 *
 *   // app/forta/callback/route.ts
 *   import { callbackHandler } from 'forta-js/next';
 *   export const GET = callbackHandler;
 *
 *   // app/forta/logout/route.ts
 *   import { logoutHandler } from 'forta-js/next';
 *   export const GET = logoutHandler;
 *
 *   // app/api/resource/route.ts
 *   import { protect } from 'forta-js/next';
 *   export const GET = protect(async (req, { fortaId, user }) => {
 *     return NextResponse.json({ id: fortaId, email: user?.email });
 *   });
 *
 * IMPORTANT: You must still call forta.setup(config) before these handlers
 * run; typically in a shared initialization module or instrumentation.ts.
 *
 * @module forta-js/next
 */

import { FortaClient } from "../client";
import type { FortaConfig } from "../config";
import { getPostLoginRedirect, getPostLogoutRedirect } from "../config";
import { validateAccessTokenLocal, isTokenExpiredError } from "../token";
import type { User, TokenPair, AuthResponse } from "../types";

// ── Types ───────────────────────────────────────────────────────────────────

/** Identity context passed to handlers wrapped by protect(). */
export interface FortaContext {
    fortaId: number;
    user: User | null;
}

/** A Next.js App Router-compatible route handler with Forta identity. */
export type ProtectedRouteHandler = (
    request: NextRequest,
    context: FortaContext
) => Response | Promise<Response>;

// ── Minimal Next.js types (avoids hard dependency on next) ──────────────────

interface NextRequestCookies {
    get(name: string): { name: string; value: string } | undefined;
}

interface NextRequest extends Request {
    cookies: NextRequestCookies;
    nextUrl: URL;
}

interface NextResponseCookieOptions {
    domain?: string;
    path?: string;
    expires?: Date;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
}

interface NextResponseCookies {
    set(name: string, value: string, options?: NextResponseCookieOptions): void;
    delete(name: string): void;
}

interface NextResponseStatic {
    redirect(url: string | URL, status?: number): NextResponseInstance;
    json(body: unknown, init?: ResponseInit): NextResponseInstance;
}

interface NextResponseInstance extends Response {
    cookies: NextResponseCookies;
}

// We import NextResponse dynamically to avoid hard dependency at load time.
let _NextResponse: NextResponseStatic | null = null;

async function getNextResponse(): Promise<NextResponseStatic> {
    if (_NextResponse) return _NextResponse;
    try {
        const mod = await import("next/server");
        _NextResponse = (mod as Record<string, unknown>).NextResponse as NextResponseStatic;
        return _NextResponse;
    } catch {
        throw new Error(
            "forta-js/next: could not import next/server. Install next as a dependency."
        );
    }
}

// ── Cookie names (must match the core library) ─────────────────────────────

const COOKIE_ACCESS_TOKEN = "forta-access-token";
const COOKIE_REFRESH_TOKEN = "forta-refresh-token";
const COOKIE_OAUTH_STATE = "forta-oauth-state";

// ── Internal client access (same global as the core library) ────────────────

let _client: FortaClient | null = null;

/**
 * setupNext configures the Forta client for the Next.js adapter. If you have
 * already called `forta.setup()` from the main package, call this with the
 * same config so the Next.js adapter can access the client.
 *
 * Alternatively, import { setup } from 'forta-js' and it will be available
 * to the Node.js handlers; use setupNext() only for the App Router adapter.
 */
export function setupNext(config: FortaConfig): void {
    _client = new FortaClient(config);
}

function requireClient(): FortaClient {
    if (!_client) {
        throw new Error(
            "forta-js/next: setupNext() has not been called. " +
            "Call setupNext(config) before using Next.js route handlers."
        );
    }
    return _client;
}

// ── Cookie helpers for NextResponse ─────────────────────────────────────────

function setAuthCookiesOnResponse(
    res: NextResponseInstance,
    config: FortaConfig,
    tokens: TokenPair
): void {
    const secure = !config.cookieInsecure;
    res.cookies.set(COOKIE_ACCESS_TOKEN, tokens.access_token, {
        domain: config.cookieDomain || undefined,
        path: "/",
        expires: new Date(tokens.expires_at),
        httpOnly: true,
        secure,
        sameSite: "lax",
    });
    res.cookies.set(COOKIE_REFRESH_TOKEN, tokens.refresh_token, {
        domain: config.cookieDomain || undefined,
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
        httpOnly: true,
        secure,
        sameSite: "lax",
    });
}

function clearAuthCookiesOnResponse(
    res: NextResponseInstance,
    config: FortaConfig
): void {
    const secure = !config.cookieInsecure;
    res.cookies.set(COOKIE_ACCESS_TOKEN, "", {
        domain: config.cookieDomain || undefined,
        path: "/",
        maxAge: 0,
        httpOnly: true,
        secure,
        sameSite: "lax",
    });
    res.cookies.set(COOKIE_REFRESH_TOKEN, "", {
        domain: config.cookieDomain || undefined,
        path: "/",
        maxAge: 0,
        httpOnly: true,
        secure,
        sameSite: "lax",
    });
}

function generateState(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function extractTokenFromNextRequest(request: NextRequest): string | null {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const candidate = authHeader.slice(7);
        if ((candidate.match(/\./g) || []).length === 2) {
            return candidate;
        }
    }
    const cookie = request.cookies.get(COOKIE_ACCESS_TOKEN);
    if (cookie?.value) {
        return cookie.value;
    }
    return null;
}

function jsonError(
    NR: NextResponseStatic,
    status: number,
    message: string
): NextResponseInstance {
    return NR.json(
        { success: false, error_message: message },
        { status }
    );
}

// ── Route handlers ──────────────────────────────────────────────────────────

/**
 * loginHandler — Next.js App Router GET handler.
 * Redirects the browser to the Forta OAuth2 authorization endpoint.
 */
export async function loginHandler(
    request: NextRequest
): Promise<Response> {
    const NR = await getNextResponse();
    const client = requireClient();
    const config = client.config;

    // First-party appleby.cloud services
    if (config.cookieDomain === ".appleby.cloud") {
        let redirectBack = getPostLoginRedirect(config);
        if (!redirectBack.startsWith("http")) {
            let origin: string;
            if (config.appDomain) {
                origin = config.appDomain.replace(/\/+$/, "");
            } else {
                origin = request.nextUrl.origin;
            }
            redirectBack = origin + redirectBack;
        }
        const loginURL = `${config.loginDomain}/?redirect_uri=${encodeURIComponent(redirectBack)}`;
        return NR.redirect(loginURL, 302);
    }

    const state = generateState();
    const loginURL =
        `${config.loginDomain}/oauth/authorize?response_type=code` +
        `&client_id=${encodeURIComponent(config.clientId)}` +
        `&redirect_uri=${encodeURIComponent(config.callbackUrl || "")}` +
        `&state=${encodeURIComponent(state)}` +
        `&scope=openid`;

    const res = NR.redirect(loginURL, 302);
    res.cookies.set(COOKIE_OAUTH_STATE, state, {
        path: "/",
        expires: new Date(Date.now() + 10 * 60 * 1000),
        httpOnly: true,
        secure: !config.cookieInsecure,
        sameSite: "lax",
    });

    return res;
}

/**
 * callbackHandler — Next.js App Router GET handler.
 * Handles the OAuth2 redirect, exchanges the code, and sets auth cookies.
 */
export async function callbackHandler(
    request: NextRequest
): Promise<Response> {
    const NR = await getNextResponse();
    const client = requireClient();
    const config = client.config;
    const params = request.nextUrl.searchParams;

    // Check for error from authorization server.
    const errParam = params.get("error");
    if (errParam) {
        const errDesc = params.get("error_description") || "";
        return jsonError(NR, 400, `authorization error: ${errParam}: ${errDesc}`);
    }

    const code = params.get("code");
    const state = params.get("state");

    if (!code) {
        return jsonError(NR, 400, "missing code parameter");
    }

    // Validate CSRF state.
    const stateCookie = request.cookies.get(COOKIE_OAUTH_STATE);
    if (!stateCookie?.value) {
        return jsonError(
            NR,
            400,
            "missing state cookie — possible CSRF or expired session"
        );
    }
    if (stateCookie.value !== state) {
        return jsonError(NR, 400, "state mismatch — possible CSRF attack");
    }

    // Exchange code for tokens.
    let authResp: AuthResponse;
    try {
        authResp = await client.exchangeCode(code);
    } catch {
        return jsonError(NR, 401, "failed to exchange authorization code");
    }

    let redirect = getPostLoginRedirect(config);
    if (config.appDomain && !redirect.startsWith("http")) {
        redirect = config.appDomain.replace(/\/+$/, "") + redirect;
    }

    const res = NR.redirect(redirect, 302);
    setAuthCookiesOnResponse(res, config, authResp.authorization);
    // Clear the state cookie.
    res.cookies.set(COOKIE_OAUTH_STATE, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        secure: !config.cookieInsecure,
        sameSite: "lax",
    });

    return res;
}

/**
 * logoutHandler — Next.js App Router GET handler.
 * Clears auth cookies and redirects to postLogoutRedirect.
 */
export async function logoutHandler(
    request: NextRequest
): Promise<Response> {
    const NR = await getNextResponse();
    const client = requireClient();
    const config = client.config;

    let redirect = getPostLogoutRedirect(config);
    if (config.appDomain && !redirect.startsWith("http")) {
        redirect = config.appDomain.replace(/\/+$/, "") + redirect;
    }

    const res = NR.redirect(redirect, 302);
    clearAuthCookiesOnResponse(res, config);
    return res;
}

/**
 * protect — wraps a Next.js App Router route handler, requiring a valid Forta
 * access token. On success, calls the handler with the Forta identity context.
 */
export function protect(handler: ProtectedRouteHandler) {
    return async function protectedHandler(
        request: NextRequest
    ): Promise<Response> {
        const NR = await getNextResponse();
        const client = requireClient();
        const config = client.config;

        let tokenStr = extractTokenFromNextRequest(request);
        if (!tokenStr) {
            return jsonError(NR, 401, "missing or invalid authorization");
        }

        let userId = 0;
        let user: User | null = null;

        if (config.jwtSigningKey) {
            // ── Local JWT validation ──────────────────────────────────────────
            try {
                userId = validateAccessTokenLocal(tokenStr, config.jwtSigningKey);
            } catch (err) {
                if (!isTokenExpiredError(err) || config.disableAutoRefresh) {
                    return jsonError(NR, 401, "invalid or expired access token");
                }
                // Try refresh.
                const refreshResult = await tryRefreshNext(client, request);
                if (!refreshResult) {
                    return jsonError(NR, 401, "session expired, please log in again");
                }
                tokenStr = refreshResult.accessToken;
                userId = refreshResult.userId;
                // Note: for Next.js, refreshed cookies must be set on the final response.
                // We'll handle this by wrapping the handler response.
            }

            if (config.fetchUserOnProtect) {
                try {
                    user = await client.getUserInfo(tokenStr);
                } catch (fetchErr) {
                    console.warn(
                        "forta-js: fetchUserOnProtect: getUserInfo:",
                        fetchErr
                    );
                }
            }
        } else {
            // ── Remote validation via /auth/self ───────────────────────────────
            try {
                user = await client.getUserInfo(tokenStr);
                userId = user.id;
            } catch {
                if (config.disableAutoRefresh) {
                    return jsonError(NR, 401, "invalid or expired access token");
                }
                const refreshResult = await tryRefreshNext(client, request);
                if (!refreshResult) {
                    return jsonError(NR, 401, "session expired, please log in again");
                }
                userId = refreshResult.userId;
                if (refreshResult.accessToken) {
                    try {
                        const nu = await client.getUserInfo(refreshResult.accessToken);
                        user = nu;
                        userId = nu.id;
                    } catch {
                        // Continue with userId from refresh.
                    }
                }
            }
        }

        // Call the user's handler with the identity context.
        const response = await handler(request, { fortaId: userId, user });

        // If a refresh happened, we need to set the new cookies on the response.
        // We do this by cloning the response headers and appending Set-Cookie.
        // For simplicity, we check if a refresh token was consumed and set cookies.
        const refreshToken = request.cookies.get(COOKIE_REFRESH_TOKEN)?.value;
        if (refreshToken && tokenStr !== extractTokenFromNextRequest(request)) {
            // Token was refreshed — we need to set cookies. Since NextResponse
            // from NR.json etc. supports cookies, wrap if needed.
            // However, the handler already returned a response. We need to copy
            // cookies onto it. This is a bit tricky with the Fetch API Response.
            // The cleanest approach: the handler returns NextResponse, which has .cookies
            if ("cookies" in response && typeof (response as NextResponseInstance).cookies?.set === "function") {
                const nRes = response as NextResponseInstance;
                // Re-fetch tokens for the refreshed pair — we stored them during tryRefreshNext
                if (_lastRefreshResult) {
                    setAuthCookiesOnResponse(nRes, config, _lastRefreshResult.tokens);
                    _lastRefreshResult = null;
                }
            }
        }

        return response;
    };
}

// ── Refresh helper for Next.js ──────────────────────────────────────────────

interface NextRefreshResult {
    userId: number;
    accessToken: string;
    tokens: TokenPair;
}

let _lastRefreshResult: NextRefreshResult | null = null;

async function tryRefreshNext(
    client: FortaClient,
    request: NextRequest
): Promise<NextRefreshResult | null> {
    const refreshCookie = request.cookies.get(COOKIE_REFRESH_TOKEN);
    if (!refreshCookie?.value) {
        return null;
    }

    try {
        const authResp = await client.refreshTokens(refreshCookie.value);
        const result: NextRefreshResult = {
            userId: authResp.user.id,
            accessToken: authResp.authorization.access_token,
            tokens: authResp.authorization,
        };
        _lastRefreshResult = result;
        return result;
    } catch (err) {
        console.warn("forta-js: auto-refresh failed:", err);
        return null;
    }
}

/**
 * fetchCurrentUser retrieves the full Forta user profile for the access token
 * present in the Next.js request. Calls /auth/self. Does not perform
 * auto-refresh or set cookies.
 */
export async function fetchCurrentUser(request: NextRequest): Promise<User> {
    const client = requireClient();
    const token = extractTokenFromNextRequest(request);
    if (!token) {
        throw new Error("forta-js: no access token found in request");
    }
    return client.getUserInfo(token);
}

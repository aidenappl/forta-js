import type { IncomingMessage, ServerResponse } from "http";
import { FortaClient } from "./client";
import type { FortaCallOptions } from "./client";
import type { FortaAuthFailure } from "./config";
import { setFortaId, setFortaUser } from "./context";
import {
    parseCookies,
    setAuthCookies,
    COOKIE_REFRESH_TOKEN,
} from "./cookies";
import { writeJsonError } from "./errors";
import {
    failureFromError,
    firstHeader,
    forwardedCallOptions,
    isUpstreamError,
    reportAuthFailure,
} from "./failure";
import { extractToken } from "./helpers";
import { validateAccessTokenLocal, isTokenExpiredError } from "./token";
import type { User } from "./types";

/** Express/Node.js-compatible request handler. */
export type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void
) => void | Promise<void>;

/**
 * createProtect builds the protect middleware wrapper for the given client.
 *
 * protect wraps a handler, requiring a valid Forta access token. The token is
 * read from (in order):
 *   1. Authorization: Bearer <token> header (valid 3-part JWT only)
 *   2. forta-access-token cookie
 *
 * Validation strategy:
 *   - If jwtSigningKey is set: tokens are validated locally via HMAC-SHA512.
 *   - Otherwise: tokens are validated remotely by calling /auth/self.
 *
 * Auto-refresh: if the access token is expired (and disableAutoRefresh is
 * false), the middleware attempts to refresh using the forta-refresh-token
 * cookie. On success, new cookies are written and the request proceeds.
 */
export function createProtect(client: FortaClient) {
    return function protect(next: RequestHandler): RequestHandler {
        return async function protectedHandler(
            req: IncomingMessage,
            res: ServerResponse,
            expressNext?: () => void
        ): Promise<void> {
            const config = client.config;
            // Correlation headers from the inbound request are forwarded on
            // every call this request makes to Forta.
            const callOpts = forwardedCallOptions((name) =>
                firstHeader(req.headers[name])
            );
            const requestId = callOpts.headers?.["x-request-id"];

            let tokenStr = extractToken(req);

            if (!tokenStr) {
                reportAuthFailure(config, {
                    reason: "missing_credential",
                    status: 401,
                    ...(requestId ? { requestId } : {}),
                });
                writeJsonError(res, 401, "missing or invalid authorization");
                return;
            }

            let userId: number = 0;
            let user: User | null = null;

            if (config.jwtSigningKey) {
                // ── Local JWT validation ────────────────────────────────────────
                try {
                    userId = validateAccessTokenLocal(tokenStr, config.jwtSigningKey);
                } catch (err) {
                    if (!isTokenExpiredError(err) || config.disableAutoRefresh) {
                        reportAuthFailure(config, {
                            reason: isTokenExpiredError(err)
                                ? "token_expired"
                                : "token_invalid",
                            status: 401,
                            error: err,
                            ...(requestId ? { requestId } : {}),
                        });
                        writeJsonError(res, 401, "invalid or expired access token");
                        return;
                    }

                    // Access token is expired — try to refresh transparently.
                    const refreshResult = await tryRefresh(client, req, res, callOpts);
                    if (!refreshResult.ok) {
                        reportAuthFailure(config, refreshResult.failure);
                        writeJsonError(
                            res,
                            401,
                            "session expired, please log in again"
                        );
                        return;
                    }
                    // Update tokenStr so fetchUserOnProtect below uses the new token.
                    tokenStr = refreshResult.accessToken;
                    userId = refreshResult.userId;
                }

                if (config.fetchUserOnProtect) {
                    try {
                        user = await client.getUserInfo(tokenStr, callOpts);
                    } catch (fetchErr) {
                        // Non-fatal: the user ID is valid, continue without full profile.
                        console.warn(
                            "forta-js: fetchUserOnProtect: getUserInfo:",
                            fetchErr
                        );
                        reportAuthFailure(
                            config,
                            failureFromError(fetchErr, "token_invalid", requestId)
                        );
                    }
                }
            } else {
                // ── Remote validation via /auth/self ─────────────────────────────
                try {
                    user = await client.getUserInfo(tokenStr, callOpts);
                    userId = user.id;
                } catch (selfErr) {
                    if (config.disableAutoRefresh) {
                        reportAuthFailure(
                            config,
                            failureFromError(selfErr, "token_invalid", requestId)
                        );
                        writeJsonError(res, 401, "invalid or expired access token");
                        return;
                    }

                    // Try to refresh using the refresh token cookie.
                    const refreshResult = await tryRefresh(client, req, res, callOpts);
                    if (!refreshResult.ok) {
                        // An outage on /auth/self is the real cause even though
                        // the response is still a 401.
                        reportAuthFailure(
                            config,
                            isUpstreamError(selfErr)
                                ? failureFromError(selfErr, "token_invalid", requestId)
                                : refreshResult.failure
                        );
                        writeJsonError(
                            res,
                            401,
                            "session expired, please log in again"
                        );
                        return;
                    }
                    if (isUpstreamError(selfErr)) {
                        // Refresh masked an /auth/self outage — still report it.
                        reportAuthFailure(
                            config,
                            failureFromError(selfErr, "token_invalid", requestId)
                        );
                    }
                    userId = refreshResult.userId;

                    // Fetch the updated profile with the new token.
                    if (refreshResult.accessToken) {
                        try {
                            const nu = await client.getUserInfo(
                                refreshResult.accessToken,
                                callOpts
                            );
                            user = nu;
                            userId = nu.id;
                        } catch (postErr) {
                            // Continue with userId from refresh.
                            reportAuthFailure(
                                config,
                                failureFromError(postErr, "token_invalid", requestId)
                            );
                        }
                    }
                }
            }

            // Attach identity to request.
            setFortaId(req, userId);
            if (user) {
                setFortaUser(req, user);
            }

            await next(req, res, expressNext);
        };
    };
}

type RefreshResult =
    | { ok: true; userId: number; accessToken: string }
    | { ok: false; failure: FortaAuthFailure };

/**
 * tryRefresh reads the forta-refresh-token cookie, calls /auth/refresh, and on
 * success sets the new auth cookies. On failure it returns the reason.
 */
async function tryRefresh(
    client: FortaClient,
    req: IncomingMessage,
    res: ServerResponse,
    callOpts: FortaCallOptions
): Promise<RefreshResult> {
    const requestId = callOpts.headers?.["x-request-id"];
    const cookies = parseCookies(req);
    const refreshToken = cookies[COOKIE_REFRESH_TOKEN];
    if (!refreshToken) {
        return {
            ok: false,
            failure: {
                reason: "token_expired",
                status: 401,
                ...(requestId ? { requestId } : {}),
            },
        };
    }

    try {
        const authResp = await client.refreshTokens(refreshToken, callOpts);
        setAuthCookies(res, client.config, authResp.authorization);
        return {
            ok: true,
            userId: authResp.user.id,
            accessToken: authResp.authorization.access_token,
        };
    } catch (err) {
        console.warn("forta-js: auto-refresh failed:", err);
        return {
            ok: false,
            failure: failureFromError(err, "refresh_failed", requestId),
        };
    }
}

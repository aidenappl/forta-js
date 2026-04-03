import type { IncomingMessage, ServerResponse } from "http";
import { FortaClient } from "./client";
import { setFortaId, setFortaUser } from "./context";
import {
  parseCookies,
  setAuthCookies,
  COOKIE_REFRESH_TOKEN,
} from "./cookies";
import { writeJsonError } from "./errors";
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
      let tokenStr = extractToken(req);

      if (!tokenStr) {
        writeJsonError(res, 401, "missing or invalid authorization");
        return;
      }

      let userId: number = 0;
      let user: User | null = null;
      const config = client.config;

      if (config.jwtSigningKey) {
        // ── Local JWT validation ────────────────────────────────────────
        try {
          userId = validateAccessTokenLocal(tokenStr, config.jwtSigningKey);
        } catch (err) {
          if (!isTokenExpiredError(err) || config.disableAutoRefresh) {
            writeJsonError(res, 401, "invalid or expired access token");
            return;
          }

          // Access token is expired — try to refresh transparently.
          const refreshResult = await tryRefresh(client, req, res);
          if (!refreshResult) {
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
            user = await client.getUserInfo(tokenStr);
          } catch (fetchErr) {
            // Non-fatal: the user ID is valid, continue without full profile.
            console.warn(
              "forta-js: fetchUserOnProtect: getUserInfo:",
              fetchErr
            );
          }
        }
      } else {
        // ── Remote validation via /auth/self ─────────────────────────────
        try {
          user = await client.getUserInfo(tokenStr);
          userId = user.id;
        } catch {
          if (config.disableAutoRefresh) {
            writeJsonError(res, 401, "invalid or expired access token");
            return;
          }

          // Try to refresh using the refresh token cookie.
          const refreshResult = await tryRefresh(client, req, res);
          if (!refreshResult) {
            writeJsonError(
              res,
              401,
              "session expired, please log in again"
            );
            return;
          }
          userId = refreshResult.userId;

          // Fetch the updated profile with the new token.
          if (refreshResult.accessToken) {
            try {
              const nu = await client.getUserInfo(
                refreshResult.accessToken
              );
              user = nu;
              userId = nu.id;
            } catch {
              // Continue with userId from refresh.
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

interface RefreshResult {
  userId: number;
  accessToken: string;
}

/**
 * tryRefresh reads the forta-refresh-token cookie, calls /auth/refresh, and on
 * success sets the new auth cookies. Returns null if refresh failed.
 */
async function tryRefresh(
  client: FortaClient,
  req: IncomingMessage,
  res: ServerResponse
): Promise<RefreshResult | null> {
  const cookies = parseCookies(req);
  const refreshToken = cookies[COOKIE_REFRESH_TOKEN];
  if (!refreshToken) {
    return null;
  }

  try {
    const authResp = await client.refreshTokens(refreshToken);
    setAuthCookies(res, client.config, authResp.authorization);
    return {
      userId: authResp.user.id,
      accessToken: authResp.authorization.access_token,
    };
  } catch (err) {
    console.warn("forta-js: auto-refresh failed:", err);
    return null;
  }
}

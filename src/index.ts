/**
 * forta-js — JavaScript/TypeScript client library for integrating Forta as an
 * authentication provider into any Node.js service.
 *
 * Quick start:
 *
 *   import forta from 'forta-js';
 *
 *   forta.setup({
 *     apiDomain:    process.env.FORTA_API_DOMAIN,
 *     loginDomain:  process.env.FORTA_LOGIN_DOMAIN,
 *     clientId:     process.env.FORTA_CLIENT_ID,
 *     clientSecret: process.env.FORTA_CLIENT_SECRET,
 *     callbackUrl:  'https://myapp.example.com/forta/callback',
 *   });
 *
 *   // Express
 *   app.get('/forta/login',    forta.loginHandler);
 *   app.get('/forta/callback', forta.callbackHandler);
 *   app.get('/forta/logout',   forta.logoutHandler);
 *   app.get('/api/resource',   forta.protect(handleResource));
 *
 * @module forta-js
 */

import type { IncomingMessage, ServerResponse } from "http";
import { FortaClient } from "./client";
import type { FortaConfig } from "./config";
import { getFortaIdFromRequest, getUserFromRequest } from "./context";
import { writeJsonError } from "./errors";
import {
    createLoginHandler,
    createCallbackHandler,
    createLogoutHandler,
} from "./handlers";
import { extractToken } from "./helpers";
import { createProtect } from "./middleware";
import type { RequestHandler } from "./middleware";

// ── Re-exports ──────────────────────────────────────────────────────────────

export type { FortaConfig } from "./config";
export type {
    User,
    UserPublic,
    UserMetadata,
    UserStatus,
    TokenPair,
    AuthResponse,
    ApiResponse,
    ApiSuccess,
    ApiError,
} from "./types";
export type { RequestHandler } from "./middleware";
export { getFortaIdFromRequest, getUserFromRequest } from "./context";
export { FortaClient } from "./client";

// ── Global client (mirrors Go's defaultClient) ─────────────────────────────

const ErrNotConfigured = new Error("forta-js: setup has not been called");

let defaultClient: FortaClient | null = null;

/**
 * setup initialises the global Forta client with the provided configuration.
 * It must be called once before any other function in this package.
 */
function setup(config: FortaConfig): void {
    defaultClient = new FortaClient(config);
}

function requireClient(): FortaClient {
    if (!defaultClient) {
        throw ErrNotConfigured;
    }
    return defaultClient;
}

/**
 * ping tests connectivity to the configured Forta API by calling its
 * /healthcheck endpoint.
 */
async function ping(): Promise<void> {
    return requireClient().ping();
}

/**
 * loginHandler redirects the browser to the Forta OAuth2 authorization
 * endpoint. A CSRF state token is stored in an HttpOnly cookie.
 */
function loginHandler(req: IncomingMessage, res: ServerResponse): void {
    if (!defaultClient) {
        writeJsonError(res, 500, "forta: not configured");
        return;
    }
    createLoginHandler(defaultClient)(req, res);
}

/**
 * callbackHandler handles the OAuth2 redirect callback from Forta.
 * Validates CSRF state, exchanges the code, sets token cookies, and redirects.
 */
async function callbackHandler(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    if (!defaultClient) {
        writeJsonError(res, 500, "forta: not configured");
        return;
    }
    return createCallbackHandler(defaultClient)(req, res);
}

/**
 * logoutHandler clears all Forta auth cookies and redirects to the
 * configured post-logout redirect.
 */
function logoutHandler(req: IncomingMessage, res: ServerResponse): void {
    if (!defaultClient) {
        writeJsonError(res, 500, "forta: not configured");
        return;
    }
    createLogoutHandler(defaultClient)(req, res);
}

/**
 * protect wraps the given handler, requiring a valid Forta access token
 * provided either as an Authorization: Bearer header or via the
 * forta-access-token cookie.
 *
 * On success the Forta user ID is attached to the request; retrieve it with
 * getFortaIdFromRequest(req).
 */
function protect(next: RequestHandler): RequestHandler {
    if (!defaultClient) {
        return (_req: IncomingMessage, res: ServerResponse) => {
            writeJsonError(res, 500, "forta: not configured");
        };
    }
    return createProtect(defaultClient)(next);
}

/**
 * fetchCurrentUser retrieves the full Forta user profile for the access token
 * present in the request. Calls /auth/self and is safe to call from any handler
 * (not just protected ones). Does not perform auto-refresh or set cookies.
 */
async function fetchCurrentUser(req: IncomingMessage) {
    const client = requireClient();
    const token = extractToken(req);
    if (!token) {
        throw new Error("forta-js: no access token found in request");
    }
    return client.getUserInfo(token);
}

// ── Default export ──────────────────────────────────────────────────────────

const forta = {
    setup,
    ping,
    loginHandler,
    callbackHandler,
    logoutHandler,
    protect,
    fetchCurrentUser,
    getFortaIdFromRequest,
    getUserFromRequest,
};

export default forta;
export {
    setup,
    ping,
    loginHandler,
    callbackHandler,
    logoutHandler,
    protect,
    fetchCurrentUser,
};

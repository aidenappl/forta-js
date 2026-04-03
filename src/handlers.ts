import type { IncomingMessage, ServerResponse } from "http";
import { FortaClient } from "./client";
import { getPostLoginRedirect, getPostLogoutRedirect } from "./config";
import {
  setAuthCookies,
  clearAuthCookies,
  setStateCookie,
  clearStateCookie,
  parseCookies,
  COOKIE_OAUTH_STATE,
} from "./cookies";
import { writeJsonError } from "./errors";
import { generateState } from "./helpers";

/**
 * createLoginHandler builds the LoginHandler for the given client.
 *
 * LoginHandler redirects the browser to the Forta OAuth2 authorization
 * endpoint. A cryptographically random state value is stored in a short-lived
 * HttpOnly cookie to guard against CSRF during the callback.
 */
export function createLoginHandler(client: FortaClient) {
  return function loginHandler(
    req: IncomingMessage,
    res: ServerResponse
  ): void {
    const config = client.config;

    // First-party appleby.cloud services share the Forta session cookie and do
    // not need the full OAuth2 code-exchange flow.
    if (config.cookieDomain === ".appleby.cloud") {
      let redirectBack = getPostLoginRedirect(config);
      if (!redirectBack.startsWith("http")) {
        let origin: string;
        if (config.appDomain) {
          origin = config.appDomain.replace(/\/+$/, "");
        } else {
          const forwarded = req.headers["x-forwarded-proto"];
          const scheme = forwarded === "https" ? "https" : "http";
          origin = `${scheme}://${req.headers.host}`;
        }
        redirectBack = origin + redirectBack;
      }
      const loginURL = `${config.loginDomain}/?redirect_uri=${encodeURIComponent(redirectBack)}`;
      res.writeHead(302, { Location: loginURL });
      res.end();
      return;
    }

    const state = generateState();
    setStateCookie(res, config, state);

    const loginURL =
      `${config.loginDomain}/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(config.clientId)}` +
      `&redirect_uri=${encodeURIComponent(config.callbackUrl || "")}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=openid`;

    res.writeHead(302, { Location: loginURL });
    res.end();
  };
}

/**
 * createCallbackHandler builds the CallbackHandler for the given client.
 *
 * CallbackHandler handles the OAuth2 redirect from Forta. It:
 *  1. Validates the CSRF state cookie against the state query parameter.
 *  2. Exchanges the authorization code for a token pair via POST /auth/exchange.
 *  3. Sets HttpOnly forta-access-token and forta-refresh-token cookies.
 *  4. Redirects to config.postLoginRedirect (default "/").
 */
export function createCallbackHandler(client: FortaClient) {
  return async function callbackHandler(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const config = client.config;
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const params = url.searchParams;

    // Check for an error from the authorization server.
    const errParam = params.get("error");
    if (errParam) {
      const errDesc = params.get("error_description") || "";
      writeJsonError(
        res,
        400,
        `authorization error: ${errParam}: ${errDesc}`
      );
      return;
    }

    const code = params.get("code");
    const state = params.get("state");

    if (!code) {
      writeJsonError(res, 400, "missing code parameter");
      return;
    }

    // Validate CSRF state.
    const cookies = parseCookies(req);
    const stateCookie = cookies[COOKIE_OAUTH_STATE];
    if (!stateCookie) {
      writeJsonError(
        res,
        400,
        "missing state cookie — possible CSRF or expired session"
      );
      return;
    }
    if (stateCookie !== state) {
      writeJsonError(res, 400, "state mismatch — possible CSRF attack");
      return;
    }
    clearStateCookie(res, config);

    // Exchange code for token pair.
    let authResp;
    try {
      authResp = await client.exchangeCode(code);
    } catch {
      writeJsonError(res, 401, "failed to exchange authorization code");
      return;
    }

    setAuthCookies(res, config, authResp.authorization);

    let redirect = getPostLoginRedirect(config);
    if (config.appDomain && !redirect.startsWith("http")) {
      redirect = config.appDomain.replace(/\/+$/, "") + redirect;
    }

    res.writeHead(302, { Location: redirect });
    res.end();
  };
}

/**
 * createLogoutHandler builds the LogoutHandler for the given client.
 *
 * LogoutHandler clears all Forta auth cookies and redirects to
 * config.postLogoutRedirect (default "/").
 */
export function createLogoutHandler(client: FortaClient) {
  return function logoutHandler(
    _req: IncomingMessage,
    res: ServerResponse
  ): void {
    const config = client.config;
    clearAuthCookies(res, config);

    let redirect = getPostLogoutRedirect(config);
    if (config.appDomain && !redirect.startsWith("http")) {
      redirect = config.appDomain.replace(/\/+$/, "") + redirect;
    }

    res.writeHead(302, { Location: redirect });
    res.end();
  };
}

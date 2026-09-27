/**
 * FortaConfig holds all the settings needed to use Forta as an authentication
 * provider. Pass it to setup() once at application startup.
 */
export interface FortaConfig {
    /**
     * Base URL of the Forta API server — used for token exchange, validation,
     * and user info lookups.
     * Required. Example: "https://api.forta.appleby.cloud"
     */
    apiDomain: string;

    /**
     * Base URL of the Forta login UI — used to build the OAuth2 authorization
     * redirect in loginHandler.
     * Required. Example: "https://forta.appleby.cloud"
     */
    loginDomain: string;

    /**
     * OAuth2 client ID registered with Forta for this platform.
     * Required.
     */
    clientId: string;

    /**
     * OAuth2 client secret for this platform.
     * Required.
     */
    clientSecret: string;

    /**
     * Full URL Forta will redirect to after a successful login via the OAuth2
     * authorization code flow. Must match the registered redirect URI.
     * Required for external (non-first-party) services that use the code flow.
     */
    callbackUrl?: string;

    /**
     * Where to redirect the browser after the callbackHandler completes
     * successfully. Defaults to "/".
     */
    postLoginRedirect?: string;

    /**
     * Where to redirect the browser after logoutHandler completes.
     * Defaults to "/".
     */
    postLogoutRedirect?: string;

    /**
     * Base URL of the application using forta-js (e.g. "https://myapp.appleby.cloud").
     * When set, it is used as the origin for all redirect URIs constructed by the
     * library, preventing open-redirect attacks via manipulated Host headers.
     * Recommended in production.
     */
    appDomain?: string;

    /**
     * Domain attribute for auth cookies. Use ".appleby.cloud" on first-party
     * services to share the session across subdomains. Leave empty for
     * site-scoped cookies (default behaviour).
     */
    cookieDomain?: string;

    /**
     * Set to true only for local HTTP development. Disables the Secure flag
     * on cookies. Default: false.
     */
    cookieInsecure?: boolean;

    /**
     * HMAC-SHA512 key shared with forta-api. When set, tokens are validated
     * in-process with no network call. When empty (default), each protect()
     * request calls /auth/self.
     */
    jwtSigningKey?: string;

    /**
     * When jwtSigningKey is set, also call /auth/self to populate the full
     * User in context (at the cost of a network call per request).
     * Default: false.
     */
    fetchUserOnProtect?: boolean;

    /**
     * Prevents automatic transparent token refresh on expiry.
     * Default: false (refresh enabled).
     */
    disableAutoRefresh?: boolean;

    /**
     * fetch implementation used for every call to the Forta API. Defaults to
     * the global fetch. Useful for instrumentation or tests.
     */
    fetch?: typeof fetch;

    /**
     * Extra headers sent on every call to the Forta API (for example a
     * service-level trace header). Per-call headers — including the inbound
     * X-Request-ID / traceparent / X-Trace-ID forwarded by protect() — take
     * precedence, and Authorization / Content-Type can never be overridden.
     */
    getHeaders?: () => Record<string, string>;

    /**
     * Called whenever authentication fails or an upstream error is swallowed
     * (for example /auth/self being unreachable before a transparent refresh).
     * Never changes the response protect() or the handlers send. Exceptions
     * thrown by the hook are ignored.
     */
    onAuthFailure?: (info: FortaAuthFailure) => void;
}

/**
 * Why authentication failed. Mirrors the reason strings used by go-forta.
 *
 * - missing_credential   — no access token on the request
 * - token_invalid        — token malformed, badly signed, or rejected by Forta
 * - token_expired        — token expired and no refresh was possible
 * - refresh_failed       — the refresh token was rejected
 * - upstream_unavailable — Forta was unreachable, timed out or returned 5xx
 * - grant_denied         — Forta returned 403 (grant revoked / not granted)
 * - exchange_failed      — the OAuth2 code exchange failed
 */
export type FortaAuthFailureReason =
    | "missing_credential"
    | "token_invalid"
    | "token_expired"
    | "refresh_failed"
    | "upstream_unavailable"
    | "grant_denied"
    | "exchange_failed";

/** Payload passed to FortaConfig.onAuthFailure. */
export interface FortaAuthFailure {
    reason: FortaAuthFailureReason;
    /** HTTP status Forta returned (absent for network errors and local checks). */
    status?: number;
    /** The underlying error, when there is one. */
    error?: unknown;
    /** The inbound request's X-Request-ID (forwarded to Forta), when present. */
    requestId?: string;
    /** The X-Request-ID Forta echoed on its response, when available. */
    upstreamRequestId?: string;
}

/** Validates that required config fields are present. Throws on invalid config. */
export function validateConfig(config: FortaConfig): void {
    if (!config.apiDomain) {
        throw new Error("forta-js: config.apiDomain is required");
    }
    if (!config.loginDomain) {
        throw new Error("forta-js: config.loginDomain is required");
    }
    if (!config.clientId) {
        throw new Error("forta-js: config.clientId is required");
    }
    if (!config.clientSecret) {
        throw new Error("forta-js: config.clientSecret is required");
    }
}

/** Validates that a redirect is a relative path or matches appDomain. */
function validateRedirect(redirect: string, appDomain?: string): string {
    if (redirect.startsWith('/')) return redirect;
    if (appDomain) {
        try {
            const parsed = new URL(redirect);
            const app = new URL(appDomain);
            if (parsed.host === app.host) return redirect;
        } catch {
            // Invalid URL — fall through to safe default
        }
    }
    return '/';
}

/** Returns the configured post-login redirect with a safe default. */
export function getPostLoginRedirect(config: FortaConfig): string {
    const raw = config.postLoginRedirect || "/";
    return validateRedirect(raw, config.appDomain);
}

/** Returns the configured post-logout redirect with a safe default. */
export function getPostLogoutRedirect(config: FortaConfig): string {
    const raw = config.postLogoutRedirect || "/";
    return validateRedirect(raw, config.appDomain);
}

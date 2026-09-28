"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { User } from "../types";
import {
  createFortaApiClientCore,
  type FortaApiClient,
  type FortaApiClientConfig,
  type FortaFetchMeta,
  type FortaRequestFailure,
  type RequestConfig,
} from "./api-client";

// ── Public types ────────────────────────────────────────────────────────────

/** Configuration for the FortaProvider. */
export interface FortaProviderConfig {
  /** Base URL for API calls (e.g. "https://api.myapp.com"). */
  apiUrl: string;

  /**
   * Endpoint to GET for the auth check on mount. Default: "/auth/self".
   * Should return a Forta envelope with User data on success.
   */
  selfEndpoint?: string;

  /**
   * Endpoint to POST for token refresh on 401. Default: "/auth/refresh".
   * Set to null to disable auto-refresh in the API client.
   */
  refreshEndpoint?: string | null;

  /** URL to redirect to for login. Used by the login() helper. */
  loginUrl?: string;

  /** URL to redirect to for logout. Used by the logout() helper. */
  logoutUrl?: string;

  /**
   * When true and loginUrl is set, automatically redirect to the login URL
   * when the initial auth check fails. Default: false.
   *
   * When false (default), the provider simply sets isLoggedIn=false and
   * isLoading=false — the consuming app decides what to do.
   */
  redirectOnUnauthenticated?: boolean;

  /**
   * Name of a cookie to check before making the /self API call. If the cookie
   * is absent, the provider skips the network call and immediately sets
   * isLoggedIn=false. Useful for first-party services that set a "logged_in"
   * cookie on the shared domain.
   */
  checkCookie?: string;

  /**
   * Called after the auth check completes (whether successful or not).
   * Receives the User on success, or null on failure.
   */
  onAuthStateChange?: (user: User | null) => void;

  /**
   * Path to redirect to when a 403 response with error_code 4003 (grant
   * revoked) is received. Also used to skip the auth check when the user
   * is already on this path. Default: "/unauthorized".
   * Set to null to disable automatic handling.
   */
  unauthorizedPath?: string | null;

  /**
   * Called once per outgoing request made through the provider's API client
   * (including the /self check and refresh). A returned id is sent in
   * `requestIdHeader`. The API's CORS AllowedHeaders must include that
   * header. May be an inline function — it is read through a ref, so changing
   * it never rebuilds the client.
   */
  requestId?: () => string | undefined;

  /** Header the value from requestId() is sent in. Default: "X-Request-ID". */
  requestIdHeader?: string;

  /** Extra headers for each request (e.g. `traceparent`). Read through a ref. */
  getHeaders?: (req: RequestConfig) => Record<string, string>;

  /** fetch implementation to use. Defaults to the global fetch. Read through a ref. */
  fetch?: typeof fetch;

  /**
   * Called when a request fails (see FortaRequestFailure). The initial auth
   * check additionally reports kind "session_check_failed" when it fails for
   * a reason other than the user being logged out. Read through a ref.
   */
  onRequestFailure?: (failure: FortaRequestFailure) => void;
}

/** The auth state and helpers exposed by the Forta context. */
export interface FortaAuthContext {
  /** Whether the user is authenticated. */
  isLoggedIn: boolean;

  /** Whether the initial auth check is still in progress. */
  isLoading: boolean;

  /** The authenticated user's profile, or null if not logged in. */
  user: User | null;

  /** Redirect to the configured login URL. Saves the current path to sessionStorage. */
  login: () => void;

  /** Redirect to the configured logout URL. */
  logout: () => void;

  /** Re-run the auth check (e.g. after a manual login flow). */
  refresh: () => Promise<void>;

  /** The configured Forta API client for making authenticated requests. */
  apiClient: FortaApiClient;
}

// ── Failure helpers ─────────────────────────────────────────────────────────

/**
 * A failed /self check means "logged out" only when the API answered with a
 * normal auth error. Network errors, timeouts, 5xx, unparseable bodies and an
 * unreachable refresh endpoint mean the session state is unknown.
 */
function isSessionCheckFailure(
  status: number,
  errorCode: number,
  meta: FortaFetchMeta,
): boolean {
  if (errorCode === 4003) return false;
  if (status >= 500) return true;
  return meta.failures.some(
    (f) =>
      f.kind === "network" ||
      f.kind === "timeout" ||
      f.kind === "http" ||
      f.kind === "parse" ||
      (f.kind === "refresh_failed" && (f.status === undefined || f.status >= 500)),
  );
}

function reportFailure(cfg: FortaProviderConfig, failure: FortaRequestFailure) {
  if (!cfg.onRequestFailure) return;
  try {
    cfg.onRequestFailure(failure);
  } catch {
    // Hooks must never affect the auth check.
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

export const FortaContext = createContext<FortaAuthContext | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export interface FortaProviderProps {
  config: FortaProviderConfig;
  children: ReactNode;

  /**
   * Rendered instead of children while the initial auth check is in progress.
   * When omitted, children render immediately (they can check isLoading via
   * the useAuthStatus hook).
   */
  loadingFallback?: ReactNode;
}

export function FortaProvider({ config, children, loadingFallback }: FortaProviderProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  // Stable reference to config to avoid re-running effects on every render.
  const configRef = useRef(config);
  configRef.current = config;

  // Callbacks are forwarded through configRef so inline functions never
  // rebuild the client (which would also reset the refresh dedupe).
  const clientCore = useMemo(() => {
    const clientConfig: FortaApiClientConfig = {
      apiUrl: config.apiUrl,
      refreshEndpoint: config.refreshEndpoint,
      unauthorizedPath: config.unauthorizedPath,
      requestIdHeader: config.requestIdHeader,
      requestId: () => configRef.current.requestId?.(),
      getHeaders: (req) => configRef.current.getHeaders?.(req) ?? {},
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const custom = configRef.current.fetch;
        return custom ? custom(input, init) : fetch(input, init);
      }) as typeof fetch,
      onRequestFailure: (failure) => configRef.current.onRequestFailure?.(failure),
    };
    return createFortaApiClientCore(clientConfig);
  }, [config.apiUrl, config.refreshEndpoint, config.unauthorizedPath, config.requestIdHeader]);

  const apiClient = useMemo<FortaApiClient>(
    () => ({ fetch: clientCore.fetch }),
    [clientCore],
  );

  const checkAuth = useCallback(async () => {
    const cfg = configRef.current;
    const unauthPath = cfg.unauthorizedPath !== null
      ? (cfg.unauthorizedPath ?? "/unauthorized")
      : null;

    // Skip auth check when already on the unauthorized page to prevent
    // redirect loops (the user is authenticated but not authorized).
    if (
      unauthPath &&
      typeof window !== "undefined" &&
      window.location.pathname === unauthPath
    ) {
      setIsLoggedIn(false);
      setUser(null);
      setIsLoading(false);
      cfg.onAuthStateChange?.(null);
      return;
    }

    try {
      // If a checkCookie is configured, skip the API call when it's absent.
      if (cfg.checkCookie && typeof document !== "undefined") {
        const hasCookie = document.cookie
          .split(";")
          .some((c) => c.trim().startsWith(`${cfg.checkCookie}=`));
        if (!hasCookie) {
          setIsLoggedIn(false);
          setUser(null);
          setIsLoading(false);
          cfg.onAuthStateChange?.(null);
          return;
        }
      }

      const selfEndpoint = cfg.selfEndpoint ?? "/auth/self";
      const { response: res, meta } = await clientCore.fetchWithMeta<User>({
        method: "GET",
        url: selfEndpoint,
      });

      if (!res.success && isSessionCheckFailure(res.status, res.error_code, meta)) {
        const last = meta.failures[meta.failures.length - 1];
        reportFailure(cfg, {
          kind: "session_check_failed",
          method: "GET",
          url: selfEndpoint,
          status: meta.status,
          requestId: meta.requestId,
          responseRequestId: meta.responseRequestId,
          error: last?.error ?? res.error_message,
        });
      }

      if (res.success) {
        setIsLoggedIn(true);
        setUser(res.data);
        setIsLoading(false);
        cfg.onAuthStateChange?.(res.data);
      } else if (res.error_code === 4003) {
        // Grant revoked — the API client already redirects to the
        // unauthorized page. Keep isLoading true so the loading fallback
        // stays visible during the redirect (no flash of protected content).
        cfg.onAuthStateChange?.(null);
      } else if (
        cfg.redirectOnUnauthenticated &&
        cfg.loginUrl &&
        typeof window !== "undefined"
      ) {
        // Not authenticated — redirect to login. Keep isLoading true so
        // the loading fallback stays visible during the redirect.
        sessionStorage.setItem("returnUrl", window.location.pathname);
        window.location.href = cfg.loginUrl;
        cfg.onAuthStateChange?.(null);
      } else {
        // Not authenticated, no redirect configured — let the app decide.
        setIsLoggedIn(false);
        setUser(null);
        setIsLoading(false);
        cfg.onAuthStateChange?.(null);
      }
    } catch (err) {
      console.warn("forta-js: checkAuth failed:", err);
      reportFailure(cfg, {
        kind: "session_check_failed",
        method: "GET",
        url: cfg.selfEndpoint ?? "/auth/self",
        error: err,
      });

      if (
        cfg.redirectOnUnauthenticated &&
        cfg.loginUrl &&
        typeof window !== "undefined"
      ) {
        window.location.href = cfg.loginUrl;
        cfg.onAuthStateChange?.(null);
      } else {
        setIsLoggedIn(false);
        setUser(null);
        setIsLoading(false);
        cfg.onAuthStateChange?.(null);
      }
    }
  }, [clientCore]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(() => {
    const cfg = configRef.current;
    if (cfg.loginUrl && typeof window !== "undefined") {
      sessionStorage.setItem("returnUrl", window.location.pathname);
      window.location.href = cfg.loginUrl;
    }
  }, []);

  const logout = useCallback(() => {
    const cfg = configRef.current;
    if (cfg.logoutUrl && typeof window !== "undefined") {
      window.location.href = cfg.logoutUrl;
    }
  }, []);

  const value = useMemo<FortaAuthContext>(
    () => ({
      isLoggedIn,
      isLoading,
      user,
      login,
      logout,
      refresh: checkAuth,
      apiClient,
    }),
    [isLoggedIn, isLoading, user, login, logout, checkAuth, apiClient],
  );

  const showLoading = isLoading && loadingFallback != null;

  return (
    <FortaContext.Provider value={value}>
      {showLoading ? loadingFallback : children}
    </FortaContext.Provider>
  );
}

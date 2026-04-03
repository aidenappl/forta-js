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
  createFortaApiClient,
  type FortaApiClient,
  type FortaApiClientConfig,
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

// ── Context ─────────────────────────────────────────────────────────────────

export const FortaContext = createContext<FortaAuthContext | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export interface FortaProviderProps {
  config: FortaProviderConfig;
  children: ReactNode;
}

export function FortaProvider({ config, children }: FortaProviderProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  // Stable reference to config to avoid re-running effects on every render.
  const configRef = useRef(config);
  configRef.current = config;

  const apiClient = useMemo<FortaApiClient>(() => {
    const clientConfig: FortaApiClientConfig = {
      apiUrl: config.apiUrl,
      refreshEndpoint: config.refreshEndpoint,
    };
    return createFortaApiClient(clientConfig);
  }, [config.apiUrl, config.refreshEndpoint]);

  const checkAuth = useCallback(async () => {
    const cfg = configRef.current;

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
    const res = await apiClient.fetch<User>({
      method: "GET",
      url: selfEndpoint,
    });

    if (res.success) {
      setIsLoggedIn(true);
      setUser(res.data);
      setIsLoading(false);
      cfg.onAuthStateChange?.(res.data);
    } else {
      setIsLoggedIn(false);
      setUser(null);
      setIsLoading(false);
      cfg.onAuthStateChange?.(null);

      if (
        cfg.redirectOnUnauthenticated &&
        cfg.loginUrl &&
        typeof window !== "undefined"
      ) {
        sessionStorage.setItem("returnUrl", window.location.pathname);
        window.location.href = cfg.loginUrl;
      }
    }
  }, [apiClient]);

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

  return (
    <FortaContext.Provider value={value}>{children}</FortaContext.Provider>
  );
}

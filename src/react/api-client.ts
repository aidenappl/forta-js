import type { ApiResponse, ApiError } from "../types";

/**
 * Configuration for the browser-side Forta API client.
 */
export interface FortaApiClientConfig {
    /** Base URL for API calls (e.g. "https://api.myapp.com"). */
    apiUrl: string;

    /**
     * Endpoint to POST for token refresh on 401. Default: "/auth/refresh".
     * Set to null to disable auto-refresh.
     */
    refreshEndpoint?: string | null;

    /** Request timeout in milliseconds. Default: 10000. */
    timeout?: number;
}

/** Configuration for a single API request. */
export interface RequestConfig {
    method: string;
    /** Path relative to apiUrl (e.g. "/auth/self"). */
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
}

/**
 * Creates a browser-side API client that:
 * - Sends cookies automatically (credentials: 'include')
 * - Parses the Forta API envelope ({ success, data, message, error, ... })
 * - Auto-retries on 401 via POST {refreshEndpoint} (unless disabled)
 *
 * This replaces the axios-based fetchApi pattern used in openbucket-web and
 * forta-web with a zero-dependency fetch-based implementation.
 */
export function createFortaApiClient(config: FortaApiClientConfig) {
    const apiUrl = config.apiUrl.replace(/\/+$/, "");
    const refreshEndpoint = config.refreshEndpoint !== null
        ? (config.refreshEndpoint ?? "/auth/refresh")
        : null;
    const timeout = config.timeout ?? 10_000;

    async function fortaFetch<T>(
        requestConfig: RequestConfig
    ): Promise<ApiResponse<T>> {
        try {
            const response = await executeRequest<T>(requestConfig, null);

            if (!response.success && response.status === 401 && refreshEndpoint) {
                const refreshed = await handle401<T>(requestConfig);
                if (refreshed) return refreshed;
            }

            return response;
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Request failed unexpectedly";
            return {
                success: false,
                status: 500,
                error: "request_failed",
                error_message: message,
                error_code: -1,
            };
        }
    }

    let refreshPromise: Promise<boolean> | null = null;

    async function doRefresh(): Promise<boolean> {
        try {
            const refreshRes = await fetch(`${apiUrl}${refreshEndpoint}`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(timeout),
            });

            if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (refreshData.success) {
                    return true;
                }
            }
        } catch {
            // Refresh failed
        }
        return false;
    }

    async function handle401<T>(
        originalConfig: RequestConfig
    ): Promise<ApiResponse<T> | null> {
        if (!refreshPromise) {
            refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
        }
        const ok = await refreshPromise;
        if (ok) {
            return await executeRequest<T>(originalConfig, null);
        }
        return null;
    }

    async function executeRequest<T>(
        requestConfig: RequestConfig,
        token: string | null
    ): Promise<ApiResponse<T>> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...requestConfig.headers,
        };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${apiUrl}${requestConfig.url}`, {
            method: requestConfig.method,
            credentials: "include",
            headers,
            body: requestConfig.body ? JSON.stringify(requestConfig.body) : undefined,
            signal: AbortSignal.timeout(timeout),
        });

        let data: Record<string, unknown>;
        try {
            data = await res.json();
        } catch {
            return {
                success: false,
                status: res.status,
                error: "parse_error",
                error_message: "Failed to parse response body",
                error_code: -1,
            };
        }

        if (data.success) {
            return {
                success: true,
                status: res.status,
                message: (data.message as string) ?? "",
                data: data.data as T,
            };
        }

        return {
            success: false,
            status: res.status,
            error: (data.error as string) ?? "unknown_error",
            error_message: (data.error_message as string) ?? "An unexpected error occurred",
            error_code: (data.error_code as number) ?? 0,
        };
    }

    return { fetch: fortaFetch };
}

export type FortaApiClient = ReturnType<typeof createFortaApiClient>;

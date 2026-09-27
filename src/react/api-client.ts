import type { ApiResponse } from "../types";

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

    /**
     * Path to redirect to when a 403 response with error_code 4003 (grant
     * revoked) is received. Default: "/unauthorized".
     * Set to null to disable automatic redirect.
     */
    unauthorizedPath?: string | null;

    /**
     * Called once per outgoing request (including the refresh call and the
     * retry after a refresh). A returned id is sent in `requestIdHeader`;
     * returning undefined sends no header. Default: no header.
     *
     * The API must list the header in its CORS AllowedHeaders, otherwise the
     * browser's preflight fails and every request errors.
     */
    requestId?: () => string | undefined;

    /** Header the value from requestId() is sent in. Default: "X-Request-ID". */
    requestIdHeader?: string;

    /**
     * Extra headers for each request (e.g. `traceparent`). Headers passed on
     * the individual RequestConfig take precedence. The same CORS caveat as
     * requestId applies.
     */
    getHeaders?: (req: RequestConfig) => Record<string, string>;

    /** fetch implementation to use. Defaults to the global fetch. */
    fetch?: typeof fetch;

    /**
     * Called when a request fails. Purely observational: return values,
     * redirects and refresh behaviour are unchanged. Exceptions thrown by the
     * hook are ignored.
     */
    onRequestFailure?: (failure: FortaRequestFailure) => void;
}

/**
 * Why a request failed.
 *
 * - network              — fetch rejected (offline, DNS, CORS, connection reset)
 * - timeout              — the request exceeded `timeout`
 * - http                 — the API answered with a 5xx status
 * - parse                — the response body was not JSON
 * - refresh_failed       — POST {refreshEndpoint} did not succeed (status 401
 *                          there simply means the session is over)
 * - grant_revoked        — 403 with error_code 4003 (reported before redirecting)
 * - session_check_failed — FortaProvider's initial /self check failed for a
 *                          reason other than being logged out (network, timeout,
 *                          5xx, unparseable body, or refresh unreachable). A
 *                          normal 401 is never reported with this kind.
 */
export type FortaRequestFailureKind =
    | "network"
    | "timeout"
    | "http"
    | "parse"
    | "refresh_failed"
    | "grant_revoked"
    | "session_check_failed";

/** Payload passed to onRequestFailure. */
export interface FortaRequestFailure {
    kind: FortaRequestFailureKind;
    /** HTTP method of the failed request. */
    method: string;
    /** Path of the failed request, as passed (relative to apiUrl). */
    url: string;
    /** HTTP status, when a response was received. */
    status?: number;
    /** The request id this client sent, if any. */
    requestId?: string;
    /** The X-Request-ID the server echoed on its response, if readable. */
    responseRequestId?: string;
    /** The underlying error, or the API's error_message for http failures. */
    error?: unknown;
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
 * Details about the last attempt of a request, collected alongside the usual
 * ApiResponse. Internal — used by FortaProvider.
 * @internal
 */
export interface FortaFetchMeta {
    requestId?: string;
    responseRequestId?: string;
    /** Status of the last response received, if any. */
    status?: number;
    /** Every failure observed while serving the request (including a shared refresh). */
    failures: FortaRequestFailure[];
}

interface RefreshOutcome {
    ok: boolean;
    failure?: FortaRequestFailure;
}

function isTimeoutError(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "TimeoutError"
    );
}

/**
 * Builds the client along with fetchWithMeta. Internal — FortaProvider uses it
 * to tell a failed session check apart from a logged-out user.
 * @internal
 */
export function createFortaApiClientCore(config: FortaApiClientConfig) {
    const apiUrl = config.apiUrl.replace(/\/+$/, "");
    const refreshEndpoint = config.refreshEndpoint !== null
        ? (config.refreshEndpoint ?? "/auth/refresh")
        : null;
    const timeout = config.timeout ?? 10_000;
    const unauthorizedPath = config.unauthorizedPath !== null
        ? (config.unauthorizedPath ?? "/unauthorized")
        : null;
    const requestIdHeader = config.requestIdHeader ?? "X-Request-ID";
    // Held in a local so a browser's native fetch is never invoked with the
    // config object as `this` (which throws "Illegal invocation").
    const customFetch = config.fetch;
    const fetchImpl = (input: string, init: RequestInit): Promise<Response> =>
        customFetch ? customFetch(input, init) : fetch(input, init);

    // Errors already passed to onRequestFailure, so the outer catch does not
    // report them twice.
    const reported = new WeakSet<object>();

    function report(failure: FortaRequestFailure, meta: FortaFetchMeta | null) {
        meta?.failures.push(failure);
        if (!config.onRequestFailure) return;
        try {
            config.onRequestFailure(failure);
        } catch {
            // Hooks must never affect requests.
        }
    }

    function nextRequestId(): string | undefined {
        if (!config.requestId) return undefined;
        try {
            return config.requestId() || undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Builds the outgoing headers: defaults, getHeaders(), the request id,
     * then the per-request headers (highest precedence). Returns the request
     * id actually sent.
     */
    function buildHeaders(
        requestConfig: RequestConfig,
        base: Record<string, string>
    ): { headers: Record<string, string>; requestId?: string } {
        let extra: Record<string, string> = {};
        if (config.getHeaders) {
            try {
                extra = config.getHeaders(requestConfig) ?? {};
            } catch {
                extra = {};
            }
        }
        // Per-request headers win over getHeaders() regardless of casing.
        const explicitKeys = new Set(
            Object.keys(requestConfig.headers ?? {}).map((k) => k.toLowerCase())
        );
        const headers: Record<string, string> = { ...base };
        for (const [key, value] of Object.entries(extra)) {
            if (!explicitKeys.has(key.toLowerCase())) {
                headers[key] = value;
            }
        }

        const lower = requestIdHeader.toLowerCase();
        const explicit = explicitKeys.has(lower)
            ? Object.keys(requestConfig.headers ?? {}).find(
                (k) => k.toLowerCase() === lower
            )
            : undefined;

        let requestId: string | undefined;
        if (explicit && requestConfig.headers) {
            requestId = requestConfig.headers[explicit];
        } else {
            requestId = nextRequestId();
            if (requestId) {
                headers[requestIdHeader] = requestId;
            }
        }
        Object.assign(headers, requestConfig.headers);
        return { headers, requestId };
    }

    async function fetchWithMeta<T>(
        requestConfig: RequestConfig
    ): Promise<{ response: ApiResponse<T>; meta: FortaFetchMeta }> {
        const meta: FortaFetchMeta = { failures: [] };
        try {
            const response = await executeRequest<T>(requestConfig, null, meta);

            if (
                !response.success &&
                response.status === 403 &&
                response.error_code === 4003
            ) {
                report(
                    {
                        kind: "grant_revoked",
                        method: requestConfig.method,
                        url: requestConfig.url,
                        status: response.status,
                        requestId: meta.requestId,
                        responseRequestId: meta.responseRequestId,
                        error: response.error_message,
                    },
                    meta
                );

                // Grant revoked — redirect to unauthorized page before any other handling.
                if (unauthorizedPath && typeof window !== "undefined") {
                    window.location.href = unauthorizedPath;
                    return { response, meta };
                }
            }

            if (!response.success && response.status === 401 && refreshEndpoint) {
                const refreshed = await handle401<T>(requestConfig, meta);
                if (refreshed) return { response: refreshed, meta };
            }

            return { response, meta };
        } catch (err: unknown) {
            if (!(typeof err === "object" && err !== null && reported.has(err))) {
                report(
                    {
                        kind: isTimeoutError(err) ? "timeout" : "network",
                        method: requestConfig.method,
                        url: requestConfig.url,
                        requestId: meta.requestId,
                        error: err,
                    },
                    meta
                );
            }
            const message =
                err instanceof Error ? err.message : "Request failed unexpectedly";
            return {
                response: {
                    success: false,
                    status: 500,
                    error: "request_failed",
                    error_message: message,
                    error_code: -1,
                },
                meta,
            };
        }
    }

    async function fortaFetch<T>(
        requestConfig: RequestConfig
    ): Promise<ApiResponse<T>> {
        return (await fetchWithMeta<T>(requestConfig)).response;
    }

    let refreshPromise: Promise<RefreshOutcome> | null = null;

    async function doRefresh(): Promise<RefreshOutcome> {
        const refreshConfig: RequestConfig = {
            method: "POST",
            url: refreshEndpoint ?? "",
        };
        const { headers, requestId } = buildHeaders(refreshConfig, {
            "Content-Type": "application/json",
        });
        const fail = (
            extra: Partial<FortaRequestFailure>
        ): RefreshOutcome => {
            const failure: FortaRequestFailure = {
                kind: "refresh_failed",
                method: refreshConfig.method,
                url: refreshConfig.url,
                requestId,
                ...extra,
            };
            // Reported once here; each waiting request records it in its meta.
            report(failure, null);
            return { ok: false, failure };
        };

        let refreshRes: Response;
        try {
            refreshRes = await fetchImpl(`${apiUrl}${refreshEndpoint}`, {
                method: "POST",
                credentials: "include",
                headers,
                signal: AbortSignal.timeout(timeout),
            });
        } catch (err) {
            // Refresh failed
            return fail({ error: err });
        }

        const responseRequestId =
            refreshRes.headers.get("x-request-id") ?? undefined;
        let refreshData: Record<string, unknown> | null = null;
        try {
            refreshData = await refreshRes.json();
        } catch (err) {
            if (refreshRes.ok) {
                return fail({
                    status: refreshRes.status,
                    responseRequestId,
                    error: err,
                });
            }
        }

        if (refreshRes.ok && refreshData?.success) {
            return { ok: true };
        }

        return fail({
            status: refreshRes.status,
            responseRequestId,
            error: refreshData?.error_message,
        });
    }

    async function handle401<T>(
        originalConfig: RequestConfig,
        meta: FortaFetchMeta
    ): Promise<ApiResponse<T> | null> {
        if (!refreshPromise) {
            refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
        }
        const outcome = await refreshPromise;
        if (outcome.failure) {
            meta.failures.push(outcome.failure);
        }
        if (outcome.ok) {
            return await executeRequest<T>(originalConfig, null, meta);
        }
        return null;
    }

    async function executeRequest<T>(
        requestConfig: RequestConfig,
        token: string | null,
        meta: FortaFetchMeta
    ): Promise<ApiResponse<T>> {
        const { headers, requestId } = buildHeaders(requestConfig, {
            "Content-Type": "application/json",
        });
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        meta.requestId = requestId;
        meta.responseRequestId = undefined;
        meta.status = undefined;

        let res: Response;
        try {
            res = await fetchImpl(`${apiUrl}${requestConfig.url}`, {
                method: requestConfig.method,
                credentials: "include",
                headers,
                body: requestConfig.body ? JSON.stringify(requestConfig.body) : undefined,
                signal: AbortSignal.timeout(timeout),
            });
        } catch (err) {
            report(
                {
                    kind: isTimeoutError(err) ? "timeout" : "network",
                    method: requestConfig.method,
                    url: requestConfig.url,
                    requestId,
                    error: err,
                },
                meta
            );
            if (typeof err === "object" && err !== null) {
                reported.add(err);
            }
            throw err;
        }

        const responseRequestId = res.headers.get("x-request-id") ?? undefined;
        meta.responseRequestId = responseRequestId;
        meta.status = res.status;

        let data: Record<string, unknown>;
        try {
            data = await res.json();
        } catch (err) {
            report(
                {
                    kind: isTimeoutError(err) ? "timeout" : "parse",
                    method: requestConfig.method,
                    url: requestConfig.url,
                    status: res.status,
                    requestId,
                    responseRequestId,
                    error: err,
                },
                meta
            );
            return {
                success: false,
                status: res.status,
                error: "parse_error",
                error_message: "Failed to parse response body",
                error_code: -1,
            };
        }

        if (res.status >= 500) {
            report(
                {
                    kind: "http",
                    method: requestConfig.method,
                    url: requestConfig.url,
                    status: res.status,
                    requestId,
                    responseRequestId,
                    error: data.error_message,
                },
                meta
            );
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

    return { fetch: fortaFetch, fetchWithMeta };
}

/**
 * Creates a browser-side API client that:
 * - Sends cookies automatically (credentials: 'include')
 * - Parses the Forta API envelope ({ success, data, message, error, ... })
 * - Auto-retries on 401 via POST {refreshEndpoint} (unless disabled)
 * - Optionally sends a request id / extra headers and reports failures
 *
 * This replaces the axios-based fetchApi pattern used in openbucket-web and
 * forta-web with a zero-dependency fetch-based implementation.
 */
export function createFortaApiClient(config: FortaApiClientConfig) {
    const core = createFortaApiClientCore(config);
    return { fetch: core.fetch };
}

export type FortaApiClient = ReturnType<typeof createFortaApiClient>;

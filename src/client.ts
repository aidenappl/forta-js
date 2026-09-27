import { FortaConfig, validateConfig } from "./config";
import type {
    AuthResponse,
    ExchangeCodeRequest,
    FortaEnvelope,
    User,
} from "./types";

/** Per-call options accepted by every FortaClient method. */
export interface FortaCallOptions {
    /**
     * Extra headers for this call (e.g. an inbound X-Request-ID or
     * traceparent). They override FortaConfig.getHeaders() but never
     * Authorization or Content-Type.
     */
    headers?: Record<string, string>;
}

/**
 * Errors thrown by FortaClient methods carry the HTTP status Forta returned
 * and the X-Request-ID it echoed, when available. Messages are unchanged.
 */
export interface FortaRequestError extends Error {
    status?: number;
    requestId?: string;
}

function fortaError(
    message: string,
    res: Response
): FortaRequestError {
    const err: FortaRequestError = new Error(message);
    err.status = res.status;
    const requestId = res.headers.get("x-request-id");
    if (requestId) {
        err.requestId = requestId;
    }
    return err;
}

/**
 * FortaClient is the configured Forta client. It handles all communication
 * with the Forta API server.
 */
export class FortaClient {
    readonly config: FortaConfig;

    constructor(config: FortaConfig) {
        validateConfig(config);
        // Strip trailing slashes so all URL construction is consistent.
        this.config = {
            ...config,
            apiDomain: config.apiDomain.replace(/\/+$/, ""),
            loginDomain: config.loginDomain.replace(/\/+$/, ""),
        };
    }

    /** Builds a full URL against the configured Forta API domain. */
    url(path: string): string {
        return this.config.apiDomain + path;
    }

    /**
     * send performs a request against Forta using the configured fetch, merging
     * config-level headers, per-call headers and the required headers (in that
     * order of precedence, lowest first).
     */
    private send(
        path: string,
        init: RequestInit & { headers?: Record<string, string> },
        opts?: FortaCallOptions
    ): Promise<Response> {
        let configHeaders: Record<string, string> = {};
        if (this.config.getHeaders) {
            try {
                configHeaders = this.config.getHeaders() ?? {};
            } catch {
                configHeaders = {};
            }
        }
        // Later layers replace earlier ones case-insensitively, so neither
        // getHeaders() nor per-call headers can override Authorization or
        // Content-Type.
        const headers = new Headers(configHeaders);
        for (const layer of [opts?.headers, init.headers]) {
            for (const [key, value] of Object.entries(layer ?? {})) {
                headers.set(key, value);
            }
        }
        const fetchImpl = this.config.fetch ?? fetch;
        return fetchImpl(this.url(path), {
            ...init,
            headers,
            signal: AbortSignal.timeout(10_000),
        });
    }

    /**
     * Ping calls GET /healthcheck and throws if the Forta API is not reachable
     * or does not return 2xx.
     */
    async ping(opts?: FortaCallOptions): Promise<void> {
        const res = await this.send("/healthcheck", {}, opts);
        if (!res.ok) {
            throw fortaError(
                `forta-js: ping: unexpected status ${res.status}`,
                res
            );
        }
    }

    /**
     * exchangeCode calls POST /auth/exchange to swap an authorization code for a
     * full token pair and user profile.
     */
    async exchangeCode(
        code: string,
        opts?: FortaCallOptions
    ): Promise<AuthResponse> {
        const body: ExchangeCodeRequest = {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code,
        };

        const res = await this.send(
            "/auth/exchange",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
            opts
        );

        if (!res.ok) {
            throw fortaError(
                `forta-js: exchange: forta returned status ${res.status}`,
                res
            );
        }

        const envelope: FortaEnvelope<AuthResponse> = await res.json();
        if (!envelope.success) {
            throw fortaError(`forta-js: exchange: ${envelope.message}`, res);
        }

        return envelope.data;
    }

    /**
     * getUserInfo calls GET /auth/self with the given Bearer token and returns
     * the full authenticated user profile.
     */
    async getUserInfo(
        accessToken: string,
        opts?: FortaCallOptions
    ): Promise<User> {
        const res = await this.send(
            "/auth/self",
            { headers: { Authorization: `Bearer ${accessToken}` } },
            opts
        );

        if (res.status === 401) {
            throw fortaError(
                "forta-js: auth/self: invalid or expired token",
                res
            );
        }
        if (!res.ok) {
            throw fortaError(
                `forta-js: auth/self: forta returned status ${res.status}`,
                res
            );
        }

        const envelope: FortaEnvelope<User> = await res.json();
        return envelope.data;
    }

    /**
     * refreshTokens calls POST /auth/refresh with the given refresh token and
     * returns a fresh token pair and the user profile.
     */
    async refreshTokens(
        refreshToken: string,
        opts?: FortaCallOptions
    ): Promise<AuthResponse> {
        const res = await this.send(
            "/auth/refresh",
            {
                method: "POST",
                headers: { Authorization: `Bearer ${refreshToken}` },
            },
            opts
        );

        if (res.status === 401) {
            throw fortaError(
                "forta-js: refresh: invalid or expired refresh token",
                res
            );
        }
        if (!res.ok) {
            throw fortaError(
                `forta-js: refresh: forta returned status ${res.status}`,
                res
            );
        }

        const envelope: FortaEnvelope<AuthResponse> = await res.json();
        if (!envelope.success) {
            throw fortaError(`forta-js: refresh: ${envelope.message}`, res);
        }

        return envelope.data;
    }
}

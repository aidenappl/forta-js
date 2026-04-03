import { FortaConfig, validateConfig } from "./config";
import type {
    AuthResponse,
    ExchangeCodeRequest,
    FortaEnvelope,
    User,
} from "./types";

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
     * Ping calls GET /healthcheck and throws if the Forta API is not reachable
     * or does not return 2xx.
     */
    async ping(): Promise<void> {
        const res = await fetch(this.url("/healthcheck"), {
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            throw new Error(`forta-js: ping: unexpected status ${res.status}`);
        }
    }

    /**
     * exchangeCode calls POST /auth/exchange to swap an authorization code for a
     * full token pair and user profile.
     */
    async exchangeCode(code: string): Promise<AuthResponse> {
        const body: ExchangeCodeRequest = {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code,
        };

        const res = await fetch(this.url("/auth/exchange"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
            throw new Error(
                `forta-js: exchange: forta returned status ${res.status}`
            );
        }

        const envelope: FortaEnvelope<AuthResponse> = await res.json();
        if (!envelope.success) {
            throw new Error(`forta-js: exchange: ${envelope.message}`);
        }

        return envelope.data;
    }

    /**
     * getUserInfo calls GET /auth/self with the given Bearer token and returns
     * the full authenticated user profile.
     */
    async getUserInfo(accessToken: string): Promise<User> {
        const res = await fetch(this.url("/auth/self"), {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10_000),
        });

        if (res.status === 401) {
            throw new Error("forta-js: auth/self: invalid or expired token");
        }
        if (!res.ok) {
            throw new Error(
                `forta-js: auth/self: forta returned status ${res.status}`
            );
        }

        const envelope: FortaEnvelope<User> = await res.json();
        return envelope.data;
    }

    /**
     * refreshTokens calls POST /auth/refresh with the given refresh token and
     * returns a fresh token pair and the user profile.
     */
    async refreshTokens(refreshToken: string): Promise<AuthResponse> {
        const res = await fetch(this.url("/auth/refresh"), {
            method: "POST",
            headers: { Authorization: `Bearer ${refreshToken}` },
            signal: AbortSignal.timeout(10_000),
        });

        if (res.status === 401) {
            throw new Error(
                "forta-js: refresh: invalid or expired refresh token"
            );
        }
        if (!res.ok) {
            throw new Error(
                `forta-js: refresh: forta returned status ${res.status}`
            );
        }

        const envelope: FortaEnvelope<AuthResponse> = await res.json();
        if (!envelope.success) {
            throw new Error(`forta-js: refresh: ${envelope.message}`);
        }

        return envelope.data;
    }
}

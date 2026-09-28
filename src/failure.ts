import type {
    FortaAuthFailure,
    FortaAuthFailureReason,
    FortaConfig,
} from "./config";
import type { FortaCallOptions, FortaRequestError } from "./client";

/** Inbound correlation headers forwarded to Forta by protect() and the handlers. */
export const FORWARDED_HEADERS = ["x-request-id", "traceparent", "x-trace-id"] as const;

/**
 * forwardedCallOptions builds FortaCallOptions carrying the inbound
 * correlation headers read through `get` (header names are lowercase).
 */
export function forwardedCallOptions(
    get: (name: string) => string | undefined
): FortaCallOptions {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) {
        const value = get(name);
        if (value) {
            headers[name] = value;
        }
    }
    return { headers };
}

/** Reads a Node.js IncomingMessage header as a single string. */
export function firstHeader(
    value: string | string[] | undefined
): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

/** Returns the HTTP status attached to a FortaClient error, if any. */
function errorStatus(err: unknown): number | undefined {
    if (err && typeof err === "object") {
        const status = (err as FortaRequestError).status;
        if (typeof status === "number") {
            return status;
        }
    }
    return undefined;
}

/** Returns the X-Request-ID Forta echoed on the failed response, if any. */
function errorRequestId(err: unknown): string | undefined {
    if (err && typeof err === "object") {
        const id = (err as FortaRequestError).requestId;
        if (typeof id === "string" && id) {
            return id;
        }
    }
    return undefined;
}

/**
 * isUpstreamError reports whether err means Forta itself was unavailable:
 * a network error, timeout, unparseable body, or a 5xx status.
 */
export function isUpstreamError(err: unknown): boolean {
    const status = errorStatus(err);
    return status === undefined || status >= 500;
}

/**
 * classifyError maps a FortaClient error to a failure reason: upstream
 * failures and 403s get their own reasons, everything else uses fallback.
 */
export function classifyError(
    err: unknown,
    fallback: FortaAuthFailureReason
): FortaAuthFailureReason {
    if (isUpstreamError(err)) {
        return "upstream_unavailable";
    }
    if (errorStatus(err) === 403) {
        return "grant_denied";
    }
    return fallback;
}

/** Builds a failure from a FortaClient error. */
export function failureFromError(
    err: unknown,
    fallback: FortaAuthFailureReason,
    requestId: string | undefined
): FortaAuthFailure {
    const info: FortaAuthFailure = {
        reason: classifyError(err, fallback),
        error: err,
    };
    const status = errorStatus(err);
    if (status !== undefined) info.status = status;
    if (requestId) info.requestId = requestId;
    const upstream = errorRequestId(err);
    if (upstream) info.upstreamRequestId = upstream;
    return info;
}

/** Calls config.onAuthFailure, ignoring any exception it throws. */
export function reportAuthFailure(
    config: FortaConfig,
    info: FortaAuthFailure
): void {
    if (!config.onAuthFailure) return;
    try {
        config.onAuthFailure(info);
    } catch {
        // Hooks must never affect authentication.
    }
}

import type { ServerResponse } from "http";
import type { ErrorResponseBody } from "./types";

/**
 * writeJsonError writes a JSON error response with the given HTTP status code.
 * It preserves any headers (such as Set-Cookie) already set on the response.
 */
export function writeJsonError(
    res: ServerResponse,
    status: number,
    message: string
): void {
    const body: ErrorResponseBody = {
        success: false,
        error_message: message,
    };
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(payload);
}

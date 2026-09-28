import { vi } from "vitest";

export interface RecordedCall {
    url: string;
    init: RequestInit;
    headers: Record<string, string>;
}

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

/** JSON response with optional headers. */
export function jsonRes(
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

/**
 * A fetch mock routed by path suffix. Each route holds a queue of responders;
 * the last responder repeats once the queue is exhausted.
 */
export function routedFetch(routes: Record<string, Responder[]>) {
    const calls: RecordedCall[] = [];
    const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        const headers: Record<string, string> = {};
        new Headers(init.headers).forEach((v, k) => {
            headers[k] = v;
        });
        calls.push({ url, init, headers });
        const path = new URL(url).pathname;
        const queue = routes[path];
        if (!queue || queue.length === 0) {
            throw new Error(`unexpected fetch ${url}`);
        }
        const responder = queue.length > 1 ? queue.shift()! : queue[0];
        return responder(url, init);
    });
    return { fetch: fn as unknown as typeof fetch, calls, mock: fn };
}

export function networkError(): never {
    throw new TypeError("fetch failed");
}

export function timeoutError(): never {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createFortaApiClient,
    type FortaRequestFailure,
} from "../src/react/api-client";
import { jsonRes, networkError, routedFetch, timeoutError } from "./helpers";

const API = "https://api.example.test";
const OK = { success: true, message: "OK", data: { id: 1 } };
const UNAUTH = { success: false, error: "unauthorized", error_message: "nope", error_code: 401 };

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("request headers", () => {
    it("sends no request id and only Content-Type when no options are set", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(200, OK)] });
        vi.stubGlobal("fetch", f.fetch);
        const client = createFortaApiClient({ apiUrl: API });

        const res = await client.fetch({ method: "GET", url: "/things" });

        expect(res).toEqual({ success: true, status: 200, message: "OK", data: { id: 1 } });
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0].headers).toEqual({ "content-type": "application/json" });
        expect(f.calls[0].init.credentials).toBe("include");
    });

    it("sends a fresh X-Request-ID per request when requestId is provided", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(200, OK)] });
        let n = 0;
        const client = createFortaApiClient({
            apiUrl: API,
            fetch: f.fetch,
            requestId: () => `rid-${++n}`,
        });

        await client.fetch({ method: "GET", url: "/things" });
        await client.fetch({ method: "GET", url: "/things" });

        expect(f.calls.map((c) => c.headers["x-request-id"])).toEqual(["rid-1", "rid-2"]);
    });

    it("omits the header when requestId returns undefined", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(200, OK)] });
        const client = createFortaApiClient({ apiUrl: API, fetch: f.fetch, requestId: () => undefined });
        await client.fetch({ method: "GET", url: "/things" });
        expect(f.calls[0].headers["x-request-id"]).toBeUndefined();
    });

    it("uses a custom request id header name", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(200, OK)] });
        const client = createFortaApiClient({
            apiUrl: API,
            fetch: f.fetch,
            requestId: () => "abc",
            requestIdHeader: "X-Correlation-ID",
        });
        await client.fetch({ method: "GET", url: "/things" });
        expect(f.calls[0].headers["x-correlation-id"]).toBe("abc");
        expect(f.calls[0].headers["x-request-id"]).toBeUndefined();
    });

    it("merges getHeaders, with per-request headers taking precedence", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(200, OK)] });
        const getHeaders = vi.fn(() => ({ traceparent: "00-abc-def-01", "X-Extra": "from-hook" }));
        const client = createFortaApiClient({ apiUrl: API, fetch: f.fetch, getHeaders });

        await client.fetch({ method: "POST", url: "/things", headers: { "x-extra": "explicit" }, body: { a: 1 } });

        expect(getHeaders).toHaveBeenCalledWith(
            expect.objectContaining({ method: "POST", url: "/things" })
        );
        expect(f.calls[0].headers).toMatchObject({
            traceparent: "00-abc-def-01",
            "x-extra": "explicit",
            "content-type": "application/json",
        });
    });

    it("keeps an explicit request id header instead of generating one", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(503, { success: false })] });
        const failures: FortaRequestFailure[] = [];
        const requestId = vi.fn(() => "generated");
        const client = createFortaApiClient({
            apiUrl: API,
            fetch: f.fetch,
            requestId,
            onRequestFailure: (x) => failures.push(x),
        });
        await client.fetch({ method: "GET", url: "/things", headers: { "x-request-id": "mine" } });
        expect(f.calls[0].headers["x-request-id"]).toBe("mine");
        expect(requestId).not.toHaveBeenCalled();
        expect(failures[0].requestId).toBe("mine");
    });
});

describe("onRequestFailure", () => {
    function setup(routes: Parameters<typeof routedFetch>[0]) {
        const f = routedFetch(routes);
        const failures: FortaRequestFailure[] = [];
        let n = 0;
        const client = createFortaApiClient({
            apiUrl: API,
            fetch: f.fetch,
            requestId: () => `rid-${++n}`,
            onRequestFailure: (x) => failures.push(x),
        });
        return { client, failures, f };
    }

    it("reports network errors and keeps the request_failed envelope", async () => {
        const { client, failures } = setup({ "/things": [networkError] });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toEqual({
            success: false,
            status: 500,
            error: "request_failed",
            error_message: "fetch failed",
            error_code: -1,
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ kind: "network", method: "GET", url: "/things", requestId: "rid-1" });
        expect(failures[0].status).toBeUndefined();
        expect(failures[0].error).toBeInstanceOf(TypeError);
    });

    it("reports timeouts", async () => {
        const { client, failures } = setup({ "/things": [timeoutError] });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toMatchObject({ success: false, status: 500, error: "request_failed" });
        expect(failures.map((x) => x.kind)).toEqual(["timeout"]);
        expect(failures[0].requestId).toBe("rid-1");
    });

    it("reports 5xx responses with the echoed request id", async () => {
        const { client, failures } = setup({
            "/things": [() => jsonRes(503, { success: false, error: "down", error_message: "db down", error_code: 503 }, { "X-Request-ID": "srv-1" })],
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toEqual({ success: false, status: 503, error: "down", error_message: "db down", error_code: 503 });
        expect(failures).toEqual([
            {
                kind: "http",
                method: "GET",
                url: "/things",
                status: 503,
                requestId: "rid-1",
                responseRequestId: "srv-1",
                error: "db down",
            },
        ]);
    });

    it("does not report 4xx other than 4003", async () => {
        const { client, failures } = setup({ "/things": [() => jsonRes(404, { success: false, error_code: 404 })] });
        await client.fetch({ method: "GET", url: "/things" });
        expect(failures).toEqual([]);
    });

    it("reports parse failures and keeps the parse_error envelope", async () => {
        const { client, failures } = setup({
            "/things": [() => new Response("<html>bad gateway</html>", { status: 502, headers: { "X-Request-ID": "srv-2" } })],
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toEqual({
            success: false,
            status: 502,
            error: "parse_error",
            error_message: "Failed to parse response body",
            error_code: -1,
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ kind: "parse", status: 502, requestId: "rid-1", responseRequestId: "srv-2" });
    });

    it("reports refresh_failed with ids and returns the original 401", async () => {
        const { client, failures, f } = setup({
            "/things": [() => jsonRes(401, UNAUTH, { "X-Request-ID": "srv-a" })],
            "/auth/refresh": [() => jsonRes(401, { success: false, error_message: "expired" }, { "X-Request-ID": "srv-r" })],
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toMatchObject({ success: false, status: 401, error_code: 401 });
        expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(["/things", "/auth/refresh"]);
        expect(f.calls[1].headers["x-request-id"]).toBe("rid-2");
        expect(failures).toEqual([
            {
                kind: "refresh_failed",
                method: "POST",
                url: "/auth/refresh",
                status: 401,
                requestId: "rid-2",
                responseRequestId: "srv-r",
                error: "expired",
            },
        ]);
    });

    it("reports refresh_failed when the refresh endpoint is unreachable", async () => {
        const { client, failures } = setup({
            "/things": [() => jsonRes(401, UNAUTH)],
            "/auth/refresh": [networkError],
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toMatchObject({ success: false, status: 401 });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ kind: "refresh_failed", url: "/auth/refresh", requestId: "rid-2" });
        expect(failures[0].status).toBeUndefined();
        expect(failures[0].error).toBeInstanceOf(TypeError);
    });

    it("retries after a successful refresh without reporting", async () => {
        const { client, failures, f } = setup({
            "/things": [() => jsonRes(401, UNAUTH), () => jsonRes(200, OK)],
            "/auth/refresh": [() => jsonRes(200, { success: true })],
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res.success).toBe(true);
        expect(f.calls.map((c) => c.headers["x-request-id"])).toEqual(["rid-1", "rid-2", "rid-3"]);
        expect(failures).toEqual([]);
    });

    it("reports grant_revoked for 403/4003", async () => {
        const { client, failures } = setup({
            "/things": [() => jsonRes(403, { success: false, error: "forbidden", error_message: "grant required", error_code: 4003 }, { "X-Request-ID": "srv-g" })],
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toMatchObject({ success: false, status: 403, error_code: 4003 });
        expect(failures).toEqual([
            {
                kind: "grant_revoked",
                method: "GET",
                url: "/things",
                status: 403,
                requestId: "rid-1",
                responseRequestId: "srv-g",
                error: "grant required",
            },
        ]);
    });

    it("ignores exceptions thrown by the hook", async () => {
        const f = routedFetch({ "/things": [() => jsonRes(500, { success: false, error_code: 500 })] });
        const client = createFortaApiClient({
            apiUrl: API,
            fetch: f.fetch,
            onRequestFailure: () => {
                throw new Error("boom");
            },
        });
        const res = await client.fetch({ method: "GET", url: "/things" });
        expect(res).toMatchObject({ success: false, status: 500 });
    });
});

describe("refresh dedupe", () => {
    it("shares one refresh across concurrent 401s", async () => {
        let releaseRefresh!: () => void;
        const gate = new Promise<void>((r) => (releaseRefresh = r));
        let thingsCalls = 0;
        const f = routedFetch({
            "/things": [() => (++thingsCalls <= 2 ? jsonRes(401, UNAUTH) : jsonRes(200, OK))],
            "/auth/refresh": [async () => {
                await gate;
                return jsonRes(200, { success: true });
            }],
        });
        const client = createFortaApiClient({ apiUrl: API, fetch: f.fetch });

        const a = client.fetch({ method: "GET", url: "/things" });
        const b = client.fetch({ method: "GET", url: "/things" });
        await vi.waitFor(() => expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1));
        releaseRefresh();
        const [ra, rb] = await Promise.all([a, b]);

        expect(ra.success).toBe(true);
        expect(rb.success).toBe(true);
        expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
    });

    it("reports a shared refresh failure once", async () => {
        const failures: FortaRequestFailure[] = [];
        const f = routedFetch({
            "/things": [() => jsonRes(401, UNAUTH)],
            "/auth/refresh": [async () => jsonRes(401, { success: false })],
        });
        const client = createFortaApiClient({ apiUrl: API, fetch: f.fetch, onRequestFailure: (x) => failures.push(x) });
        await Promise.all([
            client.fetch({ method: "GET", url: "/things" }),
            client.fetch({ method: "GET", url: "/things" }),
        ]);
        expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
        expect(failures.filter((x) => x.kind === "refresh_failed")).toHaveLength(1);
    });
});

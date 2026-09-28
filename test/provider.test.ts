// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FortaContext, FortaProvider, type FortaAuthContext, type FortaProviderConfig } from "../src/react/provider";
import type { FortaRequestFailure } from "../src/react/api-client";
import { jsonRes, networkError, routedFetch } from "./helpers";

const API = "https://api.example.test";
const USER = { id: 7, email: "a@b.c" };
const UNAUTH = { success: false, error: "unauthorized", error_message: "nope", error_code: 401 };

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
});

function mount() {
    const container = document.createElement("div");
    root = createRoot(container);
    const seen: FortaAuthContext[] = [];
    function Probe() {
        const ctx = useContext(FortaContext);
        if (ctx) seen.push(ctx);
        return null;
    }
    const render = async (config: FortaProviderConfig) => {
        await act(async () => {
            root!.render(createElement(FortaProvider, { config, children: createElement(Probe) }));
        });
    };
    return { render, seen, latest: () => seen[seen.length - 1] };
}

describe("FortaProvider", () => {
    it("keeps the client stable across re-renders with inline callbacks and dedupes refresh", async () => {
        let releaseRefresh!: () => void;
        const gate = new Promise<void>((r) => (releaseRefresh = r));
        let thingsCalls = 0;
        const f = routedFetch({
            "/auth/self": [() => jsonRes(200, { success: true, data: USER })],
            "/things": [() => (++thingsCalls <= 2 ? jsonRes(401, UNAUTH) : jsonRes(200, { success: true, data: 1 }))],
            "/auth/refresh": [async () => {
                await gate;
                return jsonRes(200, { success: true });
            }],
        });
        const m = mount();
        const firstHook = vi.fn();
        const lastHook = vi.fn();
        const ids: string[] = [];

        await m.render({ apiUrl: API, fetch: f.fetch, requestId: () => "first", onRequestFailure: firstHook });
        const client = m.latest().apiClient;
        expect(m.latest().isLoggedIn).toBe(true);

        // Re-render several times with brand new inline callbacks.
        for (let i = 0; i < 3; i++) {
            await m.render({
                apiUrl: API,
                fetch: f.fetch,
                requestId: () => {
                    const id = `latest-${ids.length}`;
                    ids.push(id);
                    return id;
                },
                onRequestFailure: lastHook,
            });
        }
        expect(m.latest().apiClient).toBe(client);

        const a = client.fetch({ method: "GET", url: "/things" });
        const b = client.fetch({ method: "GET", url: "/things" });
        await vi.waitFor(() => expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1));
        releaseRefresh();
        const [ra, rb] = await Promise.all([a, b]);

        expect(ra.success && rb.success).toBe(true);
        expect(f.calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
        // The latest inline requestId is used (read through the ref).
        const thingIds = f.calls.filter((c) => c.url.endsWith("/things")).map((c) => c.headers["x-request-id"]);
        expect(thingIds.every((id) => id?.startsWith("latest-"))).toBe(true);
        expect(firstHook).not.toHaveBeenCalled();
    });

    it("reports session_check_failed when /self is unreachable", async () => {
        const f = routedFetch({ "/auth/self": [networkError] });
        const failures: FortaRequestFailure[] = [];
        const onAuthStateChange = vi.fn();
        const m = mount();
        await m.render({
            apiUrl: API,
            fetch: f.fetch,
            requestId: () => "boot-1",
            onRequestFailure: (x) => failures.push(x),
            onAuthStateChange,
        });

        expect(m.latest().isLoggedIn).toBe(false);
        expect(m.latest().isLoading).toBe(false);
        expect(onAuthStateChange).toHaveBeenCalledWith(null);
        expect(failures.map((x) => x.kind)).toEqual(["network", "session_check_failed"]);
        expect(failures[1]).toMatchObject({ method: "GET", url: "/auth/self", requestId: "boot-1" });
        expect(failures[1].error).toBeInstanceOf(TypeError);
    });

    it("reports session_check_failed with the status and echoed id on 5xx", async () => {
        const f = routedFetch({
            "/auth/self": [() => jsonRes(503, { success: false, error_message: "down", error_code: 503 }, { "X-Request-ID": "srv-9" })],
        });
        const failures: FortaRequestFailure[] = [];
        const m = mount();
        await m.render({ apiUrl: API, fetch: f.fetch, onRequestFailure: (x) => failures.push(x) });

        expect(failures.map((x) => x.kind)).toEqual(["http", "session_check_failed"]);
        expect(failures[1]).toMatchObject({ status: 503, responseRequestId: "srv-9", url: "/auth/self" });
    });

    it("does not report session_check_failed for a normal logged-out 401", async () => {
        const f = routedFetch({
            "/auth/self": [() => jsonRes(401, UNAUTH)],
            "/auth/refresh": [() => jsonRes(401, { success: false })],
        });
        const failures: FortaRequestFailure[] = [];
        const m = mount();
        await m.render({ apiUrl: API, fetch: f.fetch, onRequestFailure: (x) => failures.push(x) });

        expect(m.latest().isLoggedIn).toBe(false);
        expect(failures.map((x) => x.kind)).toEqual(["refresh_failed"]);
        expect(failures[0].status).toBe(401);
    });

    it("reports session_check_failed when refresh is unreachable during the check", async () => {
        const f = routedFetch({
            "/auth/self": [() => jsonRes(401, UNAUTH)],
            "/auth/refresh": [networkError],
        });
        const failures: FortaRequestFailure[] = [];
        const m = mount();
        await m.render({ apiUrl: API, fetch: f.fetch, onRequestFailure: (x) => failures.push(x) });
        expect(failures.map((x) => x.kind)).toEqual(["refresh_failed", "session_check_failed"]);
        expect(failures[1].status).toBe(401);
    });

    it("behaves as before with no new options", async () => {
        const f = routedFetch({ "/auth/self": [() => jsonRes(200, { success: true, data: USER })] });
        vi.stubGlobal("fetch", f.fetch);
        try {
            const m = mount();
            await m.render({ apiUrl: API });
            expect(m.latest().isLoggedIn).toBe(true);
            expect(m.latest().user).toEqual(USER);
            expect(f.calls[0].headers).toEqual({ "content-type": "application/json" });
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

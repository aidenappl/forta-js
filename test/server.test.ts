import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import jwt from "jsonwebtoken";
import { FortaClient, type FortaRequestError } from "../src/client";
import type { FortaAuthFailure, FortaConfig } from "../src/config";
import { createProtect } from "../src/middleware";
import { createCallbackHandler } from "../src/handlers";
import { getFortaIdFromRequest } from "../src/context";
import { jsonRes, networkError, routedFetch } from "./helpers";

const API = "https://forta.example.test";
const BASE: FortaConfig = {
    apiDomain: API,
    loginDomain: "https://login.example.test",
    clientId: "cid",
    clientSecret: "secret",
};
const USER = { id: 42, email: "a@b.c" };
const TOKEN = "aaa.bbb.ccc";
const TOKENS = {
    access_token: "new.access.token",
    refresh_token: "new-refresh",
    token_type: "Bearer",
    expires_in: 900,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
};
const REFRESH_OK = { success: true, message: "OK", data: { user: USER, authorization: TOKENS, is_new_user: false } };
const SELF_OK = { success: true, message: "OK", data: USER };

function fakeReq(headers: Record<string, string>): IncomingMessage {
    return { headers, url: "/" } as unknown as IncomingMessage;
}

function fakeRes() {
    const headers: Record<string, unknown> = {};
    const res = {
        statusCode: 200,
        body: "",
        setHeader: (k: string, v: unknown) => {
            headers[k.toLowerCase()] = v;
        },
        getHeader: (k: string) => headers[k.toLowerCase()],
        writeHead: (status: number, h?: Record<string, string>) => {
            res.statusCode = status;
            Object.entries(h ?? {}).forEach(([k, v]) => (headers[k.toLowerCase()] = v));
        },
        end: (body?: string) => {
            res.body = body ?? "";
        },
        headers,
    };
    return res;
}

function run(config: FortaConfig, headers: Record<string, string>) {
    const client = new FortaClient(config);
    const next = vi.fn();
    const req = fakeReq(headers);
    const res = fakeRes();
    const handler = createProtect(client)(next);
    return {
        req,
        res,
        next,
        done: handler(req, res as unknown as ServerResponse) as Promise<void>,
    };
}

describe("FortaClient", () => {
    it("merges config and per-call headers without overriding Authorization", async () => {
        const f = routedFetch({ "/auth/self": [() => jsonRes(200, SELF_OK)] });
        const client = new FortaClient({
            ...BASE,
            fetch: f.fetch,
            getHeaders: () => ({ "x-service": "svc", "x-request-id": "cfg", Authorization: "Bearer evil" }),
        });
        await client.getUserInfo(TOKEN, { headers: { "x-request-id": "call", authorization: "Bearer evil2" } });
        expect(f.calls[0].headers["x-service"]).toBe("svc");
        expect(f.calls[0].headers["x-request-id"]).toBe("call");
        expect(f.calls[0].headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    });

    it("attaches status and the echoed request id to thrown errors, message unchanged", async () => {
        const f = routedFetch({ "/auth/refresh": [() => jsonRes(401, {}, { "X-Request-ID": "srv-1" })] });
        const client = new FortaClient({ ...BASE, fetch: f.fetch });
        const err = (await client.refreshTokens("r").catch((e) => e)) as FortaRequestError;
        expect(err.message).toBe("forta-js: refresh: invalid or expired refresh token");
        expect(err.status).toBe(401);
        expect(err.requestId).toBe("srv-1");
    });

    it("does not send X-Forta-Client-ID on refresh (unchanged)", async () => {
        const f = routedFetch({ "/auth/refresh": [() => jsonRes(200, REFRESH_OK)] });
        const client = new FortaClient({ ...BASE, fetch: f.fetch });
        await client.refreshTokens("r");
        expect(f.calls[0].headers["x-forta-client-id"]).toBeUndefined();
    });

    it("uses the global fetch with only the required headers by default", async () => {
        const f = routedFetch({ "/auth/self": [() => jsonRes(200, SELF_OK)] });
        vi.stubGlobal("fetch", f.fetch);
        try {
            await new FortaClient(BASE).getUserInfo(TOKEN);
            expect(f.calls[0].headers).toEqual({ authorization: `Bearer ${TOKEN}` });
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("Express protect", () => {
    it("forwards inbound x-request-id, traceparent and x-trace-id to Forta", async () => {
        const f = routedFetch({ "/auth/self": [() => jsonRes(200, SELF_OK)] });
        const t = run({ ...BASE, fetch: f.fetch }, {
            authorization: `Bearer ${TOKEN}`,
            "x-request-id": "in-1",
            traceparent: "00-trace-span-01",
            "x-trace-id": "trace-1",
        });
        await t.done;
        expect(t.next).toHaveBeenCalledOnce();
        expect(getFortaIdFromRequest(t.req)).toEqual([42, true]);
        expect(f.calls[0].headers).toMatchObject({
            "x-request-id": "in-1",
            traceparent: "00-trace-span-01",
            "x-trace-id": "trace-1",
        });
    });

    it("forwards the inbound request id on refresh and the post-refresh /self", async () => {
        const f = routedFetch({
            "/auth/self": [() => jsonRes(401, {}), () => jsonRes(200, SELF_OK)],
            "/auth/refresh": [() => jsonRes(200, REFRESH_OK)],
        });
        const t = run({ ...BASE, fetch: f.fetch }, {
            authorization: `Bearer ${TOKEN}`,
            cookie: "forta-refresh-token=rt",
            "x-request-id": "in-2",
        });
        await t.done;
        expect(t.next).toHaveBeenCalledOnce();
        expect(f.calls.map((c) => c.headers["x-request-id"])).toEqual(["in-2", "in-2", "in-2"]);
    });

    const cases: {
        name: string;
        config?: Partial<FortaConfig>;
        headers: Record<string, string>;
        routes: Parameters<typeof routedFetch>[0];
        expectNext: boolean;
        expected: Partial<FortaAuthFailure>[];
    }[] = [
        {
            name: "missing_credential",
            headers: { "x-request-id": "in" },
            routes: {},
            expectNext: false,
            expected: [{ reason: "missing_credential", status: 401, requestId: "in" }],
        },
        {
            name: "upstream_unavailable when /auth/self is down and refresh fails",
            headers: { authorization: `Bearer ${TOKEN}`, cookie: "forta-refresh-token=rt", "x-request-id": "in" },
            routes: { "/auth/self": [networkError], "/auth/refresh": [networkError] },
            expectNext: false,
            expected: [{ reason: "upstream_unavailable", requestId: "in" }],
        },
        {
            name: "upstream_unavailable reported even when refresh masks a 503",
            headers: { authorization: `Bearer ${TOKEN}`, cookie: "forta-refresh-token=rt" },
            routes: {
                "/auth/self": [() => jsonRes(503, {}, { "X-Request-ID": "srv-503" }), () => jsonRes(200, SELF_OK)],
                "/auth/refresh": [() => jsonRes(200, REFRESH_OK)],
            },
            expectNext: true,
            expected: [{ reason: "upstream_unavailable", status: 503, upstreamRequestId: "srv-503" }],
        },
        {
            name: "refresh_failed when the refresh token is rejected",
            headers: { authorization: `Bearer ${TOKEN}`, cookie: "forta-refresh-token=rt" },
            routes: { "/auth/self": [() => jsonRes(401, {})], "/auth/refresh": [() => jsonRes(401, {}, { "X-Request-ID": "srv-r" })] },
            expectNext: false,
            expected: [{ reason: "refresh_failed", status: 401, upstreamRequestId: "srv-r" }],
        },
        {
            name: "grant_denied when refresh returns 403",
            headers: { authorization: `Bearer ${TOKEN}`, cookie: "forta-refresh-token=rt" },
            routes: { "/auth/self": [() => jsonRes(401, {})], "/auth/refresh": [() => jsonRes(403, {})] },
            expectNext: false,
            expected: [{ reason: "grant_denied", status: 403 }],
        },
        {
            name: "token_expired when there is no refresh cookie",
            headers: { authorization: `Bearer ${TOKEN}` },
            routes: { "/auth/self": [() => jsonRes(401, {})] },
            expectNext: false,
            expected: [{ reason: "token_expired", status: 401 }],
        },
        {
            name: "token_invalid with disableAutoRefresh",
            config: { disableAutoRefresh: true },
            headers: { authorization: `Bearer ${TOKEN}` },
            routes: { "/auth/self": [() => jsonRes(401, {})] },
            expectNext: false,
            expected: [{ reason: "token_invalid", status: 401 }],
        },
        {
            name: "no report on success",
            headers: { authorization: `Bearer ${TOKEN}` },
            routes: { "/auth/self": [() => jsonRes(200, SELF_OK)] },
            expectNext: true,
            expected: [],
        },
    ];

    for (const c of cases) {
        it(`onAuthFailure: ${c.name}`, async () => {
            const f = routedFetch(c.routes);
            const failures: FortaAuthFailure[] = [];
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const t = run({ ...BASE, ...c.config, fetch: f.fetch, onAuthFailure: (i) => failures.push(i) }, c.headers);
            await t.done;
            warn.mockRestore();
            expect(t.next).toHaveBeenCalledTimes(c.expectNext ? 1 : 0);
            if (!c.expectNext) expect(t.res.statusCode).toBe(401);
            expect(failures).toHaveLength(c.expected.length);
            c.expected.forEach((e, i) => expect(failures[i]).toMatchObject(e));
        });
    }

    describe("local JWT validation", () => {
        const KEY = "signing-key";
        const sign = (opts: jwt.SignOptions, payload: object = { typ: "access" }) =>
            jwt.sign(payload, KEY, { algorithm: "HS512", issuer: "forta:auth-service", subject: "42", ...opts });

        it("reports token_invalid for a bad signature", async () => {
            const failures: FortaAuthFailure[] = [];
            const bad = jwt.sign({ typ: "access" }, "other", { algorithm: "HS512", issuer: "forta:auth-service", subject: "42" });
            const t = run({ ...BASE, jwtSigningKey: KEY, onAuthFailure: (i) => failures.push(i) }, { authorization: `Bearer ${bad}` });
            await t.done;
            expect(t.res.statusCode).toBe(401);
            expect(failures[0]).toMatchObject({ reason: "token_invalid", status: 401 });
        });

        it("reports token_expired when expired and auto refresh is disabled", async () => {
            const failures: FortaAuthFailure[] = [];
            const expired = sign({ expiresIn: -10 });
            const t = run(
                { ...BASE, jwtSigningKey: KEY, disableAutoRefresh: true, onAuthFailure: (i) => failures.push(i) },
                { authorization: `Bearer ${expired}` }
            );
            await t.done;
            expect(failures[0]).toMatchObject({ reason: "token_expired" });
        });

        it("reports fetchUserOnProtect failures without failing the request", async () => {
            const failures: FortaAuthFailure[] = [];
            const f = routedFetch({ "/auth/self": [() => jsonRes(502, {})] });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const t = run(
                { ...BASE, jwtSigningKey: KEY, fetchUserOnProtect: true, fetch: f.fetch, onAuthFailure: (i) => failures.push(i) },
                { authorization: `Bearer ${sign({ expiresIn: 60 })}`, "x-request-id": "in" }
            );
            await t.done;
            warn.mockRestore();
            expect(t.next).toHaveBeenCalledOnce();
            expect(failures[0]).toMatchObject({ reason: "upstream_unavailable", status: 502, requestId: "in" });
        });
    });

    it("writes the same 401 body with no options configured", async () => {
        const f = routedFetch({ "/auth/self": [() => jsonRes(401, {})] });
        vi.stubGlobal("fetch", f.fetch);
        try {
            const t = run(BASE, { authorization: `Bearer ${TOKEN}` });
            await t.done;
            expect(t.res.statusCode).toBe(401);
            expect(JSON.parse(t.res.body)).toEqual({ success: false, error_message: "session expired, please log in again" });
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("callbackHandler", () => {
    it("reports exchange_failed and still returns 401", async () => {
        const f = routedFetch({ "/auth/exchange": [() => jsonRes(400, {}, { "X-Request-ID": "srv-x" })] });
        const failures: FortaAuthFailure[] = [];
        const client = new FortaClient({ ...BASE, fetch: f.fetch, onAuthFailure: (i) => failures.push(i) });
        const req = {
            headers: { host: "app.test", cookie: "forta-oauth-state=s1", "x-request-id": "in-x" },
            url: "/forta/callback?code=c&state=s1",
        } as unknown as IncomingMessage;
        const res = fakeRes();
        await createCallbackHandler(client)(req, res as unknown as ServerResponse);
        expect(res.statusCode).toBe(401);
        expect(f.calls[0].headers["x-request-id"]).toBe("in-x");
        expect(failures).toEqual([
            expect.objectContaining({ reason: "exchange_failed", status: 400, requestId: "in-x", upstreamRequestId: "srv-x" }),
        ]);
    });
});

import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { protect, setupNext } from "../src/next";
import type { FortaAuthFailure } from "../src/config";
import { jsonRes, networkError, routedFetch } from "./helpers";

const BASE = {
    apiDomain: "https://forta.example.test",
    loginDomain: "https://login.example.test",
    clientId: "cid",
    clientSecret: "secret",
};
const SELF_OK = { success: true, message: "OK", data: { id: 5 } };

type Req = Parameters<ReturnType<typeof protect>>[0];

describe("Next protect", () => {
    it("forwards inbound correlation headers to Forta", async () => {
        const f = routedFetch({ "/auth/self": [() => jsonRes(200, SELF_OK)] });
        setupNext({ ...BASE, fetch: f.fetch });
        const handler = protect(async (_req, ctx) => NextResponse.json({ id: ctx.fortaId }));
        const req = new NextRequest("https://app.test/api/x", {
            headers: { authorization: "Bearer a.b.c", "x-request-id": "in-n", traceparent: "00-t-s-01" },
        });
        const res = await handler(req as unknown as Req);
        expect(await res.json()).toEqual({ id: 5 });
        expect(f.calls[0].headers).toMatchObject({ "x-request-id": "in-n", traceparent: "00-t-s-01" });
    });

    it("calls onAuthFailure with upstream_unavailable when Forta is down", async () => {
        const f = routedFetch({ "/auth/self": [networkError], "/auth/refresh": [networkError] });
        const failures: FortaAuthFailure[] = [];
        setupNext({ ...BASE, fetch: f.fetch, onAuthFailure: (i) => failures.push(i) });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const handler = protect(async () => NextResponse.json({}));
        const req = new NextRequest("https://app.test/api/x", {
            headers: { authorization: "Bearer a.b.c", cookie: "forta-refresh-token=rt", "x-request-id": "in-d" },
        });
        const res = await handler(req as unknown as Req);
        warn.mockRestore();
        expect(res.status).toBe(401);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ reason: "upstream_unavailable", requestId: "in-d" });
    });

    it("reports missing_credential", async () => {
        const failures: FortaAuthFailure[] = [];
        setupNext({ ...BASE, onAuthFailure: (i) => failures.push(i) });
        const res = await protect(async () => NextResponse.json({}))(
            new NextRequest("https://app.test/api/x") as unknown as Req
        );
        expect(res.status).toBe(401);
        expect(failures[0]).toMatchObject({ reason: "missing_credential", status: 401 });
    });
});

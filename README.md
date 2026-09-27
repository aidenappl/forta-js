# forta-js

JavaScript/TypeScript client for Forta authentication.

| Entry point      | For                                                                 |
| ---------------- | ------------------------------------------------------------------- |
| `forta-js`       | Node.js / Express: `setup`, `protect`, login/callback/logout handlers, `FortaClient` |
| `forta-js/next`  | Next.js App Router: `setupNext`, `protect`, route handlers         |
| `forta-js/react` | Browser: `FortaProvider`, hooks, `createFortaApiClient`, UI components |

```bash
npm install forta-js
```

## Request IDs and failure hooks (1.4.0)

Every option below is optional. With none of them set, requests, return
values, redirects and refresh behaviour are exactly as in 1.3.

### Browser (`forta-js/react`)

`FortaProvider` config and `createFortaApiClient` accept:

| Option             | Type                                              | Purpose |
| ------------------ | ------------------------------------------------- | ------- |
| `requestId`        | `() => string \| undefined`                       | Called once per outgoing request (including the refresh call and the retry after it). The value is sent in `requestIdHeader`. |
| `requestIdHeader`  | `string`                                          | Header name. Default `"X-Request-ID"`. |
| `getHeaders`       | `(req: RequestConfig) => Record<string, string>`  | Extra headers per request (e.g. `traceparent`). Headers on the individual request win. |
| `fetch`            | `typeof fetch`                                    | Custom fetch. Default: the global `fetch`. |
| `onRequestFailure` | `(f: FortaRequestFailure) => void`                | Observes failures. Never changes what the client returns. Exceptions thrown inside it are ignored. |

```ts
interface FortaRequestFailure {
  kind: "network" | "timeout" | "http" | "parse" | "refresh_failed" | "grant_revoked" | "session_check_failed";
  method: string;
  url: string;                 // path as passed, relative to apiUrl (may include a query string)
  status?: number;             // absent when no response was received
  requestId?: string;          // the id this client sent
  responseRequestId?: string;  // the X-Request-ID the server echoed
  error?: unknown;             // underlying error, or the API's error_message for http failures
}
```

When each kind is reported:

- `network` / `timeout`: fetch rejected. The client still returns the usual `{ status: 500, error: "request_failed" }` envelope.
- `http`: the API answered 5xx. 4xx responses are normal outcomes and are not reported, except 4003.
- `parse`: the body was not JSON. The client still returns `parse_error`.
- `refresh_failed`: `POST {refreshEndpoint}` failed. Concurrent 401s share one refresh, so a failed refresh is reported once. `status: 401` here only means the session has ended.
- `grant_revoked`: 403 with `error_code` 4003. Reported before the redirect to `unauthorizedPath`.
- `session_check_failed`: provider only. The initial `/self` check failed for a reason other than being logged out: network error, timeout, 5xx, a body that was not JSON, or a refresh endpoint that could not be reached. A normal 401 is never reported as this kind. It is reported in addition to the underlying `network` / `http` / … failure. This lets you tell an outage apart from a logged-out user, which `onAuthStateChange(null)` alone cannot do.

The provider reads its callbacks through a ref, so inline arrow functions are fine. They never rebuild the API client or reset its refresh dedupe.

> **CORS:** a browser only sends `X-Request-ID`, `traceparent` or any other custom header cross-origin if the API lists it in its CORS `AllowedHeaders`. Otherwise the preflight fails and every request errors. Add the header on the API before you turn on `requestId` / `getHeaders`. `onRequestFailure` needs nothing on the API. To read `responseRequestId`, the API must list `X-Request-ID` in `ExposedHeaders`.

#### Example: monitor-js wiring

```ts
// services/monitor.service.ts
import { Monitor, newRequestId } from "@aidenappleby/monitor-js";

export const monitor = typeof window !== "undefined"
  ? new Monitor({ service: "my-web", ingestUrl: "/api/monitor", apiKey: "" })
  : null;

export const newClientRequestId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : newRequestId();
```

```tsx
"use client";
import { FortaProvider, type FortaRequestFailure } from "forta-js/react";
import { monitor, newClientRequestId } from "@/services/monitor.service";

const reportFortaFailure = (f: FortaRequestFailure) => {
  if (!monitor) return;
  // A 401/403 from refresh just means the session is over. It is not an outage.
  const expected = f.status === 401 || f.status === 403;
  monitor.emit(`forta.${f.kind}`, expected ? "info" : "error", {
    requestId: f.responseRequestId ?? f.requestId,
    data: {
      method: f.method,
      url: f.url.split("?")[0],
      status_code: f.status,
      client_request_id: f.requestId,
      message: f.error instanceof Error ? f.error.message : typeof f.error === "string" ? f.error : undefined,
    },
  });
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <FortaProvider
      config={{
        apiUrl: process.env.NEXT_PUBLIC_API!,
        requestId: newClientRequestId,   // only once the API allows X-Request-ID in CORS
        onRequestFailure: reportFortaFailure,
      }}
    >
      {children}
    </FortaProvider>
  );
}
```

### Server (`forta-js`, `forta-js/next`)

`FortaConfig` (passed to `setup` / `setupNext` / `new FortaClient`) accepts:

| Option          | Type                                   | Purpose |
| --------------- | -------------------------------------- | ------- |
| `fetch`         | `typeof fetch`                         | Custom fetch for calls to Forta. |
| `getHeaders`    | `() => Record<string, string>`         | Extra headers on every call to Forta. |
| `onAuthFailure` | `(info: FortaAuthFailure) => void`     | Called when authentication fails, or when an upstream error would otherwise be swallowed. It never changes the response. |

```ts
interface FortaAuthFailure {
  reason: "missing_credential" | "token_invalid" | "token_expired" | "refresh_failed"
        | "upstream_unavailable" | "grant_denied" | "exchange_failed";
  status?: number;             // status Forta returned
  error?: unknown;
  requestId?: string;          // inbound X-Request-ID (forwarded to Forta)
  upstreamRequestId?: string;  // X-Request-ID Forta echoed
}
```

`protect()`, `callbackHandler` and `fetchCurrentUser` in both adapters forward the inbound `X-Request-ID`, `traceparent` and `X-Trace-ID` headers to Forta. Precedence, lowest first: `getHeaders()`, then the forwarded headers. `Authorization` and `Content-Type` can never be overridden.

Every `FortaClient` method (`ping`, `exchangeCode`, `getUserInfo`, `refreshTokens`) takes an optional trailing `opts?: { headers?: Record<string, string> }`. Errors they throw keep their messages and also carry `status` and `requestId`, the id Forta echoed (`FortaRequestError`).

Examples of `upstream_unavailable`:

- `/auth/self` fails with a network error or 5xx and the refresh also fails. The response is still the same 401, but the reason now shows it was an outage.
- A refresh succeeds but only because it masked an `/auth/self` outage.
- `fetchUserOnProtect`, or the `/auth/self` call after a refresh, fails without failing the request.

```ts
import forta from "forta-js";
import { monitor } from "./monitor";

forta.setup({
  apiDomain: process.env.FORTA_API_DOMAIN!,
  loginDomain: process.env.FORTA_LOGIN_DOMAIN!,
  clientId: process.env.FORTA_CLIENT_ID!,
  clientSecret: process.env.FORTA_CLIENT_SECRET!,
  onAuthFailure: ({ reason, status, requestId, upstreamRequestId }) =>
    monitor.emit(`forta.auth.${reason}`, reason === "upstream_unavailable" ? "error" : "info", {
      requestId,
      data: { status_code: status, forta_request_id: upstreamRequestId },
    }),
});
```

## Development

```bash
npm run build   # tsc → dist/
npm test        # vitest
```

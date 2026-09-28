# Changelog

## 1.4.0

Only additive changes. Every new option is optional, and with none of them set the behaviour is the same as 1.3.0.

### Browser (`forta-js/react`)

- `createFortaApiClient` and `FortaProvider` config accept `requestId`, `requestIdHeader`, `getHeaders`, `fetch` and `onRequestFailure`.
- New exported types: `FortaRequestFailure` and `FortaRequestFailureKind`.
- Failure kinds: `network`, `timeout`, `http` (5xx), `parse`, `refresh_failed`, `grant_revoked` (reported before the 4003 redirect) and `session_check_failed`. The provider reports `session_check_failed` when its `/self` check fails for a reason other than being logged out.
- Failures include the request id that was sent and the `X-Request-ID` the server echoed.
- The provider reads callbacks through a ref, so inline callbacks never rebuild the API client or reset the refresh dedupe.

### Server (`forta-js`, `forta-js/next`)

- `FortaConfig` accepts `fetch`, `getHeaders` and `onAuthFailure`. Reasons: `missing_credential`, `token_invalid`, `token_expired`, `refresh_failed`, `upstream_unavailable`, `grant_denied`, `exchange_failed`.
- `protect`, `callbackHandler` and `fetchCurrentUser` forward the inbound `X-Request-ID`, `traceparent` and `X-Trace-ID` headers to Forta.
- `onAuthFailure` is now called where errors used to be swallowed. This covers an `/auth/self` outage that was hidden behind the refresh-then-401 path, a failed `fetchUserOnProtect`, a failed `/auth/self` after a refresh, and a failed code exchange.
- `FortaClient` methods take an optional trailing `opts?: { headers }`.
- Thrown errors keep their messages and now also carry `status` and `requestId`, the id Forta echoed (`FortaRequestError`).
- New exported types: `FortaAuthFailure`, `FortaAuthFailureReason`, `FortaCallOptions` and `FortaRequestError`.

### Tooling

- Added a vitest suite (`npm test`). Tests live in `test/` and are not published.

# API guide

The full endpoint reference is [`openapi.json`](openapi.json) (OpenAPI 3.1). It is generated from the route source and the shared zod validation schemas, and a test fails if it goes stale:

```bash
npm run docs:openapi -w apps/api     # regenerate after adding or changing routes
```

Load it into any OpenAPI viewer (Swagger UI, Redocly, Stoplight) to browse the endpoints. This page covers the conventions that apply to every endpoint.

## Base URL and versioning

All endpoints live under `/api/v1`, except the health check at `/health`. Breaking changes will go into `/api/v2`.

## Authentication

- `POST /auth/register` or `POST /auth/login` sets an opaque **`waylo_session`** cookie: HttpOnly, `SameSite=Lax`, `Secure` in production. It expires `SESSION_TTL_HOURS` (default 14 days) after sign-in.
- The database stores only the SHA-256 hash of the token. `POST /auth/logout` revokes it.
- Suspending or deleting an account revokes all of its sessions.
- Roles: `passenger`, `operator`, `partner`, `admin`.
  - Role-scoped areas: `/admin/*` and `/sandbox/*` (admin), `/partner/*` (partner), `/operator/*` (operator: owners and dispatchers manage, drivers see their own trips).
  - The role always comes from the session on the server, never from the request.
- Every route is either deliberately public (see `PUBLIC_ROUTES` in `apps/api/src/test/routes.ts`) or returns `401` to anonymous callers. `src/security/authz.test.ts` checks this for every route.

## CSRF

State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must:

- send the header `X-Waylo-Client: <any value>`. A cross-site form cannot set it, and a cross-origin script triggers a CORS preflight.
- if they send `Origin`, use one listed in `WEB_ORIGIN`.

Otherwise the response is `403 csrf_rejected`. Payment webhooks are exempt; they are verified by signature instead.

## Errors

Every error is JSON in one shape:

```json
{ "error": { "code": "validation_error", "message": "Some fields are invalid.", "details": [{ "path": "email", "message": "Enter a valid email address." }] } }
```

| Status | Typical `code` | Meaning |
|---|---|---|
| 400 | `validation_error`, `bad_request` | Input failed validation. `details` lists fields by path |
| 401 | `unauthorized` | Not signed in |
| 403 | `forbidden`, `csrf_rejected`, `partner_not_approved`, `not_onboarded` | Signed in but not allowed |
| 404 | `not_found` | Missing, or belongs to someone else. Ownership failures deliberately look like "not found" |
| 409 | `conflict`, `eligibility_failed`, `offer_unavailable`, `invalid_transition`, `admin_hold` | The request conflicts with current state |
| 410 | `offer_expired` | The offer is no longer for sale |
| 413 | `bad_request` | Body or upload too large (JSON 200 KB; uploads 5 MB; avatars 2 MB) |
| 429 | `rate_limited` | Too many requests |
| 503 | `airline_unavailable`, `maps_unavailable`, `feature_disabled` | Dependency down, or the feature is switched off by an administrator |
| 500 | `internal_error` | Unexpected. No internals are exposed; details go to the server log |

## Data conventions

- **Money** is an integer in **paise** (INR minor units). Fields end in `Minor` (`fareMinor`, `totalMinor`). Never send rupees as decimals.
- **Timestamps** are ISO 8601 in UTC (`2026-10-20T03:45:00.000Z`). **Local dates and times** for schedules are sent as separate `yyyy-mm-dd` and `HH:MM` values in the airport's time zone; the server converts them.
- **IDs** are UUID v4, except airports (IATA code), airlines (2-character designator) and human references (`WY…` bookings, `SR…` support tickets).
- **Prices from the browser are never trusted.**
  - Bookings use a server-side price lock: `POST /flights/offers/:id/validate`, then `POST /flights/bookings` with `priceLockId`. The client echoes `acceptedTotalMinor` only so a price change can be refused, never to set the price.
  - Ride prices are capped by the rider's accepted maximum and only ever go down.

## Idempotency

`POST /flights/bookings` requires an `Idempotency-Key` header (8–64 characters, unique per attempt). Retrying with the same key returns the original booking (`200`) instead of creating a second one. Payments, refunds and webhook events are idempotent on the server too.

## Rate limits

Limits are per client IP, using standard `RateLimit` headers (draft 8):

| Scope | Limit |
|---|---|
| Sign-in and registration | `AUTH_RATE_LIMIT` per 15 min (default 20) |
| All API calls | `API_RATE_LIMIT` per minute (default 300) |
| Flight search | max(30, API_RATE_LIMIT ÷ 5) per minute |
| Place search | 60 per minute |
| Ride and booking writes | max(20, API_RATE_LIMIT ÷ 10) per minute |

## Pagination

Admin list endpoints accept `limit` (1–200, default 50) and `offset`. Customer lists return the most recent items (up to 50–300 depending on the list), newest first.

## Sandbox and demo mode

`GET /meta` reports `mode`, a `demo` flag and every integration with `mode: "sandbox" | "live"`. In demo mode it also lists the public demo accounts and their shared password. In production mode it returns `null` there.

Sandbox-only endpoints: `/payments/sandbox/intents/*` (hosted test checkout) and `/sandbox/flights/:id/status` (simulate delays). They return `404` when a live integration is configured.

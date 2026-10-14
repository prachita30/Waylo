# WAYLO — Architecture

## 0. Repository audit (Phase 0, 2026-10-13)

| Item | Finding |
|---|---|
| Existing code | None — empty repository. Greenfield build. |
| Runtime | Node.js 24, npm 11 (no pnpm). |
| Database server | No local PostgreSQL or Docker available. |
| OS | Windows 11 (paths and scripts must be cross-platform). |

### Technical risks

1. **No local Postgres.** Mitigated by using **PGlite** (real PostgreSQL compiled to WASM, in-process) for local development and tests, and `node-postgres` against a managed PostgreSQL when `DATABASE_URL` is set. One schema and one set of SQL migrations serve both.
2. **Airline inventory access.** WAYLO cannot sell real seats without an airline or authorised distribution agreement. All inventory comes through the `AirlineAdapter` interface; only a clearly labelled **mock adapter** ships.
3. **Payments, maps, SMS, email, push.** Same adapter pattern, with sandbox implementations shown in the UI as **Demo mode**. Production mode refuses to start if a required live adapter is not configured.
4. **Concurrency on ride seats and flight inventory.** Handled with database transactions plus row locks (`SELECT … FOR UPDATE`) and unique constraints. PGlite is single-connection (serialised), so concurrency is also tested at the service layer.
5. **Geospatial.** PostGIS is not available in PGlite by default. Coordinates are stored as `double precision` lat/lng with B-tree indexes, and distances are computed in application code (haversine + provider route estimate). Section 6 documents the PostGIS upgrade path.

## 1. Shape: modular monolith

```
/
├── apps/
│   ├── api/          Express 5 + TypeScript REST API (/api/v1), Drizzle ORM
│   └── web/          React 19 + Vite + Tailwind v4 SPA (passenger, operator, partner, admin)
├── packages/
│   └── shared/       Zod schemas, money helpers, fare-split + matching engine, brand config
└── docs/             Architecture, checklist, API, ERD, guides
```

Domains inside `apps/api/src/modules/` (as built):

| Module | Responsibility |
|---|---|
| `meta` | Health, `/meta` (mode, integrations, feature switches), airports |
| `auth`, `users` | Registration, sessions, profile, preferences, saved destinations, avatars, account deletion |
| `flights` | Offer cache from the airline adapter, search, offer detail, anonymous search counters |
| `bookings` | Price locks, bookings, ticketing and its polling, cancellation and refund quotes |
| `payments` | Payment intents, signed webhooks, refund ledger, ride payments, operator settlements, finance admin |
| `rides` | Ride requests, place search, the matching and grouping service (`groups.ts`), flight-aware re-planning |
| `operator` | Fleet onboarding, documents, shifts, trip console, incidents |
| `partner` | Partner onboarding, routes, fares, reporting |
| `notifications`, `support` | In-app notifications, outbox delivery with retries, branded email, support tickets |
| `admin` | Review queue, admin console (users, offers and holds, bookings, rides, incidents, config, audit) |
| `analytics` | Aggregate reporting and CSV export |

Cross-cutting:

- `config`: env validation with zod.
- `db`: schema, client, migrations, seed.
- `http`: errors, validation, auth, rate limits, CSRF.
- `adapters`: airline, payments, maps, flight status, messaging. Each has a sandbox implementation.
- `lib`: audit log, logger, password hashing, settings and feature switches, domain events (`emit`/`subscribe`, delivered after commit), and the in-process job runner.

The pure engines live in `packages/shared` (fare splitting, the matching planner, geometry and money), and both apps use them. The server's result is authoritative; the web app only previews.

## 2. Key decisions

| Concern | Decision | Why |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind v4, React Router, TanStack Query, react-hook-form + zod, Radix primitives | Requested stack; accessible primitives |
| Backend | Express 5, TypeScript, zod validation, OpenAPI document generated from zod | Requested stack; one schema source |
| ORM / migrations | Drizzle ORM + drizzle-kit SQL migrations | Works with PGlite and node-postgres; plain SQL migrations under version control |
| Auth | Server-side sessions in Postgres, opaque random token in an `HttpOnly; SameSite=Lax` cookie (stored hashed). Passwords hashed with Node `scrypt`. | Revocable sessions, no JWT-in-localStorage, no native build deps |
| CSRF | SameSite cookies + mandatory `X-Waylo-Client` header and Origin check on unsafe methods | Defence in depth for cookie auth |
| Roles | `passenger`, `operator`, `partner`, `admin` — enforced only on the backend | Never trust client roles |
| Money | Integer minor units (paise) everywhere, `bigint`/`integer` columns, no floats | Requirement |
| Time | `timestamptz` in UTC; airports store IANA time zone for display | Requirement |
| Shared logic | Fare split and matching are pure functions in `packages/shared`, used by the API (authoritative) and the web app (previews only) | Testable, deterministic |
| Demo mode | `WAYLO_MODE=demo|production`. The API exposes `/api/v1/meta` with adapter modes; the UI shows a persistent banner in demo | Requirement: never silently simulate |

## 3. Module dependency graph

```
Foundation ─► Auth ─► Homepage/Nav ─► Flight search ─► Flight booking ─► Payments
                 │                                         │
                 └─► Ride requests ─► Matching ─► Maps/Pickup ─► Operator portal ─► Settlements
                                                                    │
Notifications/Support ◄────────────── (bookings, rides, operator) ──┘
Partner portal (depends on flights + auth) ─► Admin (depends on all) ─► Analytics ─► Hardening
```

## 4. Request flow (booking example)

1. Browser calls `POST /api/v1/flights/offers/:id/validate`. The API asks the airline adapter for a live price and returns a short-lived **price lock** (server-stored, signed by ID, not by client price).
2. Browser calls `POST /api/v1/flights/bookings` with the price-lock ID and an `Idempotency-Key`. The API reloads the lock, re-checks expiry and inventory in a transaction, creates the booking `pending_payment`, and creates a payment intent through the payment adapter.
3. The payment provider's webhook (signature verified, idempotent by event ID) moves the payment to `succeeded`. The booking moves to `ticketing`, and the airline adapter issues the ticket. Only an adapter-confirmed ticket moves the booking to `confirmed`.

## 5. Security baseline

- helmet, a strict CORS allow-list, rate limits on auth, search, writes and the API overall.
- zod validation on every body, query and parameter; parameterised SQL only (Drizzle).
- Audit events for privileged actions; no secrets in the web bundle.
- An authorisation matrix test over every route.

See [SECURITY.md](SECURITY.md) for the review and open risks.

## 6. Events and background work

Services emit domain events, for example booking confirmed, refund processed, group locked or driver en route, inside their transaction. Subscribers run after commit: notifications and ride payments. Periodic work runs in an in-process job runner (`lib/jobs.ts`):

- booking expiry and ticketing polls
- ride request expiry and group locking
- flight-status refresh
- refund processing and unpaid-seat release
- notification delivery

Enable it on one instance only (`RUN_JOBS`).

## 7. PostGIS upgrade path

When running on managed PostgreSQL with PostGIS:

1. Add a migration creating `geography(Point,4326)` columns generated from lat/lng, plus GiST indexes.
2. In `modules/rides/groups.ts`, replace the candidate pre-filter (currently time window and pickup zone, then haversine in code) with `ST_DWithin`.

The matching planner in `packages/shared/src/matching.ts` is unchanged.

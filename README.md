# WAYLO

Airline-authorised discounted flight offers and shared airport rides, starting with Mumbai.

> **Status: MVP, demo mode only.** Every integration (airline inventory, payments, maps, flight status,
> messaging) is a sandbox, and the app labels it on every page. No real tickets, payments or rides are
> made. Production mode refuses to start until live integrations exist. See [Known limitations](docs/LIMITATIONS.md).

## What it does

| Who | What they can do |
|---|---|
| **Travellers** | Search flights and compare fares against a *sourced* regular fare. Lock a price, book with passenger details, pay through a hosted checkout, and cancel within fare rules with a calculated refund. Request a shared ride from the airport, matched with travellers heading the same way; the price only ever drops below the maximum they accepted. Ride plans re-plan automatically when a flight is delayed. Notifications and support requests (with safety escalation) included. |
| **Fleet operators and drivers** | Onboard with documents, add vehicles and drivers, and publish shifts. Accept pre-matched groups. Run the trip from a driver console (status, pickups, drop-offs, location). Report incidents, and track earnings and settlements. |
| **Airline and distribution partners** | Apply with the airlines they are authorised to sell. Once approved, configure routes and publish fares with fare rules, eligibility, a seat cap and a sale window. See bookings (without passenger personal data), performance and an audit trail. |
| **WAYLO administrators** | Review queue (operators, drivers, vehicles, documents, partners); support desk with internal notes; incidents; bookings, rides and offers (with holds); finance (refund retries, settlements); users (suspend/reactivate); feature switches and ride rules; audit log; privacy-preserving analytics with CSV export; sandbox tools. |

## Stack

| Layer | Tech |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, react-hook-form + zod, Radix primitives |
| API | Node.js 20+, Express 5, TypeScript, zod, Drizzle ORM, pino |
| Database | PostgreSQL. Local development and tests use embedded **PGlite** (real Postgres in WASM, no install needed) |
| Tests | Vitest, React Testing Library, Supertest; Playwright specs in `e2e/` |

Monorepo layout:

- `apps/api`: REST API, background jobs, migrations.
- `apps/web`: single-page app.
- `packages/shared`: validation schemas, money, fare splitting, the matching engine and brand configuration, shared by both apps.
- `docs/`: documentation.
- `scripts/`: smoke tests, the brand audit and asset generation.

## Quick start

Requires Node.js 20.11+.

```bash
npm install
cp .env.example .env        # optional; the defaults work for local demo mode
npm run db:seed             # applies migrations and loads reference + demo data
npm run dev                 # API on :4000, web on :5173
```

Open http://localhost:5173. In demo mode the sign-in page lists the demo accounts and their shared password:

| Account | Role |
|---|---|
| `passenger@demo.waylo.app`, `rider2@…`, `rider3@…` | Travellers |
| `operator@demo.waylo.app` | Fleet owner ("WAYLO Demo Fleet": a sedan, an SUV and an accessible van) |
| `driver@demo.waylo.app` | Driver in the demo fleet |
| `partner@demo.waylo.app` | Airline partner ("Saffron Air Demo Desk", approved for sandbox airline S1) |
| `admin@demo.waylo.app` | Administrator |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) and web dev server together |
| `npm run db:migrate` / `db:seed` / `db:reset` | Apply migrations / also load reference and demo data / wipe the embedded dev database and start again |
| `npm run db:generate` | Generate a migration from `apps/api/src/db/schema.ts` |
| `npm run check` | Typecheck, lint, all tests, builds and the white-label audit: the release gate |
| `npm run audit:brand` | Check the built web app for third-party branding and source maps |
| `npm run docs:openapi -w apps/api` | Regenerate `docs/openapi.json` from the routes |
| `node scripts/smoke.mjs` (also `smoke-rides.mjs`, `smoke-trip.mjs`) | Scripted end-to-end flows against a running demo API: booking and payment, ride matching, a complete operator trip |
| `npm run test:e2e` | Playwright browser tests (needs Edge, or `E2E_CHANNEL=chrome`) |
| `npm run migrate:dist -w apps/api` / `seed:dist` / `start` | Production equivalents that run the built API |

## Documentation

- [Architecture](docs/ARCHITECTURE.md): modules, adapters, events, jobs and money handling
- [Data model (ERD)](docs/ERD.md)
- [API guide](docs/API.md) and [OpenAPI reference](docs/openapi.json)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Security review](docs/SECURITY.md)
- [Known limitations](docs/LIMITATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Implementation checklist](docs/IMPLEMENTATION_CHECKLIST.md) and [final report](docs/FINAL_REPORT.md)

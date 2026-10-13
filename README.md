# WAYLO

Airline-authorised discounted flight offers and shared airport rides, starting with Mumbai.

> **Status:** MVP in development, running in **demo mode**. Flight inventory, payments, maps and drivers
> are sandbox implementations, and the UI labels them. No real tickets or rides are booked.
> See [docs/IMPLEMENTATION_CHECKLIST.md](docs/IMPLEMENTATION_CHECKLIST.md) for progress.

## Stack

| Layer | Tech |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, react-hook-form + zod, Radix primitives |
| API | Node.js, Express 5, TypeScript, zod, Drizzle ORM, pino |
| Database | PostgreSQL. Local dev and tests use embedded **PGlite** (real Postgres in WASM, no install needed). |
| Tests | Vitest, React Testing Library, Supertest |

Monorepo layout: `apps/api`, `apps/web`, `packages/shared` (money, fare splitting, matching engine, brand config), `docs/`.

## Quick start

Requires Node.js 20.11+.

```bash
npm install
cp .env.example .env        # optional; defaults work for local demo mode
npm run db:seed             # applies migrations and loads demo data
npm run dev                 # API on :4000, web on :5173
```

Open http://localhost:5173.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) and web dev server together |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:seed` | Migrate and load reference + demo data (idempotent) |
| `npm run db:reset` | Delete the embedded dev database, migrate and seed again (refuses to touch `DATABASE_URL`) |
| `npm run db:generate` | Generate a new migration from `apps/api/src/db/schema.ts` |
| `npm run typecheck` / `lint` / `test` / `build` | Quality gates |
| `npm run check` | All of the above in order |
| `node scripts/brand-assets.mjs` | Regenerate PNG icons and the social image from the SVG mark |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation checklist](docs/IMPLEMENTATION_CHECKLIST.md)

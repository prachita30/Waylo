# Troubleshooting

## Local development

**`npm run db:seed` or `db:migrate` hangs or reports the database is in use**
The embedded PGlite database is a single-process store in `apps/api/.data/pglite`. Stop the API (`npm run dev`) before running database commands, then start it again.

**I want a clean database**
`npm run db:reset` deletes the embedded database, migrates and seeds it again. It refuses to run against `DATABASE_URL`.

**New migration, but the app shows errors about missing columns**
Run `npm run db:migrate` with the API stopped. New migrations are SQL files in `apps/api/drizzle/`.

**Port 4000 or 5173 is already in use**
Both servers use fixed ports (the web dev server proxies `/api` to `:4000`). Stop the other process, or set `PORT` for the API and update the proxy target in `apps/web/vite.config.ts`.

**Signing in with a demo account fails**
Demo accounts exist only in `WAYLO_MODE=demo` and only after `npm run db:seed`. The shared password is shown on the sign-in page in demo mode. If you changed `WAYLO_MODE`, reseed.

**No flights found**
The sandbox airline generates fares between seeded airports for dates from today up to 330 days ahead. Past dates are rejected. Check that an administrator has not switched off flight booking (Admin → Settings) or put the fares on hold (Admin → Offers).

**A request returns `403 csrf_rejected` when calling the API by hand**
Add `X-Waylo-Client: dev` to state-changing requests, and either omit `Origin` or use one listed in `WEB_ORIGIN`.

**A request returns `503 feature_disabled`**
An administrator switched the feature off in Admin → Settings.

## Windows

**Git reports "Filename too long"**
`git config core.longpaths true`.

**Imports of `@waylo/shared` fail, or React loads twice, when the project is under `AppData`**
Windows virtualises some `AppData` folders, so symlinked workspace packages resolve to two different paths. The Vite and TypeScript configs already resolve real paths, but the simplest fix is to keep the project in a normal folder such as `C:\code\waylo`.

## Tests

**A web test times out only when the whole suite runs**
Form tests type into many fields. Under heavy CPU load they can exceed the default 5 s. Run one workspace at a time (`npm test -w apps/web`), or give the test an explicit timeout as `partner.test.tsx` does.

**`OpenAPI document is up to date` fails**
You added or changed a route. Run `npm run docs:openapi -w apps/api` and commit `docs/openapi.json`.

**`route inventory` or `anonymous access` (authorisation matrix) fails**
A new route either answers anonymous callers or was not found. Protect it with `requireAuth`/`requireRole`, or, if it really is public, add it to `PUBLIC_ROUTES` in `apps/api/src/test/routes.ts` with a comment saying why.

**`npm run audit:brand` fails**
Run `npm run build` first. Remove any third-party credit from user-facing text, and make sure the build has no `.map` files (only `WAYLO_SOURCEMAPS=hidden` builds produce them).

**Playwright cannot launch a browser**
The specs default to the installed Microsoft Edge. Use `E2E_CHANNEL=chrome npm run test:e2e`, or install Playwright's Chromium (`npx playwright install chromium`) and set `E2E_CHANNEL=chromium`.

## Production

**The API exits at start-up with "sandbox-only"**
`WAYLO_MODE=production` requires live integrations. See [DEPLOYMENT.md](DEPLOYMENT.md). Use `WAYLO_MODE=demo` for a labelled demo deployment.

**The API exits with "DATABASE_URL is required" or "PAYMENT_WEBHOOK_SECRET is required"**
Both are mandatory with `NODE_ENV=production`.

**Users are signed out immediately after signing in**
The cookie is `Secure` in production, so the site must be served over HTTPS. The web app and API must also be on the same site. Behind a TLS-terminating proxy, set `TRUST_PROXY=true`.

**Notifications are sent twice, or bookings expire twice**
More than one instance is running background jobs. Set `RUN_JOBS=false` on all but one.

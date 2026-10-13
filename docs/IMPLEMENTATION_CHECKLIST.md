# WAYLO — Implementation checklist

Status keys: `[x]` done and verified · `[~]` in progress · `[ ]` not started.
Update this file at the end of every module. On resumption, continue from the first unchecked item.

## Phase 0 — Repository audit and architecture plan
- [x] Audit repository and tooling (see docs/ARCHITECTURE.md §0)
- [x] Architecture plan, decisions, dependency graph
- [x] Persistent checklist (this file)

## Phase 1 — Project foundation and design system ✅ (2026-10-13)
- [x] npm workspaces monorepo (apps/api, apps/web, packages/shared)
- [x] TypeScript strict, ESLint 10 flat config, Vitest in every package
- [x] Central brand config (packages/shared/src/brand.ts) + semantic design tokens, light/dark/system theme
- [x] Original WAYLO mark, favicon.svg, PNG app icons (incl. maskable), apple-touch icon, manifest, 1200×630 social image (scripts/brand-assets.mjs)
- [x] Procedural, original destination illustrations (DestinationArt), no external image URLs
- [x] Core UI: Button, Card, SectionHeader, Input/Select/Textarea/Checkbox/Segmented, Badge/StatusBadge, Skeleton, EmptyState, ErrorState, Notice, Dialog, ConfirmDialog, Spinner, Logo, AirportChip, RouteLine
- [x] Layout: PassengerLayout, sticky Header, mobile BottomNav, Footer, DemoBanner, skip link, branded route error page, 404
- [x] API: env validation (fails safe in production), helmet, CORS allow-list, CSRF guard, consistent JSON errors, pino logging with redaction, /health, /api/v1/meta, /api/v1/airports
- [x] Database: Drizzle + PGlite (dev/test) / node-postgres (prod); migration 0000_foundation (cities, airports, app_config, audit_events); idempotent seed; db CLI (migrate/seed/reset)
- [x] Money helpers in integer paise: splitEvenly, splitByWeights (largest remainder), applyBps, formatMoney
- [x] Verified: typecheck ✓, lint ✓, tests 21/21 ✓ (shared 7, api 9, web 5), API + web production builds ✓, rendered design page checked at desktop and 375px, light and dark, no horizontal overflow

**Environment note:** this workspace sits in a virtualised Windows folder where node_modules symlinks resolve inconsistently. Vite/Vitest configs use canonical real paths plus an explicit '@waylo/shared' alias. This is harmless on normal machines.

## Phase 2 — Authentication and user profiles ✅ (2026-10-13)
- [x] Migration 0001_identity: users (role + status enums, unique lower-cased email), sessions (hashed tokens), user_preferences, saved_destinations
- [x] scrypt password hashing (parameters stored in hash), constant-shape login errors, dummy-hash timing equalisation
- [x] Server-side sessions: opaque 256-bit token in HttpOnly SameSite=Lax cookie, only SHA-256 stored, revocable, sliding last-seen
- [x] Backend role gates (requireAuth / requireRole); client-supplied role ignored on register and profile update
- [x] Endpoints: POST /auth/register, /auth/login, /auth/logout; GET/PATCH /users/me; PUT /users/me/preferences; GET/PUT/DELETE /users/me/saved-destinations[/:cityId]; POST/DELETE /users/me/avatar; GET /avatars/:file; POST /users/me/password; DELETE /users/me
- [x] Avatar upload: 2 MB limit, magic-byte type check (PNG/JPEG/WebP), random file names, auth-only serving, traversal-safe
- [x] Account deletion: password + typed DELETE, PII erased, sessions revoked, email freed, audit event, deletionBlockers hook for active trips (used by later modules)
- [x] Rate limits: auth/sensitive endpoints per IP (AUTH_RATE_LIMIT), general API (API_RATE_LIMIT)
- [x] Demo accounts (passenger ×3, operator, driver, partner, admin), seeded only in demo mode, flagged is_demo, quick-fill on login page only when /meta advertises demo mode
- [x] Web: Login, Register (shared zod schemas), RequireAuth (role-aware), UserMenu, Account page (profile, photo, preferences, saved destinations, password, delete), Avatar/AvatarStack, Toggle, safe ?next= redirects
- [x] Tests: API 33 (auth, sessions, CSRF, rate limit, suspension, profile, uploads, password change, deletion); web 16 (pages with mocked API, redirects, role gate, open-redirect guard)
- [~] Playwright E2E suite written (e2e/auth.spec.ts, isolated API :4100 + web :5174, uses installed Edge or Chrome). **Not executed here:** the desktop app's packaged environment blocks launching Edge. Run `npm run test:e2e` on a normal machine.

## Phase 3 — Passenger homepage and navigation
## Phase 4 — Flight search and offer discovery
## Phase 5 — Flight booking workflow
## Phase 6 — Shared airport-ride requests
## Phase 7 — Ride matching and fare splitting
## Phase 8 — Maps and flight-aware pickup
## Phase 9 — Driver and fleet-operator portal
## Phase 10 — Payments, refunds and settlements
## Phase 11 — Notifications and support
## Phase 12 — Airline and inventory-partner portal
## Phase 13 — Internal administration dashboard
## Phase 14 — Analytics and business reporting
## Phase 15 — Integration testing, security review and deployment readiness

## Next action
Phase 3: passenger homepage and navigation (landing page, discovery, how it works, trust and safety, legal pages).

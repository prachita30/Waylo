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

## Phase 3 — Passenger homepage and navigation ✅ (2026-10-13)
- [x] Editorial hero ("Your next journey, for less."), tabbed SearchPanel (flight offers / shared airport ride) with validation and query-string handoff
- [x] Pinterest-style destination masonry (CSS columns) with original illustrations, tags, and save-to-wishlist heart (signed-out → sign in and return)
- [x] How it works (flights and rides), illustrative fare-split explainer computed with shared splitEvenly and labelled "Illustrative example"
- [x] Trip-idea editorial cards, trust & safety section, CTA band, footer links
- [x] Info pages: /legal/:slug (terms, privacy, refunds, safety; drafts flagged "requires legal review"), /partners, /support (help entry)
- [x] Header nav + mobile bottom nav + user menu; date helpers (IST display, UTC transport)
- [x] Tests: web 22 total (homepage sections, search validation + navigation, ride tab, wishlist auth redirect and save, legal draft notice)
- [x] Visual check at desktop width; hero search fields re-laid-out after the check (date on its own row)

## Phase 4 — Flight search and offer discovery ✅ (2026-10-13)
- [x] Migration 0002_flights: airlines (is_sandbox, brand colour), flights (one row per operation, status + estimated arrival for Phase 8, arrive>depart check), flight_offers (integer paise fares + taxes, optional sourced reference fare, baggage, refundability, change/cancel fees, fare rules, eligibility, seats_available, inventory_cap/seats_sold with check constraint, validity window, status), indexes on route/time and status/validity
- [x] AirlineAdapter interface (airlines, searchOffers) + deterministic SandboxAirlineAdapter with fictional airlines (Saffron Air S1, Monsoon Airways S2, Konkan Jet S3), last-minute ₹500–₹1,000 base fares released only within 72h (business hypothesis, labelled sandbox), sold-out cases, outage switch for tests
- [x] Production mode refuses to start with the sandbox airline (assertAdaptersAllowed)
- [x] Search service: airport-local day bounds via IANA zones, adapter results cached as offers, stale adapter offers withdrawn, partner-published offers merged, outage degrades to partner offers with a warning
- [x] Filters: max price, departure windows (local time), refundable only; sort by price / departure / duration with bookable first; pagination; flexible ±3 days (never past)
- [x] Availability: min(airline seats, partner cap − sold); limited / sold_out / insufficient-for-party / expired; savings only with a sourced reference fare
- [x] Endpoints: GET /flights/search, GET /flights/offers/:offerId (rate-limited search)
- [x] Shared time helpers (zonedTimeToUtc, zonedDayRange, localDate/Hour, haversine) with DST tests
- [x] Web: results page (compact search, flexible-date strip, filters sidebar / mobile sheet, budget slider, departure chips, sort, empty/error/degraded states, pagination), FlightCard, AirlineMark, OfferExpiry countdown, PriceBreakdown, offer detail page (itinerary, baggage, fees, rules, saving source, sandbox notice)
- [x] Tests: shared 13, API 50 (17 flight tests), web 30 (8 flight page tests); verified live in browser against the sandbox adapter

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
Phase 5: flight booking workflow (price lock/validate, passenger details, idempotent booking, payment handoff, ticketing states, cancellation).

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

## Phase 5 — Flight booking workflow ✅ (2026-10-13)
**Order adjustment:** the payment-intent and signed-webhook part of the Payments module is built here, because booking cannot complete without it. Refund execution, ride payments and settlements remain in Phase 10.
- [x] Migration 0003_bookings: price_locks (total = fare × adults check), flight_bookings (status enum, unique reference, unique price_lock_id, unique (user, idempotency_key), itinerary snapshot, ticketing retry fields, payment deadline, seats_held, refund_due), booking_passengers, payments (unique provider intent, refunded ≤ amount check), payment_events (unique provider event id)
- [x] AirlineAdapter extended: validateOffer, createOrder (idempotent hold), issueTicket, getOrder, cancelOrder; sandbox scenarios (price change, unavailable, hold failure, instant/delayed/failed ticketing; demo surnames TICKETDELAY / TICKETFAIL), unknown orders never treated as ticketed
- [x] PaymentAdapter + SandboxPaymentAdapter: intents, HMAC-SHA256 signed webhooks (timestamp tolerance), idempotent replay, refunds API ready for Phase 10; production requires PAYMENT_WEBHOOK_SECRET and refuses sandbox payments
- [x] Price lock: re-validates with the airline, ≤10 min, reports price changes, expired / sold out / provider outage handled
- [x] Booking: Idempotency-Key required, replay returns same booking, one booking per lock, consent check on accepted total (charge always from server lock), partner inventory reserved under row lock (last-seat race tested), airline hold after commit with compensation on failure
- [x] Payment outcomes applied only from verified webhooks; amount mismatch ignored; failed payment retryable within window; late payment after expiry flagged for refund
- [x] Ticketing: confirmed only on airline ticket; delayed issuance polled with backoff (background job); failure → ticketing_failed + full refund due + seats released
- [x] Background jobs: expire unpaid bookings (release seats, cancel airline hold, cancel payment), poll pending ticketing
- [x] Cancellation: fare-rule refund quote (refundable minus fee, else taxes), ≥4h before departure, airline-confirmed amount capped at paid total, audit event; account deletion blocked by processing or upcoming bookings
- [x] Endpoints: POST /flights/offers/:id/validate, POST/GET /flights/bookings, GET /flights/bookings/:id, POST /flights/bookings/:id/pay, POST /flights/bookings/:id/cancel, POST /payments/webhooks/:provider (raw body, signature), GET/POST /payments/sandbox/intents/:id[/complete]
- [x] Web: Book page (live price-lock countdown, explicit acceptance of price changes, passenger forms from shared schema, profile prefill, fare rules consent, idempotency key persisted per lock), sandbox checkout (labelled, no card fields), booking detail (live polling, timeline, PNR, tickets, retry payment, cancel with quote), My Trips (upcoming / past)
- [x] Tests: API 73 total (23 booking/payment), web 36 total; live smoke test `node scripts/smoke.mjs` passed against the dev server (search → lock → book → pay → confirmed with PNR)
- [~] Playwright spec e2e/booking.spec.ts written; not executable in this environment (see Phase 2)

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
Phase 6: shared airport-ride requests (ride request model, pickup zones, destination geocoding via maps adapter, request form, my requests).

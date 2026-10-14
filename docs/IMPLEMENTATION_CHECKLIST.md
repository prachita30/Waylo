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

## Phase 6 — Shared airport-ride requests ✅ (2026-10-13)
**Order adjustment:** the MapsAdapter (geocoding + route estimates) is introduced here because ride requests need geocoded destinations and direct-route baselines; map display and live driver tracking remain in Phase 8.
- [x] Shared rules (packages/shared/src/rides.ts): luggage capacity units (cabin 1 / medium 2 / large 3), vehicle classes (sedan 4 seats/6 units, SUV 6/10, van 8/14, accessible), acceptableVehicles, partyFits, rideRequestSchema (flight number normalisation, excess-luggage and wheelchair/vehicle rules)
- [x] MapsAdapter interface + SandboxMapsAdapter: gazetteer of Mumbai/Thane/Navi Mumbai/Goa localities and landmarks, radius-filtered search, time-of-day route/ETA estimates (road factor 1.4, peak/off-peak speeds), outage switch
- [x] Migration 0004_ride_requests: pickup_zones (seeded BOM T1/T2, GOI; flagged for on-site verification), ride_requests (flight link, booking link, scheduled + expected arrival, destination label/area/coords, direct route baseline, party, luggage by size, vehicle preference, wait/detour limits, wheelchair, notes, status), partial unique index (one active request per arrival), check constraints
- [x] Endpoints: GET /rides/service-areas, GET /places/search (server-side provider), GET /rides/flight-lookup, POST/GET /rides/requests, GET /rides/requests/:id, POST /rides/requests/:id/cancel
- [x] Rules: pickup zone must belong to the airport, arrival within −15 min…60 days, destination within 60 km, flight-linked requests use the airline schedule, linked WAYLO bookings must be confirmed and own; routing outage fails safely (503); duplicate requests rejected (incl. race via unique index)
- [x] Background job: open requests past arrival + max wait → no_match; account deletion blocked while a request is active
- [x] Web: /rides hub (explainer + my requests), /rides/new form (airport, terminal pickup with instructions, optional flight number, local arrival time, accessible destination combobox, travellers and luggage steppers, vehicle preference, wait/detour sliders, accessibility, notes, live capacity check and matching-window summary), request detail with cancel, rides in My Trips, "Share a ride" from confirmed flight bookings (prefilled)
- [x] Tests: shared 20, API 86 total (13 ride-request tests), web 41 total (5 ride tests); visual check of /rides/new against the live dev API

## Phase 7 — Ride matching and fare splitting ✅ (2026-10-13)
- [x] Fare model (packages/shared/src/fares.ts): per-class base/km/min rates, extra drop-off charge, airport access charge, tolls (provider estimate), per-seat service fee, tax in bps (flagged for tax review), disclosed waiting charge + grace; all integer paise; `splitFare` equal-per-seat or distance-weighted (largest remainder, exact sums); solo price for comparison
- [x] Deterministic matching engine (packages/shared/src/matching.ts): hard constraints checked independently of the score: max parties, same pickup zone, arrival/wait compatibility, vehicle class acceptable to all (accessibility), seats, luggage units, operator availability, per-rider detour (best drop-off order by permutation; baselines estimated at the same pickup time), sharing must beat solo price, no rider above agreed price; configurable weighted score (savings, detour, wait, occupancy); canonical ordering so results are input-order independent
- [x] Migration 0005_ride_groups: ride_groups (status lifecycle, vehicle class, capacity + taken counters with check constraint, split method, planned pickup, lock time, route, fare breakdown, platform subsidy, version), ride_participants (status, seats, luggage, solo opt-in, drop-off order, wait/detour, max agreed total, current/final price parts with `current ≤ max` check, cancellation fee), partial unique index (one active group per request)
- [x] Configurable settings in app_config `rides.settings` (fare config, weights, exit buffer, lock lead, max parties, split default, late-cancel %, full-charge window, pickup grace) with code defaults
- [x] Group service: matches (joinable forming groups ranked by score, start-new option at solo price, compatible-rider count, rejection reasons), start group (solo opt-in), join under group row lock (last seat cannot be double-sold; full vehicles lock immediately), price consent check (409 price_changed), leave before lock (free, request reopened or cancelled, remaining riders re-planned and capped at agreed price), leave after lock (25% or 100% within 30 min; others' prices unchanged; WAYLO subsidy recorded), lock (final prices ≤ agreed; lone rider without solo opt-in released as no_match), lock hook for payments (Phase 10), operator supply hook (Phase 9)
- [x] Background job: lock groups at their lock time
- [x] Endpoints: GET /rides/requests/:id/matches, POST /rides/groups, POST /rides/groups/:id/join, GET /rides/groups/:id (members/admin only), POST /rides/groups/:id/leave. Spec mapping: `/rides/matches/:matchId/join` → `/rides/groups/:groupId/join`; `/rides/:rideId/cancel` → `/rides/groups/:groupId/leave`
- [x] Privacy: co-riders see first name, avatar, area and seat count only, never contact details, surnames or exact addresses
- [x] Web: RideMatchCard (savings vs solo, seats/luggage meters, drop-off order chips, wait/detour/drop-off ETA, expandable rider + whole-vehicle price breakdown, lock time), MatchesPanel (join / start with solo opt-in, consent dialog with policy, conflict refresh), GroupPanel (members, pickup point instructions, capacity, current/final/agreed price, vehicle fare, leave with fee disclosure, status timeline), avatars made decorative next to visible names
- [x] Tests: shared 40 (fares + 15 engine tests incl. ₹1,200 ÷ 4 = ₹300, last seat, luggage, detour/incompatible destinations, accessibility, operator availability, price cap, determinism), API 97 total (11 group lifecycle tests incl. concurrent last-seat race, price guard, leave/lock/fees, privacy), web 46 total; live smoke `node scripts/smoke-rides.mjs` passed (₹1,079 → ₹591 when a second rider joined)

## Phase 8 — Maps and flight-aware pickup ✅ (2026-10-13)
- [x] FlightStatusAdapter + SandboxFlightStatusAdapter: flights run on schedule unless an admin sets a delay/cancellation (no invented disruptions); scheduled → delayed/departed/landed derived from times; outage switch
- [x] Migration 0006_flight_aware: rider readiness enum on participants (not_landed, landed, at_baggage, ready, at_pickup) + timestamp, removed_reason, ride_requests.closed_reason
- [x] Background job (2 min): refresh status for flights linked to active ride requests in the next 72h; move expected arrival; re-plan groups: pickup moves when everyone can wait (forming groups re-priced within caps; locked groups keep final prices), otherwise the late rider is removed free of charge and their request reopens; a cancelled flight releases the rider and closes the request; provider outage leaves schedules unchanged
- [x] Rider-reported readiness (POST /rides/groups/:id/readiness), visible to co-riders; WAYLO never claims baggage or exit times
- [x] Sandbox control POST /sandbox/flights/:id/status (admins only, sandbox provider only, audited)
- [x] Domain event bus (lib/events.ts) emitting flight/ride changes for Phase 11 notifications
- [x] Shared geo helpers: distance to segment/path, isOffRoute (route deviation for Phase 9 driver tracking)
- [x] Request DTO: live flight status (status, estimated arrival, delay); group DTO: per-member readiness, map points (pickup exact, drop-offs rounded to ~1 km area level)
- [x] Web: RouteMap (schematic SVG, no third-party tiles or keys, animated route, pins, figcaption text alternative listing every point), readiness selector, co-rider readiness, flight badge (On time / Delayed N min / Cancelled / Landed), delay and flight-cancelled notices
- [x] Tests: shared 44, API 105 (8 flight-aware tests: small delay moves pickup, long delay removes rider free, cancelled flight releases rider, locked prices unchanged, outage tolerated, readiness, area-level map privacy, admin-only control), web 48; live check of the group view against the dev API
- [~] Live driver tracking and driver assignment updates are implemented with the operator portal in Phase 9 (they need drivers)

## Phase 9 — Driver and fleet-operator portal ✅ (2026-10-13)
- [x] Migration 0007_operators: operators (review status, served airports, commission bps, demo flag), operator_members (owner/dispatcher/driver; one operator per user), drivers (licence last 4 only), vehicles (class, seats, luggage units, accessibility, unique registration), operator_documents (typed, expiring, reviewed), availability (shift windows, end > start), ride_trips (assignment, status timestamps, last location, off-route flag, earning/commission), trip_releases, safety_incidents; participants gain boarded/dropped-off timestamps
- [x] Operator self-registration (account type operator/partner start unapproved; admin cannot be self-assigned), onboarding, approval gates (only approved operators see offers / accept trips / schedule shifts)
- [x] Fleet: vehicles and drivers pending review, registration normalisation + uniqueness, document upload (PDF/PNG/JPEG magic-byte check, 5 MB, private to operator + admins, subject ownership enforced), shifts (approved driver + vehicle only, max 14h, no overlaps, served airports only)
- [x] Supply → matching: approved fleet capacity counts beyond 48h; within 48h a scheduled shift must cover the pickup; no supply → "No vehicle available"
- [x] Trips: offers = locked unassigned groups at served airports that the fleet can carry (seats, luggage, accessibility); accept under group row lock (first operator wins); driver double-booking guard (±2h); release before departure re-offers the trip; state machine assigned → en_route → arrived → in_progress → completed; boarded / no-show (only after planned pickup + 15 min grace; full-price fee recorded) / dropped-off; completion fixes commission and operator earning
- [x] Live location while active; off-route detection during the trip (2.5 km from planned path); riders see driver first name, vehicle, plate and last position
- [x] Incidents: riders/drivers/operators report (scoped to their rides), safety/accident/critical escalation logged
- [x] Admin review API (pending queue, approve/reject/suspend operators, drivers, vehicles, documents; audited document viewing) — UI in Phase 13
- [x] Demo fleet seed: approved "WAYLO Demo Fleet" with sedan/SUV/accessible van (fictional "DM" plates), three drivers (one linked to driver@demo), standby availability at BOM
- [x] Web: PortalLayout (sidebar + mobile bar, reusable for partner/admin), DataTable (table → stacked cards on mobile), MetricCard; operator onboarding, trips (available/active/history, accept dialog filtering approved fitting vehicles), trip console (status steps, rider actions, readiness/flight/notes, map with driver, location sharing + demo simulator, release, incident link), fleet (vehicles, drivers, documents with dialogs), shifts, earnings, incidents; rider group view shows driver, vehicle and plate; rider safety report page
- [x] Bug found and fixed while testing: supply lookup ran outside the active transaction (deadlock on single-connection PGlite; wasted pool connection on Postgres)
- [x] Tests: API 117 (12 operator tests incl. approval gates, documents privacy, accept race, driver double-booking, full trip lifecycle with grace/no-show/off-route/earnings, release, driver scoping, supply gating, incidents), web 54; live smoke `node scripts/smoke-trip.mjs` passed (lock → accept → complete, ₹915.11 earning after ₹161.49 commission)

## Phase 10 — Payments, refunds and settlements ✅ (2026-10-13)
- [x] Migration 0008_payments_refunds: refunds (unique idempotency key, status, provider refund id, attempts, positive-amount check), settlements (payout = gross − commission check), participant payment_due_at, ride_trips.settlement_id
- [x] Ride payments: groups lock into `payment_due` with a deadline (≤30 min, ≥15 min before pickup); intents created after commit via the domain event; verified webhook confirms the seat; unpaid seats released by a job (request cancelled with reason, payment cancelled, others keep prices, group cancelled if nobody paid); payment arriving after release is refunded in full
- [x] Refund ledger: idempotent by key, capped at paid − refunded − queued under a payment row lock; sources: flight cancellation (fare-rule amount), ticketing failure (full), late flight payment (full), ride leave after lock (paid − fee; unpaid seats pay no fee), rider removed by flight change/cancellation (full); no-shows are not refunded
- [x] Refund execution job → provider refund (WAYLO refund id as merchant reference) → signed refund webhook updates refund + payment (refunded / partially_refunded); provider errors mark the refund failed for review and are never retried automatically; admin retry endpoint (audited)
- [x] Settlements: admin run creates one batch per operator over completed, unsettled trips (each trip settled once), mark paid with payout reference (no money moves in the sandbox), operator view of own settlements
- [x] Endpoints: POST /rides/groups/:id/pay; GET /admin/payments, GET /admin/refunds, POST /admin/refunds/:id/retry, GET /admin/settlements, POST /admin/settlements/run, POST /admin/settlements/:id/paid, GET /operator/settlements; sandbox checkout returns a return path per purpose
- [x] Domain events now emitted for booking confirmed/ticketing failed/cancelled, group locked/dissolved, refund processed (consumed by notifications in Phase 11)
- [x] Web: ride "Pay to keep your seat" prompt with deadline, paid badge, RefundList (status shown honestly: pending until provider confirms) on bookings and rides, settlements on operator earnings, checkout returns to the right trip
- [x] Tests: API 126 (9 payment/refund/settlement tests incl. idempotency, caps, failure without auto-retry, admin retry, seat release, leaver refund minus fee, settlement once + paid), web 56; all three live smokes (`smoke`, `smoke-rides`, `smoke-trip`) passed against the dev server

## Phase 11 — Notifications and support ✅ (2026-10-13)
- [x] Migration 0009_notifications_support: notifications (in-app, read state), notification_deliveries (email/SMS/push outbox with status, attempts, backoff, provider id), support_tickets (reference SR…, category, status, priority, related booking/ride, assignee, linked incident), support_messages (customer/agent, internal notes, attachments)
- [x] MessagingAdapter (email, SMS, push) + SandboxMessagingAdapter (bounded in-memory outbox, nothing leaves the machine, failure switch); admin sandbox outbox endpoint
- [x] Branded transactional email template (WAYLO only, sandbox notice in demo, plain-text alternative, links back into the app)
- [x] Event → message mapping for flight confirmed / ticketing failed / cancelled, refund sent or needing attention, ride group confirmed (pay prompt), no co-riders, driver assigned, driver en route/at pickup/completed, pickup rescheduled, rider removed (flight delay/cancellation, no-show, payment timeout), flight now expected at…, support replies
- [x] Preferences respected per channel; SMS skipped without a mobile number; deleted accounts skipped; delivery retried 3× with backoff (1/5/15 min) then marked failed
- [x] Endpoints: GET /notifications (with unread count), POST /notifications/read (ids or all, owner-scoped); POST/GET /support/tickets, GET /support/tickets/:id, POST /support/tickets/:id/messages, POST /support/tickets/:id/close, GET /support/attachments/:messageId; admin: GET /admin/support/tickets, POST /admin/support/tickets/:id/messages (reply or internal note, status), PATCH /admin/support/tickets/:id
- [x] Support rules: booking/ride links must belong to the customer; attachments type-sniffed (PDF/PNG/JPEG, 5 MB) and private; internal notes never shown to customers; payment/refund requests high priority; safety requests urgent + linked safety incident + escalation log; customer reply reopens; closed requests accept no replies
- [x] Web: notification bell with unread badge and quick list, notifications page, support centre (new request with booking/ride prefill and attachment, emergency guidance, request list), conversation thread with attachments, reply and close; Support entry in the account menu
- [x] Tests: API 134 (8 notification/support tests incl. branded email content and absence of tool branding, preference-based channels, retry/give-up, owner-scoped read, attachment privacy, internal-note privacy, agent reply notification, safety escalation, disguised attachments), web 62

## Phase 12 — Airline and inventory-partner portal ✅ (2026-10-14)
- [x] Migrations 0010_partners (partners with requested vs authorised airlines and review status, partner_members, partner_routes) and 0011_partner_offer_fk (flight_offers.partner_id → partners)
- [x] Shared schemas: partner onboarding, partner offer (local airport times, paise, sourced reference fare, fee rules, eligibility, inventory cap, sale window), partner offer edit
- [x] Partner API (/partner/*): me, onboarding, routes (add, deactivate, reactivate), offers (list, create, edit, publish/pause/resume/withdraw), stats, bookings (no passenger personal data), audit trail
- [x] Server rules: approved partners only; airline must be authorised for that partner; route must be active in the partner's network; local times converted per airport zone; departure in the future, arrival after departure, sale closes before departure; conflicting schedule for the same flight number → 409; reference fare must be higher and sourced; edits cannot drop the cap below seats sold or the fare to or above the reference; withdrawn/expired offers are final; every action audited
- [x] Booking eligibility: max travellers per booking and minimum advance-booking hours enforced at price lock; draft offers are not visible (404) on the public offer page or at validation
- [x] Admin review extended to partners: approval authorises the requested airlines (marked sandbox in demo mode); rejection or suspension pauses the partner's live fares without touching sold bookings
- [x] Demo partner seed: partner@demo.waylo.app → "Saffron Air Demo Desk", approved for sandbox airline S1 on BOM–GOI and BOM–DEL, no offers
- [x] Web: /partner portal (overview metrics and live offers, offers table with filters, status actions, withdraw confirmation and fare/cap edit, new-offer form with rupee→paise conversion, IST sale window, saving preview only with a source, server errors on the matching field; routes; bookings; activity log), onboarding gate and pending/suspended banner; register page accepts ?as=partner|operator; partner info page links to applications
- [x] Copy fix: the partner info page no longer claims bookings are ticketed through the partner's systems
- [x] Tests: API 143 (9 partner tests), web 69 (7 partner tests); shared 44; full `npm run check` passes
- [x] Live check: demo partner portal pages rendered against the dev API; a published offer appeared in public flight search with its sourced saving; no console errors. Clicks could not be exercised because the browser pane was hidden, so the form itself is covered by the component tests
- Limitation: there is no partner fulfilment adapter yet. In demo mode the sandbox airline adapter tickets partner fares from the stored offer data; production needs each partner's own ticketing integration before partner fares can be sold
## Phase 13 — Internal administration dashboard ✅ (2026-10-14)
- [x] Migration 0012_offer_admin_hold: flight_offers.admin_hold + admin_hold_reason. Airline refreshes keep a held offer's status (SQL CASE in the upsert); partners cannot republish a held offer and see the reason
- [x] Feature switches (app_config `platform.features`): flight booking, new shared rides, partner applications, operator applications. Enforced at the server entry points (503 `feature_disabled`), shown read-only in /meta. Search, existing bookings, cancellations and refunds keep working when booking is off
- [x] Admin console API (/admin/*, admin role only): overview (live counts: users by role, last-24h bookings and ride groups by status, pending reviews, open/urgent tickets, open/critical incidents, failed refunds, failed deliveries, ticketing failures); users (search, suspend with a required reason, which revokes all sessions; reactivate; no self-suspension); offers (filters; hold with reason, release); bookings (search by reference, PNR or email); ride groups and requests; incidents (status changes, resolution note required to resolve); flights in the sandbox window; config (features; validated ride rules — scalar settings only, fare rates and weights stay at code defaults); audit search with actor email. Every write is audited
- [x] Admin review queue now includes partners; the operator Fleet page shows WAYLO's review note for rejected drivers, vehicles and documents
- [x] Web /admin portal: overview with attention cards, review queue (approve; reject with reason; open documents), support queue and agent thread (internal notes, priority, status), incidents, bookings, rides, offers (hold/release), finance (refunds with retry, payments, settlement run and record-payout with reference), users, settings (feature switches with confirmation, ride rules, integration list with sandbox/live mode), audit log with filters and paging, sandbox tools (simulate flight delay/cancellation, outbox with sandboxed email preview; hidden outside demo mode)
- [x] Shared portal layout: on phones, menus longer than five items show four plus a "More" sheet
- [x] New `.t-note` text style for sentence-case secondary text (the `.t-meta` eyebrow style is uppercase)
- [x] Tests: API 153 (10 admin console tests: role gating, real overview counts, suspension signs the user out, audit trail, offer hold survives an airline refresh, partner cannot republish a held offer, feature switches gate booking and partner onboarding, ride-rule validation, incident resolution); web 78 (8 admin tests plus a partner held-offer test); shared 44. Full `npm run check` passes. Three long partner form tests now have a 20 s timeout after one timed out under full-suite load
- [x] Live check against the dev API as the demo admin: overview, offers, settings, finance, rides, audit and sandbox pages rendered with database data and no script errors. Clicks were not exercised (browser pane hidden); interactions are covered by component tests
- Not done here: editing fare rates and matching weights; admin role changes; bulk actions
## Phase 14 — Analytics and business reporting
## Phase 15 — Integration testing, security review and deployment readiness

## Next action

Phase 14: analytics and business reporting from real aggregates — bookings and GMV over time, conversion (search → lock → booking → ticketed), ride match rate, average savings vs sourced reference fares, ride fill and subsidy, refunds, partner and operator performance — with privacy (aggregates only, minimum cohort sizes, no personal data in exports) and CSV export for admins.

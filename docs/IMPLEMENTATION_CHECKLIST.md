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

## Phase 2 — Authentication and user profiles
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
Phase 2: authentication and user profiles.

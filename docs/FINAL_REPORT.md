# WAYLO MVP: final report

**Date:** 2026-10-14 · **State:** all 16 phases (0–15) complete in demo mode · **Release gate:** `npm run check` passes

## Summary

WAYLO is a working full-stack MVP for two products in one app:

1. Discounted flight fares published by airlines or authorised partners, compared only against a sourced regular fare.
2. Shared airport rides, matched by destination and arrival time, with the price capped at what each rider agreed and only ever going down.

It has four role-specific experiences (traveller, fleet operator/driver, airline partner, administrator), a PostgreSQL schema with 14 migrations, 117 API routes, and 301 automated tests.

**Nothing in it is live.** Airline inventory, payments, maps, flight status and messaging are sandbox integrations, and the app labels them on every screen. Production mode refuses to start until real integrations replace them, and those need commercial agreements as well as code. See [LIMITATIONS.md](LIMITATIONS.md).

## What was built, by phase

| Phase | Outcome |
|---|---|
| 0 Audit and plan | Greenfield monorepo plan; PGlite chosen for local Postgres; adapter pattern for every external dependency |
| 1 Foundation | Monorepo, central brand configuration and original WAYLO assets, design system (light/dark, mobile-first), env validation, demo banner |
| 2 Auth and profiles | Hashed server-side sessions, scrypt, CSRF defence, profiles, preferences, avatars, account deletion |
| 3 Homepage | Discovery homepage, navigation, information and legal pages (drafts marked for legal review) |
| 4 Flight search | Adapter-backed offer cache, filters, flexible dates, savings shown only against a sourced reference |
| 5 Booking | Price locks, idempotent bookings, hosted sandbox checkout, signed webhooks, ticketing with delays and failures, cancellations with fare-rule refunds |
| 6–7 Rides and matching | Ride requests, deterministic matching with hard constraints and weighted scoring, fare splitting, price caps |
| 8 Maps and flight-aware pickup | Pickup zones, route maps, readiness states, automatic re-planning on delays and cancellations |
| 9 Operator portal | Fleet onboarding and documents, shifts, supply-aware matching, driver trip console, incidents |
| 10 Money | Ride payments, refund ledger driven by provider webhooks, operator settlements |
| 11 Notifications and support | In-app and outbox delivery with retries and preferences, branded email, support desk with safety escalation |
| 12 Partner portal | Partner applications and authorised airlines, routes, fare publishing with eligibility and caps, partner reporting |
| 13 Admin dashboard | Review queue, support, incidents, bookings, rides, offer holds, finance, users, feature switches, ride rules, audit log, sandbox tools |
| 14 Analytics | Aggregate-only reporting (funnel, value, sourced savings, ride match rate, fill, partner and operator performance), cohort suppression, audited CSV export |
| 15 Readiness | Authorisation matrix over every route, production fail-safe tests, OpenAPI generated from code, white-label audit, deployment, security, ERD, API and troubleshooting docs |

## Verification

| Check | Result (2026-10-14) |
|---|---|
| `npm run typecheck` / `lint` | Pass, no warnings |
| Unit and integration tests | **301 passing**: shared 44, API 178, web 79 |
| Builds | API and web build; public web build has no source maps |
| White-label audit (`npm run audit:brand`) | Pass: 97 built files, no third-party or tool branding. Rendered public pages also checked in the browser |
| Authorisation matrix | 117 routes: 11 deliberately public, all others reject anonymous callers. Role areas reject other roles. Every state-changing route rejects requests without the CSRF header or from a foreign origin. A mutation check confirmed the test catches a removed guard |
| Dependency audit | `npm audit`: 0 known vulnerabilities |
| Live smoke tests against the dev server | Pass: booking to a confirmed PNR via signed webhook; ride match with the price falling from ₹1,079 to ₹591; a complete operator trip with settlement figures |
| Browser end-to-end (Playwright) | **Not run.** The specs exist in `e2e/`, but this build environment could not launch a browser for Playwright. Pages were checked live in the in-app browser by reading rendered content; interactions are covered by component tests |

One honest note on test stability: during development, a full-suite run under heavy machine load once produced 30 API failures that did not reproduce on an immediate rerun with the same code. Three long web form tests were also given longer timeouts after a timeout under load. Every final run passed.

## What a production launch still needs

In rough order:

1. **Commercial and legal:**
   - airline or authorised-distributor agreements;
   - a payment gateway account;
   - a maps licence;
   - SMS sender (DLT) registration;
   - lawyer-reviewed Terms, Privacy and Refund policies;
   - a GST and invoicing review.
2. **Live adapters** for airline inventory and ticketing, partner fulfilment, payments, maps, flight status and messaging. Each one plugs into an existing interface under `apps/api/src/adapters/` and needs contract tests.
3. **Account security:**
   - password reset;
   - email verification;
   - MFA for administrators;
   - a deliberate first-admin bootstrap.
4. **Operations:**
   - object storage for uploads;
   - a shared rate-limit store;
   - one jobs instance (`RUN_JOBS`);
   - backups with a tested restore;
   - monitoring and alerting;
   - load testing.
5. **Assurance:**
   - run the Playwright suite in CI;
   - accessibility audit;
   - independent penetration test.

## Where to look

- Run it: [README](../README.md) · deploy it: [DEPLOYMENT.md](DEPLOYMENT.md)
- How it works: [ARCHITECTURE.md](ARCHITECTURE.md), [ERD.md](ERD.md), [API.md](API.md), [openapi.json](openapi.json)
- Risks: [SECURITY.md](SECURITY.md), [LIMITATIONS.md](LIMITATIONS.md)
- History: [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md) and the git log (one commit per phase)

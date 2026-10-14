# Known limitations

WAYLO is a working MVP in **demo mode**. This page lists what is simulated, missing or untested, so nobody mistakes the demo for a live service.

## Simulated integrations (sandbox only)

| Integration | What the sandbox does | What production needs |
|---|---|---|
| Airline inventory | Generates deterministic, labelled fares for fictional airlines (S1 Saffron Air, S2 Monsoon Airways, S3 Konkan Jet) on seeded routes; simulates price changes, sell-outs, delayed and failed ticketing | Contracts with airlines or authorised distributors (an NDC/GDS aggregator or direct APIs) and a live `AirlineAdapter` |
| Partner fares | Partners publish fares in the portal; in demo mode the sandbox airline "tickets" them from the stored offer data | A fulfilment integration per partner (or through their GDS/NDC channel). **Partner fares cannot be sold in production until this exists** |
| Payments | Hosted test checkout with signed webhooks, refunds and failure scenarios. No real money moves | A payment gateway (UPI, cards, net banking) adapter, GST-compliant invoices, settlement reconciliation |
| Maps and routing | A small place gazetteer around each airport; distances are straight-line × a road factor at assumed city speeds | Geocoding, routing and traffic-aware ETAs from a licensed maps provider |
| Flight status | Schedules from the offer data; delays and cancellations are simulated from the admin sandbox tools | A flight-status feed (airline or aggregator) |
| Messaging | Email, SMS and push are written to an in-memory outbox visible in the admin sandbox page | Email provider, SMS gateway with DLT registration (India), push service |

## Product gaps

- **Accounts:** no password reset, email verification, MFA or social sign-in. Administrator accounts cannot be created from the UI.
- **Payouts:** settlements record payouts that an administrator makes elsewhere; WAYLO does not send bank transfers.
- **Drivers:** the driver console is a web page. There is no native app, background GPS or turn-by-turn navigation. Location is shared from the browser's location service only while the console is open.
- **Admin:** fare rates and matching weights are fixed in code (`packages/shared`). There are no bulk actions, role management, or export beyond the four analytics CSVs.
- **Analytics:** search demand is counted only from migration 0013 onward. Ride metrics are verified against live demo data but have no dedicated automated test with completed trips.
- **Coverage:** shared-ride pickup zones exist at Mumbai (BOM T1 and T2), the launch city, and Goa (GOI). Flights cover 13 seeded Indian airports. English only, INR only, IST display.
- **Legal:** Terms, Privacy and Refund pages are drafts marked "Draft for review", not reviewed by a lawyer.

## Engineering gaps

- **End-to-end tests:** Playwright specs exist (`e2e/`) but have not been run. The development environment used to build WAYLO could not launch a browser for Playwright. The scripted smoke tests (`scripts/smoke*.mjs`) and component tests cover the same flows at the API and UI level. Run `npm run test:e2e` on a normal machine with Edge or Chrome (`E2E_CHANNEL=chrome`).
- **Scale:** background jobs run in-process (`RUN_JOBS` on one instance); rate limits are per instance; uploads are on local disk. No load testing has been done.
- **Accessibility:** semantic HTML, labelled controls, keyboard support, focus states, reduced-motion support and table fallbacks for charts are built in. No formal WCAG audit or screen-reader testing has been done.
- **Security:** see the open risks in [SECURITY.md](SECURITY.md). No penetration test has been done.
- **Browser support:** developed against current Chromium. Not tested on Safari or older browsers.

# Security review

An internal review carried out on 2026-10-14 as part of Phase 15. It records what is in place, how it is verified, and what is still open. It is **not** a penetration test, an audit or a compliance attestation. WAYLO makes no claim of PCI DSS, ISO 27001, SOC 2 or DPDP Act compliance.

## Controls in place, and how each is verified

| Area | Control | Verified by |
|---|---|---|
| Authentication | scrypt password hashes (N=2¹⁴, r=8); opaque session tokens, only the SHA-256 hash stored; HttpOnly, `SameSite=Lax`, `Secure` (production) cookie; sessions revoked on sign-out, password change, suspension and deletion | `auth.test.ts`, `users.test.ts`, `security/authz.test.ts` (cookie flags, hashed storage) |
| Authorisation | Every route is either on an explicit public list or rejects anonymous callers; role-scoped areas (`/admin`, `/sandbox`, `/partner`, `/operator`) reject other roles; resources are scoped to their owner and return 404 otherwise | `security/authz.test.ts` runs the full route inventory (117 routes) against anonymous, passenger, operator, partner and admin sessions. A mutation check (guard removed) produced 14 failures as expected |
| CSRF | Custom header on unsafe methods plus Origin allow-list; SameSite cookies; CORS only for configured origins | `security/authz.test.ts` (every unsafe route, without the header and from a foreign origin) |
| Input validation | zod schemas shared by client and server on every body and query; JSON bodies capped at 200 KB; uploads capped at 5 MB (avatars 2 MB), content-type sniffed from the bytes, stored outside the web root and served with `nosniff` | Module tests; the support-attachment (`notifications.test.ts`) and avatar (`users.test.ts`) tests reject disguised files |
| Business integrity | Server-side price locks; client totals are never trusted; idempotency keys; row locks on seat and fare changes; database check constraints (see [ERD](ERD.md)); webhook HMAC with timestamp tolerance and replay de-duplication; refund ledger capped at the amount paid | `bookings.test.ts`, `payments.test.ts`, `groups.test.ts` |
| Fail-safe production | Production refuses sandbox integrations, requires `DATABASE_URL` and `PAYMENT_WEBHOOK_SECRET`, never seeds demo data, and hides demo credentials from `/meta` | `meta.test.ts`, `security/production.test.ts` |
| Headers | helmet (CSP `default-src 'self'` on API responses, HSTS, `nosniff`, frame options); `x-powered-by` removed | `security/authz.test.ts` |
| Errors and logs | Generic 500 responses; pino logs redact cookies, authorization headers and password fields | `security/authz.test.ts` (malformed JSON, oversize body) |
| Rate limiting | Per-IP limits on sign-in/registration, search, place search, writes and the API overall | `auth.test.ts` (limit trips) |
| Privacy | Analytics are aggregates only, with a minimum cohort of 5 for route-level sales; partner reports exclude passenger data; account deletion anonymises the profile | `analytics.test.ts`, `partner.test.ts`, `users.test.ts` |
| Supply chain | `npm audit`: 0 known vulnerabilities (production and dev dependencies, 2026-10-14); lockfile committed | Manual run, recorded here |
| Secrets | No secrets in the repository (scanned 2026-10-14); `.env` ignored; only `.env.example` is tracked | Manual scan, recorded here |
| White-label | No third-party or tool branding in shipped files; no public source maps | `npm run audit:brand` (part of `npm run check`) |

## Changes made during this review

- **Source maps were being published** with the web build, exposing the full client source. Public builds now ship none (opt in to hidden maps with `WAYLO_SOURCEMAPS=hidden`), and the brand audit fails if any `.map` file is in `dist`.
- **Background jobs would run on every API instance** if scaled out. Added `RUN_JOBS` so exactly one instance runs them.
- Neutral names for vendor bundles (they previously revealed the UI framework in `index.html`).
- Route inventory, authorisation matrix and OpenAPI generation now share one public-route policy, so a new route cannot ship unclassified.

## Open risks and gaps

Ordered roughly by priority before a real launch:

1. **No password reset and no email verification.** A user who forgets their password cannot recover the account, and sign-up accepts any address. Both need a verified email channel (the messaging adapter is sandbox-only).
2. **No multi-factor authentication**, including for administrators. Admin accounts should require MFA before production.
3. **Account enumeration at registration.** "An account with this email already exists" confirms that an address is registered. Sign-in is uniform; registration is only rate-limited. Consider replying "check your email" once verification exists.
4. **Rate limits are in-memory and per instance.** Use a shared store behind a load balancer.
5. **Uploads are stored on local disk and not malware-scanned.** Move them to object storage with scanning, and keep them private.
6. **Web app CSP.** The API sets a CSP on its own responses. The static web app's CSP depends on the hosting configuration. `index.html` contains one small inline script (theme bootstrap) that needs a hash in a strict CSP.
7. **Admin search uses `ILIKE '%…%'`** without escaping `%` and `_`. This is admin-only, and parameterised (no injection), but broad patterns can be slow on large tables.
8. **Retention.** Bookings keep passenger names and contact details after account deletion, because they are transaction records. A written retention policy and scheduled purge are still needed.
9. **Operator and partner verification is manual.** Approval relies on an administrator checking documents. No external KYC, licence or airline-authorisation verification is integrated.
10. **No independent security testing yet.** Commission a penetration test before handling real payments or personal data at scale.

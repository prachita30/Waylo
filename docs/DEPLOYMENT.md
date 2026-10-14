# Deployment guide

WAYLO is two deployables plus a database:

| Piece | What it is | How it runs |
|---|---|---|
| Web app | Static files in `apps/web/dist` after `npm run build -w apps/web` | Any static host or CDN |
| API | Node.js 20+ service bundled to `apps/api/dist` by `npm run build -w apps/api` | `npm run start -w apps/api` |
| Database | PostgreSQL 15+ (managed service recommended) | `DATABASE_URL` |

> **Read first: production mode needs live integrations that do not exist yet.**
> Every integration in this repository (airline inventory, payments, maps, flight status, messaging) is a
> sandbox. With `WAYLO_MODE=production` the API **refuses to start** until each is replaced by a live adapter
> under `apps/api/src/adapters/*` (see the `Adapter` interfaces). Until then, deploy only in
> `WAYLO_MODE=demo`, where every screen is labelled as a simulation and nothing real is booked or charged.
> Live adapters also need commercial agreements, for example airline or distributor authorisation, a payment
> gateway account and a maps licence. Those are business prerequisites, not code.

## 1. Topology

Serve the web app and the API from the **same site** so the session cookie (HttpOnly, `SameSite=Lax`, `Secure`) is sent with API calls. The simplest layout is one hostname with a reverse proxy:

```
https://app.example.in/          → static files (apps/web/dist), SPA fallback to index.html
https://app.example.in/api/      → API (Node, port 4000)
https://app.example.in/health    → API health check
```

Example nginx server block:

```nginx
server {
  listen 443 ssl http2;
  server_name app.example.in;
  # ssl_certificate / ssl_certificate_key …

  client_max_body_size 6m;            # the API caps uploads at 5 MB (avatars 2 MB)

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location = /health { proxy_pass http://127.0.0.1:4000; }

  root /srv/waylo/web;                 # contents of apps/web/dist
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }
}
```

Behind a proxy that terminates TLS, set `TRUST_PROXY=true` so rate limiting sees client IPs.

## 2. Configuration

All configuration is environment variables, validated at start-up (`apps/api/src/config.ts`). An invalid value stops the process with a message naming the variable. Template: [`.env.example`](../.env.example).

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables secure cookies and the checks below |
| `WAYLO_MODE` | `production` once live adapters exist; `demo` until then | `production` refuses sandbox integrations |
| `DATABASE_URL` | `postgres://…?sslmode=require` | **Required** in production; PGlite is development-only |
| `PAYMENT_WEBHOOK_SECRET` | 32+ random characters from your secret manager | **Required** in production |
| `WEB_ORIGIN` | `https://app.example.in` (comma-separated if several) | Used for CORS and the CSRF origin check |
| `PORT` | `4000` | |
| `TRUST_PROXY` | `true` behind a load balancer | |
| `COOKIE_SECURE` | leave unset (defaults to `true` in production) | |
| `SESSION_TTL_HOURS` | `336` (14 days) or shorter | |
| `UPLOAD_DIR` | a persistent volume path, e.g. `/var/lib/waylo/uploads` | Holds operator documents, support attachments, avatars |
| `RUN_JOBS` | `true` on exactly one instance, `false` on the others | Background jobs run in-process |
| `AUTH_RATE_LIMIT` / `API_RATE_LIMIT` | `20` / `300` | Per IP; in-memory per instance |
| `LOG_LEVEL` | `info` | JSON logs on stdout; cookies and passwords are redacted |

Never commit `.env`. Keep secrets in the platform's secret store.

## 3. Build and release

```bash
npm ci
npm run check                 # typecheck, lint, all tests, builds, white-label audit
```

Release steps, in order:

1. **Migrate** the database (safe to run repeatedly; migrations are forward-only SQL in `apps/api/drizzle`):
   ```bash
   npm run migrate:dist -w apps/api
   ```
2. **Reference data** (cities, airports, pickup zones, default config). In production mode no demo accounts, partners or fleets are created:
   ```bash
   npm run seed:dist -w apps/api
   ```
3. **Start the API** (`npm run start -w apps/api`) and wait for `GET /health` to return `{"status":"ok","db":true}`.
4. **Publish the web app**: upload `apps/web/dist` to the static host. Hashed assets can be cached forever; `index.html` must not be cached.

The public web build contains no source maps. To give an error tracker source maps, build with `WAYLO_SOURCEMAPS=hidden` and upload the `.map` files to the tracker. Do not deploy them to the web root (`npm run audit:brand` fails if they are there).

### Containers

No Dockerfile is included. A starting point for an API image (a sketch: it has not been built or tested in this repository):

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false
COPY apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
```

Build `apps/api/dist` in CI first. The shared package is bundled into the API build, so it is not needed at runtime.

## 4. Operations

- **Health:** `GET /health` returns 200 with `db: true`, or 503 when the database is unreachable. Use it for load balancer checks.
- **Scaling:** the API is stateless apart from three things:
  1. `UPLOAD_DIR` must be shared storage, or a single instance. Moving uploads to object storage is a follow-up.
  2. Background jobs must run on one instance (`RUN_JOBS`).
  3. Rate-limit counters are per instance. Put a shared limiter (for example Redis-backed) in front for strict limits.
- **Background jobs** (every 10–120 s): unpaid booking expiry, ticketing polls, ride request expiry, group locking, flight-status refresh, refund processing, unpaid-seat release, and notification delivery with retries.
- **Backups:** enable point-in-time recovery on the managed database, and back up `UPLOAD_DIR`. Test a restore before launch.
- **Logs:** pino JSON on stdout, with request ids from pino-http. Ship them to your log platform. Audit events are stored in the `audit_events` table, not just in logs.
- **Shutdown:** `SIGTERM` stops jobs, closes the HTTP server and closes the database pool.
- **Time:** all timestamps are stored in UTC. The home market (Mumbai) is displayed in IST.

## 5. Launch checklist

- [ ] Live adapters implemented, contract-tested and reviewed for airline, payments, maps, flight status and messaging; `WAYLO_MODE=production` starts cleanly.
- [ ] Commercial authorisations in place: airline or distributor agreements for every airline code you approve partners for; payment gateway; maps licence; SMS and email sender registration (DLT in India).
- [ ] Legal review of the Terms, Privacy and Refund pages (`/legal/*`). They are marked "Draft for review" in the app and have not been reviewed by a lawyer.
- [ ] `PAYMENT_WEBHOOK_SECRET` and `DATABASE_URL` stored in the secret manager; TLS on every hop that carries them.
- [ ] Exactly one instance with `RUN_JOBS=true`.
- [ ] Persistent, backed-up `UPLOAD_DIR`; database PITR enabled; restore tested.
- [ ] First administrator account created deliberately. Demo accounts do not exist in production mode. Create the admin with a one-off SQL update of an ordinary registration, or with a small admin CLI (not yet included).
- [ ] An independent security review or penetration test. The in-repo review in [SECURITY.md](SECURITY.md) is not a substitute.

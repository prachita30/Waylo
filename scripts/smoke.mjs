// End-to-end smoke test against a running WAYLO API in demo mode.
// Usage: node scripts/smoke.mjs [baseUrl] [origin]
// Defaults: http://localhost:4000 and http://localhost:5173 (must be an allowed WEB_ORIGIN).
const BASE = process.argv[2] ?? 'http://localhost:4000';
const ORIGIN = process.argv[3] ?? 'http://localhost:5173';

let cookie = '';
async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Waylo-Client': 'smoke', Origin: ORIGIN, Cookie: cookie, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const step = (msg) => console.log(`✓ ${msg}`);
const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

const meta = await call('GET', '/meta');
if (!meta.demoLogin) throw new Error('API is not in demo mode; refusing to run the smoke test.');
await call('POST', '/auth/login', { email: 'passenger@demo.waylo.app', password: meta.demoLogin.password });
step('signed in as demo passenger');

const search = await call('GET', `/flights/search?from=BOM&to=GOI&date=${date}&adults=1`);
const offer = search.items.find((o) => o.availability === 'available' || o.availability === 'limited');
if (!offer) throw new Error('no bookable offer');
step(`search returned ${search.total} offers; picked ${offer.flightNumber} at ₹${offer.farePerAdultMinor / 100}`);

const { lock } = await call('POST', `/flights/offers/${offer.id}/validate`, { adults: 1 });
step(`price locked until ${lock.expiresAt}`);

const key = `smoke-${Date.now()}`;
const created = await call(
  'POST',
  '/flights/bookings',
  { priceLockId: lock.id, passengers: [{ firstName: 'Smoke', lastName: 'Test' }], contact: { email: 'smoke@example.com' }, acceptedTotalMinor: lock.totalMinor, acceptFareRules: true },
  { 'Idempotency-Key': key },
);
step(`booking ${created.booking.reference} created (${created.booking.status})`);

const intentId = created.checkoutUrl.split('/').pop();
await call('POST', `/payments/sandbox/intents/${intentId}/complete`, { outcome: 'succeed' });
step('sandbox payment completed (applied via signed webhook)');

let booking;
for (let i = 0; i < 10; i++) {
  booking = (await call('GET', `/flights/bookings/${created.booking.id}`)).booking;
  if (booking.status !== 'ticketing') break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (booking.status !== 'confirmed') throw new Error(`expected confirmed, got ${booking.status}`);
step(`booking confirmed with PNR ${booking.pnr}`);
console.log('\nSmoke test passed.');

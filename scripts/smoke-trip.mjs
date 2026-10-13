// Operator trip smoke test against a running WAYLO API in demo mode: two parties fill a sedan
// (which locks it), the demo operator accepts, and the demo driver completes the trip.
// Usage: node scripts/smoke-trip.mjs [baseUrl] [origin]
const BASE = process.argv[2] ?? 'http://localhost:4000';
const ORIGIN = process.argv[3] ?? 'http://localhost:5173';

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Waylo-Client': 'smoke', Origin: ORIGIN, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
}
const step = (m) => console.log(`✓ ${m}`);
const rupees = (m) => `₹${(m / 100).toFixed(2)}`;

const meta = await client()('GET', '/meta');
if (!meta.demoLogin) throw new Error('API is not in demo mode; refusing to run.');
const pw = meta.demoLogin.password;
const [a, b, owner, driver] = [client(), client(), client(), client()];
await a('POST', '/auth/login', { email: 'rider2@demo.waylo.app', password: pw });
await b('POST', '/auth/login', { email: 'rider3@demo.waylo.app', password: pw });
await owner('POST', '/auth/login', { email: 'operator@demo.waylo.app', password: pw });
await driver('POST', '/auth/login', { email: 'driver@demo.waylo.app', password: pw });
step('signed in two riders, the demo operator and the demo driver');

const zone = (await a('GET', '/rides/service-areas')).items.find((x) => x.code === 'BOM').zones.find((z) => z.terminal === 'T2');
const arrival = new Date(Date.now() + (20 + Math.floor(Math.random() * 200)) * 60_000);
arrival.setUTCSeconds(0, 0);
const req = async (c, q) =>
  (
    await c('POST', '/rides/requests', {
      airport: 'BOM',
      pickupZoneId: zone.id,
      arrivalAt: arrival.toISOString(),
      destination: (await c('GET', `/places/search?q=${q}&airport=BOM`)).items[0],
      passengers: 2,
      luggage: { cabin: 1, medium: 0, large: 0 },
      vehiclePreference: 'sedan',
      maxWaitMinutes: 30,
      maxDetourMinutes: 25,
      wheelchair: false,
    })
  ).request;
const ra = await req(a, 'colaba');
const rb = await req(b, 'churchgate');
const ma = await a('GET', `/rides/requests/${ra.id}/matches`);
const g = (await a('POST', '/rides/groups', { requestId: ra.id, soloOk: false, acceptedMaxTotalMinor: ma.newGroup.you.price.totalMinor })).group;
const opt = (await b('GET', `/rides/requests/${rb.id}/matches`)).groups.find((x) => x.groupId === g.id);
await b('POST', `/rides/groups/${g.id}/join`, { requestId: rb.id, acceptedMaxTotalMinor: opt.you.price.totalMinor });
const locked = (await a('GET', `/rides/groups/${g.id}`)).group;
if (locked.status !== 'locked') throw new Error(`expected locked, got ${locked.status}`);
step(`sedan filled (4/4 seats) and locked; rider A pays ${rupees(locked.me.finalTotalMinor)}`);

const offers = (await owner('GET', '/operator/trips?tab=offers')).items;
if (!offers.some((o) => o.groupId === g.id)) throw new Error('trip not offered to the demo operator');
const fleet = await owner('GET', '/operator/fleet');
const d = fleet.drivers.find((x) => x.fullName === 'Demo Driver');
const v = fleet.vehicles.find((x) => x.vehicleClass === 'sedan');
const accepted = (await owner('POST', `/operator/trips/${g.id}/accept`, { driverId: d.id, vehicleId: v.id })).trip;
step(`operator accepted: ${accepted.driver.name}, ${accepted.vehicle.registration}, estimated earning ${rupees(accepted.estimatedEarningMinor)}`);
const seen = (await a('GET', `/rides/groups/${g.id}`)).group.trip;
step(`rider sees driver ${seen.driverFirstName} in ${seen.vehicle.colour} ${seen.vehicle.makeModel} (${seen.vehicle.registration})`);

await driver('POST', `/operator/trips/${g.id}/status`, { status: 'en_route' });
await driver('POST', `/operator/trips/${g.id}/location`, { lat: 19.08, lng: 72.87 });
await driver('POST', `/operator/trips/${g.id}/status`, { status: 'arrived' });
let trip = (await driver('GET', `/operator/trips/${g.id}`)).trip;
for (const r of trip.riders) await driver('POST', `/operator/trips/${g.id}/riders/${r.participantId}`, { action: 'boarded' });
await driver('POST', `/operator/trips/${g.id}/status`, { status: 'in_progress' });
step('driver en route → arrived → both parties boarded → trip started');
trip = (await driver('GET', `/operator/trips/${g.id}`)).trip;
for (const r of [...trip.riders].sort((x, y) => x.dropoffOrder - y.dropoffOrder)) {
  trip = (await driver('POST', `/operator/trips/${g.id}/riders/${r.participantId}`, { action: 'dropped_off' })).trip;
}
if (trip.status !== 'completed') throw new Error(`expected completed, got ${trip.status}`);
step(`trip completed; operator earned ${rupees(trip.earningMinor)} after ${rupees(trip.commissionMinor)} commission`);
console.log('\nTrip smoke test passed.');

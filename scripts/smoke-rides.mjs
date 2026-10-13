// Shared-ride smoke test against a running WAYLO API in demo mode: two demo riders request
// rides to nearby areas, one starts a group, the other joins, and both see lower prices.
// Usage: node scripts/smoke-rides.mjs [baseUrl] [origin]
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
const rupees = (m) => `₹${(m / 100).toFixed(0)}`;

const meta = await client()('GET', '/meta');
if (!meta.demoLogin) throw new Error('API is not in demo mode; refusing to run.');
const a = client();
const b = client();
await a('POST', '/auth/login', { email: 'rider2@demo.waylo.app', password: meta.demoLogin.password });
await b('POST', '/auth/login', { email: 'rider3@demo.waylo.app', password: meta.demoLogin.password });
step('signed in two demo riders');

const areas = await a('GET', '/rides/service-areas');
const zone = areas.items.find((x) => x.code === 'BOM').zones.find((z) => z.terminal === 'T2');
// A unique arrival minute keeps reruns from colliding with earlier smoke requests.
const arrival = new Date(Date.now() + 2 * 86_400_000);
arrival.setUTCSeconds(0, 0);
arrival.setUTCMinutes(Math.floor(Math.random() * 50));
const placeA = (await a('GET', '/places/search?q=colaba&airport=BOM')).items[0];
const placeB = (await b('GET', '/places/search?q=churchgate&airport=BOM')).items[0];
const body = (place) => ({
  airport: 'BOM',
  pickupZoneId: zone.id,
  arrivalAt: arrival.toISOString(),
  destination: place,
  passengers: 1,
  luggage: { cabin: 1, medium: 0, large: 0 },
  vehiclePreference: 'any',
  maxWaitMinutes: 30,
  maxDetourMinutes: 20,
  wheelchair: false,
});
const ra = (await a('POST', '/rides/requests', body(placeA))).request;
const rb = (await b('POST', '/rides/requests', body(placeB))).request;
step(`requests created: ${ra.destination.area} and ${rb.destination.area}`);

const ma = await a('GET', `/rides/requests/${ra.id}/matches`);
step(`rider A alone would pay ${rupees(ma.newGroup.you.price.totalMinor)}; ${ma.compatibleOpenRequests} compatible rider(s) waiting`);
const g = (await a('POST', '/rides/groups', { requestId: ra.id, soloOk: false, acceptedMaxTotalMinor: ma.newGroup.you.price.totalMinor })).group;
step(`group ${g.id.slice(0, 8)} started (${g.vehicleClass})`);

const mb = await b('GET', `/rides/requests/${rb.id}/matches`);
const opt = mb.groups.find((x) => x.groupId === g.id);
if (!opt) throw new Error('rider B was not offered the group');
await b('POST', `/rides/groups/${g.id}/join`, { requestId: rb.id, acceptedMaxTotalMinor: opt.you.price.totalMinor });
step(`rider B joined for ${rupees(opt.you.price.totalMinor)} (saves ${opt.you.savingsPercent}% vs ${rupees(opt.you.solo.totalMinor)} alone)`);

const after = (await a('GET', `/rides/groups/${g.id}`)).group;
if (after.me.price.totalMinor >= after.me.maxTotalMinor) throw new Error('rider A price did not drop');
step(`rider A's price dropped from ${rupees(after.me.maxTotalMinor)} to ${rupees(after.me.price.totalMinor)}`);

await b('POST', `/rides/groups/${g.id}/leave`, { cancelRequest: true });
await a('POST', `/rides/groups/${g.id}/leave`, { cancelRequest: true });
step('both riders left (free before lock); group cleaned up');
console.log('\nRide smoke test passed.');

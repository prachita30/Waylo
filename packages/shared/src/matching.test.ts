import { describe, expect, it } from 'vitest';
import { DEFAULT_FARE_CONFIG, passengerPrice, splitFare, vehicleFare } from './fares';
import { DEFAULT_MATCH_OPTIONS, type GroupPlan, haversineEstimator, type MatchOptions, type MatchRider, planGroup } from './matching';

// Fixed off-peak instant (14:00 IST) so estimates are stable.
const T0 = Date.parse('2026-10-20T08:30:00Z');
const MIN = 60_000;
const PICKUP = { lat: 19.0988, lng: 72.8742 }; // BOM T2
const PLACES = {
  colaba: { lat: 18.9067, lng: 72.8147 },
  churchgate: { lat: 18.9322, lng: 72.8264 },
  fort: { lat: 18.9345, lng: 72.8356 },
  marineLines: { lat: 18.9447, lng: 72.8235 },
  borivali: { lat: 19.2307, lng: 72.8567 },
  vashi: { lat: 19.0771, lng: 72.9986 },
};
const est = haversineEstimator();
const opts: MatchOptions = { ...DEFAULT_MATCH_OPTIONS, pickup: PICKUP, estimate: est };

function rider(id: string, dest: keyof typeof PLACES, over: Partial<MatchRider> = {}): MatchRider {
  const d = est(PICKUP, PLACES[dest], T0);
  return {
    id,
    pickupZoneId: 'zone-t2',
    arrivalAt: T0,
    maxWaitMinutes: 20,
    maxDetourMinutes: 15,
    passengers: 1,
    luggage: { cabin: 1, medium: 1, large: 0 },
    vehiclePreference: 'any',
    wheelchair: false,
    destination: PLACES[dest],
    directDistanceMeters: d.distanceMeters,
    directDurationSeconds: d.durationSeconds,
    ...over,
  };
}

const ok = (r: ReturnType<typeof planGroup>) => {
  if (!r.ok) throw new Error(`expected a plan, got ${r.violations.join(', ')}`);
  return r as GroupPlan;
};

describe('fare model', () => {
  it('prices a vehicle from base, distance, time, extra stops and airport access', () => {
    const f = vehicleFare('sedan', { distanceMeters: 28_000, durationSeconds: 70 * 60, dropoffs: 3 });
    expect(f.distanceMinor).toBe(28 * 1_800);
    expect(f.timeMinor).toBe(70 * 150);
    expect(f.extraStopsMinor).toBe(2 * 5_000);
    expect(f.totalMinor).toBe(15_000 + 50_400 + 10_500 + 10_000 + 15_000);
  });

  it('splits ₹1,200 equally across four seats (the product brief example)', () => {
    const s = splitFare(120_000, ['a', 'b', 'c', 'd'].map((id) => ({ id, seats: 1, directDistanceMeters: 10_000 })), 'equal_per_seat');
    expect([...s.values()]).toEqual([30_000, 30_000, 30_000, 30_000]);
  });

  it('charges a party of two two shares and always sums exactly', () => {
    const s = splitFare(100_001, [
      { id: 'a', seats: 2, directDistanceMeters: 10_000 },
      { id: 'b', seats: 1, directDistanceMeters: 10_000 },
    ], 'equal_per_seat');
    expect(s.get('a')).toBe(66_667);
    expect(s.get('b')).toBe(33_334);
    expect(s.get('a')! + s.get('b')!).toBe(100_001);
  });

  it('weights by distance when the group agreed to it', () => {
    const s = splitFare(90_000, [
      { id: 'near', seats: 1, directDistanceMeters: 10_000 },
      { id: 'far', seats: 1, directDistanceMeters: 20_000 },
    ], 'distance_weighted');
    expect(s.get('near')).toBe(30_000);
    expect(s.get('far')).toBe(60_000);
  });

  it('adds the per-seat service fee and tax', () => {
    const p = passengerPrice(30_000, 1);
    expect(p.platformFeeMinor).toBe(DEFAULT_FARE_CONFIG.platformFeePerSeatMinor);
    expect(p.taxMinor).toBe(Math.round((30_000 + 4_900) * 0.05));
    expect(p.totalMinor).toBe(30_000 + 4_900 + p.taxMinor);
  });
});

describe('matching engine: compatible groups', () => {
  it('groups riders to nearby South Mumbai destinations and everyone saves', () => {
    const light = { luggage: { cabin: 1, medium: 0, large: 0 } };
    const plan = ok(planGroup([rider('a', 'colaba', light), rider('b', 'churchgate', light), rider('c', 'fort', light)], opts));
    expect(plan.vehicleClass).toBe('sedan');
    expect(plan.seatsUsed).toBe(3);
    for (const m of Object.values(plan.members)) {
      expect(m.price.totalMinor).toBeLessThan(m.solo.totalMinor);
      expect(m.detourMinutes).toBeLessThanOrEqual(15);
    }
    const sum = Object.values(plan.members).reduce((s, m) => s + m.price.fareShareMinor, 0);
    expect(sum).toBe(plan.fare.totalMinor);
    expect(plan.score).toBeGreaterThan(0);
    expect(plan.score).toBeLessThanOrEqual(1);
  });

  it('is deterministic regardless of input order', () => {
    const a = planGroup([rider('a', 'colaba'), rider('b', 'churchgate'), rider('c', 'fort')], opts);
    const b = planGroup([rider('c', 'fort'), rider('a', 'colaba'), rider('b', 'churchgate')], opts);
    expect(a).toEqual(b);
  });

  it('orders drop-offs to minimise total time', () => {
    const plan = ok(planGroup([rider('far', 'colaba'), rider('near', 'marineLines')], opts));
    expect(plan.order).toEqual(['near', 'far']);
    expect(plan.members.near!.dropoffOrder).toBe(1);
  });

  it('upgrades to an SUV when luggage needs it', () => {
    const plan = ok(planGroup([rider('a', 'colaba', { luggage: { cabin: 0, medium: 0, large: 2 } }), rider('b', 'churchgate', { luggage: { cabin: 0, medium: 0, large: 1 } })], opts));
    expect(plan.vehicleClass).toBe('suv');
    expect(plan.luggageUsed).toBe(9);
  });
});

describe('matching engine: hard constraints', () => {
  it('rejects incompatible destinations through the detour limit', () => {
    const r = planGroup([rider('a', 'colaba'), rider('b', 'borivali')], opts);
    expect(r).toEqual({ ok: false, violations: ['detour'] });
  });

  it('rejects arrivals beyond someone’s waiting limit', () => {
    const r = planGroup([rider('early', 'colaba', { maxWaitMinutes: 15 }), rider('late', 'churchgate', { arrivalAt: T0 + 40 * MIN })], opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('arrival_window');
  });

  it('rejects different pickup zones', () => {
    const r = planGroup([rider('a', 'colaba'), rider('b', 'churchgate', { pickupZoneId: 'zone-t1' })], opts);
    if (!r.ok) expect(r.violations).toContain('different_pickup');
    else throw new Error('should fail');
  });

  it('enforces seat capacity (last seat)', () => {
    const full = [rider('a', 'colaba', { passengers: 3 }), rider('b', 'churchgate', { passengers: 3 }), rider('c', 'fort', { passengers: 2 })];
    expect(ok(planGroup(full, opts)).vehicleClass).toBe('van');
    const over = [...full, rider('d', 'marineLines')];
    const r = planGroup(over, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('seats');
  });

  it('enforces luggage capacity independently of seats', () => {
    const heavy = (id: string, d: keyof typeof PLACES) => rider(id, d, { luggage: { cabin: 0, medium: 0, large: 3 } });
    const r = planGroup([heavy('a', 'colaba'), heavy('b', 'churchgate'), heavy('c', 'fort'), heavy('d', 'marineLines')], opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('luggage');
  });

  it('requires a vehicle class everyone accepts', () => {
    const r = planGroup([rider('a', 'colaba', { vehiclePreference: 'sedan' }), rider('b', 'churchgate', { vehiclePreference: 'suv' })], opts);
    expect(r).toEqual({ ok: false, violations: ['vehicle'] });
  });

  it('routes wheelchair users only into accessible vans', () => {
    const plan = ok(planGroup([rider('a', 'colaba', { wheelchair: true }), rider('b', 'churchgate')], opts));
    expect(plan.vehicleClass).toBe('van');
  });

  it('respects operator availability', () => {
    const r = planGroup([rider('a', 'colaba')], { ...opts, availableClasses: ['van'] });
    expect(ok(r).vehicleClass).toBe('van');
    const none = planGroup([rider('a', 'colaba')], { ...opts, availableClasses: [] });
    expect(none).toEqual({ ok: false, violations: ['operator_unavailable'] });
  });

  it('never raises a member above the price they agreed to', () => {
    const base = ok(planGroup([rider('a', 'colaba'), rider('b', 'churchgate')], opts));
    const agreed = base.members.a!.price.totalMinor;
    // A third rider whose detour makes the route costlier per head for "a" is rejected by the cap.
    const r = planGroup([rider('a', 'colaba', { maxTotalMinor: agreed - 50_000 }), rider('b', 'churchgate'), rider('c', 'fort')], opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('price_cap');
  });

  it('limits the number of parties per vehicle', () => {
    const five = (['colaba', 'churchgate', 'fort', 'marineLines', 'colaba'] as const).map((d, i) => rider(`r${i}`, d));
    const r = planGroup(five, opts);
    if (!r.ok) expect(r.violations).toContain('too_many_parties');
    else throw new Error('should fail');
  });

  it('a single rider gets a solo plan with no saving', () => {
    const plan = ok(planGroup([rider('solo', 'vashi')], opts));
    expect(plan.members.solo!.savingsPercent).toBe(0);
    expect(plan.members.solo!.price.totalMinor).toBe(plan.members.solo!.solo.totalMinor);
  });
});

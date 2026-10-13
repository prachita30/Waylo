import { describe, expect, it } from 'vitest';
import { acceptableVehicles, luggageUnits, partyFits, rideRequestSchema } from './rides';

const valid = {
  airport: 'BOM',
  pickupZoneId: '6f1c2c1e-8b1a-4c1e-9a1e-1c1e8b1a4c1e',
  flightNumber: '6e 5321',
  arrivalAt: '2026-10-20T16:40:00+05:30',
  destination: { placeId: 'sbx:colaba', label: 'Colaba Causeway, Colaba', area: 'Colaba', lat: 18.915, lng: 72.825 },
  passengers: 2,
  luggage: { cabin: 2, medium: 1, large: 1 },
  vehiclePreference: 'any' as const,
  maxWaitMinutes: 20,
  maxDetourMinutes: 15,
  wheelchair: false,
};

describe('ride capacity rules', () => {
  it('counts luggage units by size', () => {
    expect(luggageUnits({ cabin: 2, medium: 1, large: 1 })).toBe(7);
  });

  it('restricts wheelchair trips to accessible vehicles', () => {
    expect(acceptableVehicles('any', true)).toEqual(['van']);
    expect(acceptableVehicles('sedan', true)).toEqual([]);
    expect(acceptableVehicles('suv', false)).toEqual(['suv']);
  });

  it('checks a party fits at least one vehicle', () => {
    expect(partyFits(4, { cabin: 4, medium: 1, large: 0 }, ['sedan'])).toBe(true);
    expect(partyFits(4, { cabin: 0, medium: 0, large: 3 }, ['sedan'])).toBe(false);
    expect(partyFits(4, { cabin: 0, medium: 0, large: 3 }, ['sedan', 'suv'])).toBe(true);
  });
});

describe('rideRequestSchema', () => {
  it('normalises the flight number', () => {
    expect(rideRequestSchema.parse(valid).flightNumber).toBe('6E5321');
  });

  it('rejects excess luggage for a single party', () => {
    const r = rideRequestSchema.safeParse({ ...valid, passengers: 6, luggage: { cabin: 0, medium: 0, large: 6 } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['luggage']);
  });

  it('rejects wheelchair + sedan', () => {
    const r = rideRequestSchema.safeParse({ ...valid, wheelchair: true, vehiclePreference: 'sedan' });
    expect(r.error?.issues[0]?.path).toEqual(['vehiclePreference']);
  });

  it('bounds waiting and detour limits', () => {
    expect(rideRequestSchema.safeParse({ ...valid, maxWaitMinutes: 120 }).success).toBe(false);
    expect(rideRequestSchema.safeParse({ ...valid, maxDetourMinutes: 2 }).success).toBe(false);
  });
});

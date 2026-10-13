import { describe, expect, it } from 'vitest';
import { addDays, haversineKm, localDate, localHour, zonedDayRange, zonedTimeToUtc } from './time';

describe('time zones', () => {
  it('converts IST wall time to UTC', () => {
    expect(zonedTimeToUtc('2026-10-14', '06:10', 'Asia/Kolkata').toISOString()).toBe('2026-10-14T00:40:00.000Z');
  });

  it('computes local day bounds', () => {
    const { start, end } = zonedDayRange('2026-10-14', 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-10-13T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  });

  it('handles DST zones', () => {
    // London switches to GMT on 2026-10-25.
    expect(zonedTimeToUtc('2026-10-24', '12:00', 'Europe/London').toISOString()).toBe('2026-10-24T11:00:00.000Z');
    expect(zonedTimeToUtc('2026-10-26', '12:00', 'Europe/London').toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });

  it('reads local date and hour', () => {
    const t = new Date('2026-10-13T20:00:00Z');
    expect(localDate(t, 'Asia/Kolkata')).toBe('2026-10-14');
    expect(localHour(t, 'Asia/Kolkata')).toBe(1);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('measures BOM–GOI distance', () => {
    const km = haversineKm({ lat: 19.0896, lng: 72.8656 }, { lat: 15.3808, lng: 73.8314 });
    expect(km).toBeGreaterThan(400);
    expect(km).toBeLessThan(440);
  });
});

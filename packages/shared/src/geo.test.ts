import { describe, expect, it } from 'vitest';
import { distanceToPathMeters, distanceToSegmentMeters, isOffRoute } from './geo';

const BOM = { lat: 19.0988, lng: 72.8742 };
const WORLI = { lat: 19.0176, lng: 72.8172 };
const COLABA = { lat: 18.9067, lng: 72.8147 };

describe('route deviation', () => {
  it('is ~0 for a point on the segment', () => {
    const mid = { lat: (BOM.lat + WORLI.lat) / 2, lng: (BOM.lng + WORLI.lng) / 2 };
    expect(distanceToSegmentMeters(mid, BOM, WORLI)).toBeLessThan(5);
  });

  it('clamps to the nearest endpoint beyond the segment', () => {
    const d = distanceToSegmentMeters(COLABA, BOM, WORLI);
    expect(d).toBeGreaterThan(12_000);
    expect(d).toBeLessThan(13_000);
  });

  it('measures against the closest leg of a multi-stop path', () => {
    expect(distanceToPathMeters(COLABA, [BOM, WORLI, COLABA])).toBeLessThan(1);
  });

  it('flags a driver far from the planned route', () => {
    const path = [BOM, WORLI, COLABA];
    expect(isOffRoute({ lat: 19.03, lng: 72.83 }, path)).toBe(false);
    expect(isOffRoute({ lat: 19.2307, lng: 72.8567 }, path)).toBe(true); // Borivali
  });
});

import { describe, expect, it } from 'vitest';
import { applyBps, formatMoney, rupees, splitByWeights, splitEvenly } from './money';

describe('money', () => {
  it('converts rupees to paise without float drift', () => {
    expect(rupees(1200)).toBe(120000);
    expect(rupees(0.1 + 0.2)).toBe(30);
  });

  it('splits ₹1,200 four ways into ₹300 each', () => {
    expect(splitEvenly(rupees(1200), 4)).toEqual([30000, 30000, 30000, 30000]);
  });

  it('distributes remainder paise deterministically and sums exactly', () => {
    const shares = splitEvenly(100001, 3);
    expect(shares).toEqual([33334, 33334, 33333]);
    expect(shares.reduce((a, b) => a + b)).toBe(100001);
  });

  it('rejects invalid split inputs', () => {
    expect(() => splitEvenly(100, 0)).toThrow();
    expect(() => splitEvenly(10.5, 2)).toThrow();
    expect(() => splitEvenly(-1, 2)).toThrow();
  });

  it('splits by seat weights with largest remainder', () => {
    const shares = splitByWeights(100000, [1, 2]);
    expect(shares).toEqual([33333, 66667]);
    expect(splitByWeights(1000, [1, 1, 1]).reduce((a, b) => a + b)).toBe(1000);
  });

  it('applies basis points', () => {
    expect(applyBps(120000, 500)).toBe(6000);
  });

  it('formats INR', () => {
    expect(formatMoney(30000)).toBe('₹300');
    expect(formatMoney(123456)).toBe('₹1,234.56');
  });
});

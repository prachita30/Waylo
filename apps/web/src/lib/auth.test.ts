import { describe, expect, it } from 'vitest';
import { homeForRole, safeNext } from './auth';

describe('auth helpers', () => {
  it('only allows same-site relative redirect targets', () => {
    expect(safeNext('/trips?x=1')).toBe('/trips?x=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null, '/admin')).toBe('/admin');
  });

  it('routes each role to its home', () => {
    expect(homeForRole('passenger')).toBe('/');
    expect(homeForRole('operator')).toBe('/operator');
    expect(homeForRole('partner')).toBe('/partner');
    expect(homeForRole('admin')).toBe('/admin');
  });
});

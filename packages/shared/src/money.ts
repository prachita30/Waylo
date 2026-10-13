/**
 * Money is always an integer number of minor units (paise for INR).
 * Never use floating-point amounts in business logic.
 */
export type Minor = number;

export function assertMinor(value: number, label = 'amount'): asserts value is Minor {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer number of minor units`);
}

export function rupees(r: number): Minor {
  const v = Math.round(r * 100);
  assertMinor(v);
  return v;
}

const formatters = new Map<string, Intl.NumberFormat>();
export function formatMoney(minor: Minor, currency = 'INR', locale = 'en-IN'): string {
  const key = `${currency}|${locale}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 });
    formatters.set(key, f);
  }
  return f.format(minor / 100);
}

/**
 * Split `total` into `parts` integer shares that add back up exactly.
 * Remainder paise go to the first shares, one each, so the split is deterministic.
 */
export function splitEvenly(total: Minor, parts: number): Minor[] {
  assertMinor(total, 'total');
  if (!Number.isInteger(parts) || parts <= 0) throw new RangeError('parts must be a positive integer');
  if (total < 0) throw new RangeError('total must not be negative');
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Split `total` proportionally to integer `weights` (e.g. seats per participant),
 * using the largest-remainder method so the shares sum exactly to `total`.
 */
export function splitByWeights(total: Minor, weights: number[]): Minor[] {
  assertMinor(total, 'total');
  if (weights.length === 0) throw new RangeError('weights must not be empty');
  if (weights.some((w) => !Number.isInteger(w) || w <= 0)) throw new RangeError('weights must be positive integers');
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/** Percentage in basis points (1% = 100 bps), rounded half-up to the paisa. */
export function applyBps(amount: Minor, bps: number): Minor {
  assertMinor(amount);
  return Math.round((amount * bps) / 10_000);
}

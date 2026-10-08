import { describe, expect, it } from 'vitest';
import { fromCents, splitCents, sumCents, toCents } from '../shared/money.js';

describe('toCents / fromCents', () => {
  it('parses exactly, with no float drift', () => {
    expect(toCents('0.10')).toBe(10);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('19.99')).toBe(1999);
    expect(toCents('1234567.89')).toBe(123456789);
    expect(toCents('7')).toBe(700);
    expect(toCents('-3.50')).toBe(-350);
    expect(toCents(5)).toBe(500);
  });
  it('rejects floats, 3 decimals, junk and exponents', () => {
    for (const bad of ['1.234', '', 'abc', '1e3', '1,000.00', '.5', '$5', ' ']) expect(() => toCents(bad)).toThrow();
    expect(() => toCents(0.1 + 0.2)).toThrow();
  });
  it('round-trips every cent value from 0 to 10,000', () => {
    for (let c = 0; c <= 10_000; c++) expect(toCents(fromCents(c))).toBe(c);
  });
  it('formats cents as 2-decimal strings', () => {
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(100)).toBe('1.00');
    expect(fromCents(-1999)).toBe('-19.99');
    expect(() => fromCents(1.5)).toThrow();
  });
  it('classic float trap: 0.1 + 0.2 sums to exactly 0.30', () => {
    expect(sumCents(['0.10', '0.20'])).toBe(30);
  });
});

describe('splitCents', () => {
  it('gives leftover cents to the first shares and always sums exactly', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333]);
    expect(splitCents(1001, 3)).toEqual([334, 334, 333]);
    expect(splitCents(9001, 4)).toEqual([2251, 2250, 2250, 2250]);
    expect(splitCents(1, 3)).toEqual([1, 0, 0]);
    expect(splitCents(0, 2)).toEqual([0, 0]);
    expect(splitCents(500, 1)).toEqual([500]);
  });
  it('sums exactly for every total up to $200 and 1..9 roommates (a household holds up to 9)', () => {
    for (let total = 0; total <= 20_000; total += 7) {
      for (let n = 1; n <= 9; n++) {
        const parts = splitCents(total, n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        expect([...parts].sort((a, b) => b - a)).toEqual(parts); // extras come first
      }
    }
  });
  it('rejects nonsense', () => {
    expect(() => splitCents(-1, 2)).toThrow();
    expect(() => splitCents(10, 0)).toThrow();
    expect(() => splitCents(10.5, 2)).toThrow();
  });
});

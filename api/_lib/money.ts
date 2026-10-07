// Money is NUMERIC in the database and integer cents in code. Never a float.
// The pg driver hands NUMERIC back as a string like "12.34"; these helpers convert exactly.

/** "12.34" -> 1234. Accepts at most 2 decimals; anything else throws. */
export function toCents(value: string | number): number {
  const s = typeof value === 'number' ? (Number.isInteger(value) ? String(value) : (() => { throw new Error('Pass money as a string like "12.34", not a float'); })()) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not a money amount: ${JSON.stringify(value)}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Amount too large');
  return m[1] ? -cents : cents;
}

/** 1234 -> "12.34" (exact string for a NUMERIC(10,2) column). */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('Cents must be an integer');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Split a total into n parts that sum EXACTLY to the total; leftover cents go to the first shares. */
export function splitCents(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('Total must be a non-negative integer of cents');
  if (!Number.isInteger(parts) || parts < 1) throw new Error('Need at least one share');
  const base = Math.floor(totalCents / parts);
  const extra = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Sum of "12.34"-style strings, exactly, as cents. */
export const sumCents = (values: Array<string | number>) => values.reduce<number>((a, v) => a + (typeof v === 'number' ? v : toCents(v)), 0);

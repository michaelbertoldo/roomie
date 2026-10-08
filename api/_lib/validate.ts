// Small validation and lookup helpers shared by the money and chore modules.
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema as s, type Tx } from './db.js';
import { HttpError } from './http.js';

export function str(v: unknown, min: number, max: number, label: string): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < min || t.length > max) throw new HttpError(400, min ? `${label} is required (up to ${max} characters)` : `${label} must be at most ${max} characters`);
  return t;
}
export const optStr = (v: unknown, max: number, label: string) => (v == null || v === '' ? null : str(v, 1, max, label));
export const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
type Ex = Tx | typeof db;
export async function householdTz(ex: Ex, householdId: number) {
  const [h] = await ex.select({ tz: s.household.timezone }).from(s.household).where(eq(s.household.householdId, householdId));
  return h?.tz ?? 'America/Denver';
}
export const firstName = async (ex: Ex, userId: number) => (await ex.select({ f: s.users.firstName }).from(s.users).where(eq(s.users.userId, userId)))[0]?.f ?? 'Someone';
export async function activeIds(ex: Ex, householdId: number) {
  return (await ex.select({ u: s.householdMember.userId }).from(s.householdMember).where(and(eq(s.householdMember.householdId, householdId), isNull(s.householdMember.leftDate)))).map((r) => r.u);
}

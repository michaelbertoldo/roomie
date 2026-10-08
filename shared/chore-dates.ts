// Pure scheduling logic for chores (no database, no I/O), shared by the API and the browser.
// A chore ROW is the rule ("every Monday at 7 PM"); chore_assignment ROWS are the generated
// occurrences. These functions turn a rule into calendar dates (YYYY-MM-DD, in the household's
// timezone) and pick who is next in a rotation. The conversion of a local date + time into a real
// instant (with DST) is done by Postgres: (date + time) AT TIME ZONE household.timezone.

export type ChoreRule = { repeats: 'none' | 'weekly' | 'monthly'; startDate: string; dayOfWeek: number | null; dayOfMonth: number | null };

const toUtc = (ymd: string) => new Date(`${ymd}T12:00:00Z`); // noon UTC: immune to any DST shift
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (ymd: string, n: number) => { const d = toUtc(ymd); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const dayOfWeek = (ymd: string) => toUtc(ymd).getUTCDay(); // 0 = Sunday
export const lastDayOfMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();

/**
 * Every date this rule produces from `from` through `to` (inclusive), never before the rule's start date.
 * weekly: every dayOfWeek. monthly: dayOfMonth, clamped to the month's last day (31 -> Feb 28/29, Apr 30).
 * one-time ('none') chores are created with their single occurrence, so they produce nothing here.
 */
export function occurrenceDates(rule: ChoreRule, from: string, to: string): string[] {
  const start = rule.startDate > from ? rule.startDate : from;
  if (start > to) return [];
  const out: string[] = [];
  if (rule.repeats === 'weekly' && rule.dayOfWeek != null) {
    let d = addDays(start, (rule.dayOfWeek - dayOfWeek(start) + 7) % 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
  } else if (rule.repeats === 'monthly' && rule.dayOfMonth != null) {
    let [y, m] = start.split('-').map(Number) as [number, number];
    for (;; m++) {
      if (m > 12) { m = 1; y++; }
      const day = Math.min(rule.dayOfMonth, lastDayOfMonth(y, m));
      const d = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (d > to) break;
      if (d >= start) out.push(d);
    }
  }
  return out;
}

/**
 * Who is next. `rotation` is the ordered list of CURRENT roommates; `lastAssignee` is who had the
 * previous occurrence. If they are no longer in the rotation (moved out), start from the top.
 */
export function nextInRotation(rotation: number[], lastAssignee: number | null): number | null {
  if (!rotation.length) return null;
  const i = lastAssignee == null ? -1 : rotation.indexOf(lastAssignee);
  return rotation[(i + 1) % rotation.length] ?? null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayName = (d: number) => DAYS[d] ?? '';
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
/** "7:00 PM" from "19:00" or "19:00:00" */
export function clock(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Human text for a rule: "Every Monday at 7:00 PM", "Monthly on the 31st at 9:00 AM", "One time". */
export function describeSchedule(c: { repeats: string; dayOfWeek: number | null; dayOfMonth: number | null; dueTime: string | null }): string {
  const at = c.dueTime ? ` at ${clock(c.dueTime)}` : '';
  if (c.repeats === 'weekly' && c.dayOfWeek != null) return `Every ${dayName(c.dayOfWeek)}${at}`;
  if (c.repeats === 'monthly' && c.dayOfMonth != null) return `Monthly on the ${ordinal(c.dayOfMonth)}${at}`;
  return `One time${at}`;
}

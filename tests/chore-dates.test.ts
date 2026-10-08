import { describe, expect, it } from 'vitest';
import { addDays, clock, dayOfWeek, describeSchedule, lastDayOfMonth, nextInRotation, occurrenceDates } from '../shared/chore-dates.js';

const weekly = (dow: number, start = '2026-01-01') => ({ repeats: 'weekly' as const, startDate: start, dayOfWeek: dow, dayOfMonth: null });
const monthly = (dom: number, start = '2026-01-01') => ({ repeats: 'monthly' as const, startDate: start, dayOfWeek: null, dayOfMonth: dom });

describe('date helpers', () => {
  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('knows the weekday', () => { expect(dayOfWeek('2026-10-07')).toBe(3); expect(dayOfWeek('2026-10-04')).toBe(0); });
  it('knows month lengths, including leap years', () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28); expect(lastDayOfMonth(2028, 2)).toBe(29); expect(lastDayOfMonth(2026, 4)).toBe(30); expect(lastDayOfMonth(2026, 12)).toBe(31);
  });
});

describe('weekly occurrences', () => {
  it('every Monday over four weeks', () => {
    expect(occurrenceDates(weekly(1), '2026-10-08', '2026-11-04')).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  });
  it('includes today when today is the day, and the last day of the window', () => {
    expect(occurrenceDates(weekly(4), '2026-10-08', '2026-10-15')).toEqual(['2026-10-08', '2026-10-15']);
  });
  it('never goes before the start date', () => {
    expect(occurrenceDates(weekly(1, '2026-10-20'), '2026-10-08', '2026-11-04')).toEqual(['2026-10-26', '2026-11-02']);
  });
  it('nothing when the window ends before the start', () => { expect(occurrenceDates(weekly(1, '2027-01-01'), '2026-10-08', '2026-11-04')).toEqual([]); });
  it('re-running with the same window gives the same dates (the generator is safe to re-run)', () => {
    const a = occurrenceDates(weekly(6), '2026-10-08', '2026-11-04'), b = occurrenceDates(weekly(6), '2026-10-08', '2026-11-04');
    expect(a).toEqual(b); expect(new Set(a).size).toBe(a.length);
  });
  it('every date is the right weekday, for every weekday', () => {
    for (let d = 0; d <= 6; d++) for (const x of occurrenceDates(weekly(d), '2026-10-08', '2027-01-31')) expect(dayOfWeek(x)).toBe(d);
  });
});

describe('monthly occurrences', () => {
  it('the 15th each month', () => { expect(occurrenceDates(monthly(15), '2026-10-08', '2027-01-20')).toEqual(['2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15']); });
  it('day 31 clamps to the last day of shorter months', () => {
    expect(occurrenceDates(monthly(31), '2026-01-01', '2026-06-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  });
  it('day 29/30 in February, leap year and not', () => {
    expect(occurrenceDates(monthly(30), '2028-02-01', '2028-03-31')).toEqual(['2028-02-29', '2028-03-30']);
    expect(occurrenceDates(monthly(29), '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-29']);
  });
  it('skips a month whose date already passed, and crosses the year', () => {
    expect(occurrenceDates(monthly(5), '2026-12-06', '2027-02-28')).toEqual(['2027-01-05', '2027-02-05']);
  });
  it('one-time chores produce nothing (their single occurrence is created with the chore)', () => {
    expect(occurrenceDates({ repeats: 'none', startDate: '2026-10-10', dayOfWeek: null, dayOfMonth: null }, '2026-10-01', '2026-12-31')).toEqual([]);
  });
});

describe('rotation', () => {
  it('goes in turn and wraps', () => {
    expect(nextInRotation([1, 2, 3], null)).toBe(1);
    expect(nextInRotation([1, 2, 3], 1)).toBe(2);
    expect(nextInRotation([1, 2, 3], 3)).toBe(1);
  });
  it('a single person always gets it (a fixed assignee is a rotation of one)', () => { expect(nextInRotation([7], 7)).toBe(7); expect(nextInRotation([7], null)).toBe(7); });
  it('someone who left the rotation: start again from the top, never pick them', () => { expect(nextInRotation([1, 3], 2)).toBe(1); });
  it('an empty rotation (everyone moved out) yields nobody', () => { expect(nextInRotation([], 1)).toBeNull(); });
  it('over many turns everyone gets the same number, +/- 1', () => {
    const rot = [1, 2, 3, 4], counts = new Map<number, number>(); let last: number | null = null;
    for (let i = 0; i < 50; i++) { last = nextInRotation(rot, last); counts.set(last!, (counts.get(last!) ?? 0) + 1); }
    const v = [...counts.values()]; expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1);
  });
});

describe('describing a schedule', () => {
  it('reads naturally', () => {
    expect(describeSchedule({ repeats: 'weekly', dayOfWeek: 1, dayOfMonth: null, dueTime: '19:00:00' })).toBe('Every Monday at 7:00 PM');
    expect(describeSchedule({ repeats: 'monthly', dayOfWeek: null, dayOfMonth: 31, dueTime: '09:05' })).toBe('Monthly on the 31st at 9:05 AM');
    expect(describeSchedule({ repeats: 'monthly', dayOfWeek: null, dayOfMonth: 2, dueTime: '12:00' })).toBe('Monthly on the 2nd at 12:00 PM');
    expect(describeSchedule({ repeats: 'monthly', dayOfWeek: null, dayOfMonth: 11, dueTime: '00:30' })).toBe('Monthly on the 11th at 12:30 AM');
    expect(describeSchedule({ repeats: 'none', dayOfWeek: null, dayOfMonth: null, dueTime: '18:00' })).toBe('One time at 6:00 PM');
  });
  it('clock handles midnight and noon', () => { expect(clock('00:00')).toBe('12:00 AM'); expect(clock('12:00')).toBe('12:00 PM'); expect(clock('23:59')).toBe('11:59 PM'); expect(clock(null)).toBe(''); });
});

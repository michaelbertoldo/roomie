import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { withUser } from '../context.js';
import { HttpError, body, json } from '../http.js';

// Best-effort brake on guessing codes: 5 wrong codes per user per 10 minutes. In memory, so each warm
// serverless instance counts on its own (no new table needed); it slows guessing, it is not a hard cap.
const MAX_MISSES = 5, WINDOW_MS = 10 * 60_000;
const misses = new Map<number, number[]>();
const recentMisses = (userId: number) => {
  const now = Date.now();
  const list = (misses.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) misses.set(userId, list); else misses.delete(userId);
  return list;
};

// Join by code. Rejoining a household you moved out of clears left_date on the old row (v3 rule).
export const POST = withUser(async (user, req) => {
  const b = await body(req);
  const code = typeof b.joinCode === 'string' ? b.joinCode.trim().toUpperCase() : '';
  if (!code) throw new HttpError(400, 'Join code is required');
  if (recentMisses(user.userId).length >= MAX_MISSES) throw new HttpError(429, 'Too many wrong codes. Try again in a few minutes.');
  const [h] = await db.select().from(schema.household).where(eq(schema.household.joinCode, code));
  if (!h) {
    misses.set(user.userId, [...recentMisses(user.userId), Date.now()]);
    throw new HttpError(404, 'That join code does not match a household');
  }
  const hm = schema.householdMember;
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(hm).where(and(eq(hm.householdId, h.householdId), eq(hm.userId, user.userId))).for('update');
    if (!row) await tx.insert(hm).values({ householdId: h.householdId, userId: user.userId, role: 'member' });
    else if (row.leftDate) await tx.update(hm).set({ leftDate: null }).where(eq(hm.memberId, row.memberId));
  });
  return json({ householdId: h.householdId, householdName: h.householdName, timezone: h.timezone });
});

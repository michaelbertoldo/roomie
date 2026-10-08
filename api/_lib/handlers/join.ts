import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { withUser } from '../context.js';
import { HttpError, body, json } from '../http.js';

// Join by code. Rejoining a household you moved out of clears left_date on the old row (v3 rule).
export const POST = withUser(async (user, req) => {
  const b = await body(req);
  const code = typeof b.joinCode === 'string' ? b.joinCode.trim().toUpperCase() : '';
  if (!code) throw new HttpError(400, 'Join code is required');
  const [h] = await db.select().from(schema.household).where(eq(schema.household.joinCode, code));
  if (!h) throw new HttpError(404, 'That join code does not match a household');
  const hm = schema.householdMember;
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(hm).where(and(eq(hm.householdId, h.householdId), eq(hm.userId, user.userId))).for('update');
    if (!row) await tx.insert(hm).values({ householdId: h.householdId, userId: user.userId, role: 'member' });
    else if (row.leftDate) await tx.update(hm).set({ leftDate: null }).where(eq(hm.memberId, row.memberId));
  });
  return json({ householdId: h.householdId, householdName: h.householdName, timezone: h.timezone });
});

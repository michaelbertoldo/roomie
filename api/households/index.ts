import { db, schema } from '../_lib/db.js';
import { withUser } from '../_lib/context.js';
import { HttpError, body, json } from '../_lib/http.js';
import { newJoinCode } from '../_lib/joincode.js';

const validZone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Create a household. The caller becomes its owner. Who the caller is comes from the token only.
export const POST = withUser(async (user, req) => {
  const b = await body(req);
  const name = text(b.householdName, 80);
  if (!name) throw new HttpError(400, 'Household name is required');
  const timezone = text(b.timezone, 60) || 'America/Denver';
  if (!validZone(timezone)) throw new HttpError(400, 'Unknown timezone');

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.transaction(async (tx) => {
        const [h] = await tx.insert(schema.household).values({
          householdName: name, address: text(b.address, 200) || null, timezone, joinCode: newJoinCode(),
          themeColor: text(b.themeColor, 20) || null,
        }).returning();
        await tx.insert(schema.householdMember).values({ householdId: h!.householdId, userId: user.userId, role: 'owner' });
        return h!;
      });
      return json({ householdId: created.householdId, householdName: created.householdName, joinCode: created.joinCode, timezone: created.timezone }, 201);
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).code === '23505' && String((e as { constraint?: string }).constraint).includes('join_code')) continue;
      throw e;
    }
  }
  throw new HttpError(500, 'Could not create a unique join code. Try again.');
});

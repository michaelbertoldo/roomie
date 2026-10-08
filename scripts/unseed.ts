// Removes ONLY the seed household (join code MAPLE412) and the four seed users, so the demo can be
// reset any time:  npm run db:unseed   then   npm run db:seed
// Real people who joined the seed household are NOT deleted. They just lose that membership
// (it cascades with the household) and can rejoin with the code after the next seed.
import { eq, inArray } from 'drizzle-orm';
import { db, pool, schema as s } from '../api/_lib/db.js';
import { SEED_EMAIL_LIST, SEED_JOIN_CODE } from './lib/seed-constants.js';
import { assertBranchFor } from './lib/db-guard.js';

await assertBranchFor(pool, 'the unseed', { production: process.argv.includes('--production') });

const result = await db.transaction(async (tx) => {
  const [house] = await tx.select({ id: s.household.householdId }).from(s.household).where(eq(s.household.joinCode, SEED_JOIN_CODE));
  let outsiders = 0;
  if (house) {
    const members = await tx.select({ email: s.users.email }).from(s.householdMember)
      .innerJoin(s.users, eq(s.users.userId, s.householdMember.userId)).where(eq(s.householdMember.householdId, house.id));
    outsiders = members.filter((m) => !SEED_EMAIL_LIST.includes(m.email)).length;
    await tx.delete(s.household).where(eq(s.household.householdId, house.id)); // cascades to everything inside it
  }
  const users = await tx.delete(s.users).where(inArray(s.users.email, SEED_EMAIL_LIST)).returning({ id: s.users.userId });
  return { household: house ? 1 : 0, seedUsers: users.length, realMembersWhoLostMembership: outsiders };
});
console.log('unseeded:', JSON.stringify(result));
await pool.end();

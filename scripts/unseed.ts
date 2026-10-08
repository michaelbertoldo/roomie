// Removes ONLY the seed household (join code MAPLE412) and the four seed users, so the demo can be
// reset any time:  npm run db:unseed   then   npm run db:seed
// Real people who joined the seed household are NOT deleted. They just lose that membership
// (it cascades with the household) and can rejoin with the code after the next seed.
import { eq, inArray } from 'drizzle-orm';
import { db, pool, schema as s } from '../api/_lib/db.js';
import { SEED_ALL_JOIN_CODES, SEED_EMAIL_LIST } from './lib/seed-constants.js';
import { assertBranchFor } from './lib/db-guard.js';

await assertBranchFor(pool, 'the unseed', { production: process.argv.includes('--production') });

const result = await db.transaction(async (tx) => {
  const houses = await tx.select({ id: s.household.householdId }).from(s.household).where(inArray(s.household.joinCode, SEED_ALL_JOIN_CODES));
  let outsiders = 0;
  if (houses.length) {
    const ids = houses.map((h) => h.id);
    const members = await tx.select({ email: s.users.email }).from(s.householdMember)
      .innerJoin(s.users, eq(s.users.userId, s.householdMember.userId)).where(inArray(s.householdMember.householdId, ids));
    outsiders = members.filter((m) => !SEED_EMAIL_LIST.includes(m.email)).length;
    await tx.delete(s.household).where(inArray(s.household.householdId, ids)); // cascades to everything inside them
  }
  const seedUsers = await tx.select({ id: s.users.userId }).from(s.users).where(inArray(s.users.email, SEED_EMAIL_LIST));
  if (seedUsers.length) await tx.delete(s.appFeedback).where(inArray(s.appFeedback.userId, seedUsers.map((u) => u.id)));
  const users = await tx.delete(s.users).where(inArray(s.users.email, SEED_EMAIL_LIST)).returning({ id: s.users.userId });
  return { households: houses.length, seedUsers: users.length, realMembersWhoLostMembership: outsiders };
});
console.log('unseeded:', JSON.stringify(result));
await pool.end();

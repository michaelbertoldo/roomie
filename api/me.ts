import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from './_lib/db.js';
import { withUser } from './_lib/context.js';
import { json } from './_lib/http.js';

// First call after sign-in: requireUser creates the users row if this is a new person.
export const GET = withUser(async (user) => {
  const [me] = await db.select({
    userId: schema.users.userId, firstName: schema.users.firstName, lastName: schema.users.lastName,
    email: schema.users.email, phoneNumber: schema.users.phoneNumber, profilePhoto: schema.users.profilePhoto,
  }).from(schema.users).where(eq(schema.users.userId, user.userId));
  const households = await db.select({
    householdId: schema.household.householdId, householdName: schema.household.householdName,
    timezone: schema.household.timezone, themeColor: schema.household.themeColor, role: schema.householdMember.role,
  }).from(schema.householdMember)
    .innerJoin(schema.household, eq(schema.household.householdId, schema.householdMember.householdId))
    .where(and(eq(schema.householdMember.userId, user.userId), isNull(schema.householdMember.leftDate)));
  return json({ user: me, households });
});

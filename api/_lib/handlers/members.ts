import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { withHousehold } from '../context.js';
import { json } from '../http.js';

// Current AND former roommates: people who moved out keep their history visible (v3 rule).
export const GET = withHousehold(async ({ householdId }) => {
  const rows = await db.select({
    userId: schema.users.userId, firstName: schema.users.firstName, lastName: schema.users.lastName,
    profilePhoto: schema.users.profilePhoto, role: schema.householdMember.role,
    joinedDate: schema.householdMember.joinedDate, leftDate: schema.householdMember.leftDate,
  }).from(schema.householdMember)
    .innerJoin(schema.users, eq(schema.users.userId, schema.householdMember.userId))
    .where(eq(schema.householdMember.householdId, householdId));
  const methods = await db.select({ userId: schema.paymentMethod.userId, app: schema.paymentMethod.app, username: schema.paymentMethod.username, isPreferred: schema.paymentMethod.isPreferred })
    .from(schema.paymentMethod).innerJoin(schema.householdMember, and(eq(schema.householdMember.userId, schema.paymentMethod.userId), eq(schema.householdMember.householdId, householdId)));
  return json({ members: rows.map((m) => ({ ...m, paymentMethods: methods.filter((x) => x.userId === m.userId).map(({ app, username, isPreferred }) => ({ app, username, isPreferred })) })) });
});

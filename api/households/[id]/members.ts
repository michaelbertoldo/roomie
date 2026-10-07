import { eq } from 'drizzle-orm';
import { db, schema } from '../../_lib/db.js';
import { withHousehold } from '../../_lib/context.js';
import { json } from '../../_lib/http.js';

// Current AND former roommates: people who moved out keep their history visible (v3 rule).
export const GET = withHousehold(async ({ householdId }) => {
  const rows = await db.select({
    userId: schema.users.userId, firstName: schema.users.firstName, lastName: schema.users.lastName,
    profilePhoto: schema.users.profilePhoto, role: schema.householdMember.role,
    joinedDate: schema.householdMember.joinedDate, leftDate: schema.householdMember.leftDate,
  }).from(schema.householdMember)
    .innerJoin(schema.users, eq(schema.users.userId, schema.householdMember.userId))
    .where(eq(schema.householdMember.householdId, householdId));
  return json({ members: rows });
});

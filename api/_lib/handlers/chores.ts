import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { withHousehold } from '../context.js';
import { json } from '../http.js';

// Read-only for now; the chore slice adds create/edit/complete/swap.
export const GET = withHousehold(async ({ householdId }) => {
  const rows = await db.select().from(schema.chore).where(eq(schema.chore.householdId, householdId));
  return json({ chores: rows });
});

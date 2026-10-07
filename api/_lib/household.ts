import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from './db.js';
import { schema } from './db.js';
import { HttpError } from './http.js';

type Executor = Db | Tx;
const hm = schema.householdMember;

/**
 * THE membership check. Active member = household_member row with left_date IS NULL.
 * There is no row-level security, so every household-scoped route must go through this
 * (via withHousehold in context.ts). Non-members get 404, not 403, so household ids
 * can't be probed.
 */
export async function requireActiveMember(ex: Executor, userId: number, householdId: number) {
  const rows = await ex.select({ memberId: hm.memberId, role: hm.role })
    .from(hm).where(and(eq(hm.householdId, householdId), eq(hm.userId, userId), isNull(hm.leftDate))).limit(1);
  if (!rows[0]) throw new HttpError(404, 'Household not found');
  return rows[0];
}

/**
 * New chores, shares, tags and notifications may only target current roommates.
 * Roommates who moved out keep their history but are never targeted again.
 */
export async function assertActiveMembers(ex: Executor, householdId: number, userIds: number[]) {
  const wanted = [...new Set(userIds)];
  if (!wanted.length) return;
  const rows = await ex.select({ userId: hm.userId }).from(hm)
    .where(and(eq(hm.householdId, householdId), isNull(hm.leftDate), inArray(hm.userId, wanted)));
  if (rows.length !== wanted.length) throw new HttpError(400, 'Every roommate involved must currently live in this household');
}

/** Only the creator can edit chores, events and wishlist items. */
export function assertCreator(createdByUserId: number | null, userId: number) {
  if (createdByUserId !== userId) throw new HttpError(403, 'Only the person who created this can change it');
}

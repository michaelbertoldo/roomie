import { requireUser, type CurrentUser } from './auth.js';
import { db } from './db.js';
import { requireActiveMember } from './household.js';
import { HttpError, id, route, segments } from './http.js';

export type HouseholdCtx = { user: CurrentUser; householdId: number; role: string; req: Request };

/**
 * Wrapper for every route under /api/households/:id/... . It authenticates, reads the
 * household id from the URL (never from the body), and proves the caller is an active
 * member before the route's own code runs.
 */
export function withHousehold(fn: (ctx: HouseholdCtx) => Promise<Response>) {
  return route(async (req) => {
    const user = await requireUser(req);
    const seg = segments(req);
    if (seg[0] !== 'households' || seg[1] === undefined) throw new HttpError(400, 'Missing household');
    const householdId = id(seg[1], 'household id');
    const member = await requireActiveMember(db, user.userId, householdId);
    return fn({ user, householdId, role: member.role, req });
  });
}

/** Wrapper for routes that need a signed-in user but no household. */
export function withUser(fn: (user: CurrentUser, req: Request) => Promise<Response>) {
  return route(async (req) => fn(await requireUser(req), req));
}

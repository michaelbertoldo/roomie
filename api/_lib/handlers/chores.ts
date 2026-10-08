import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { createChore, listChores } from '../chores.js';

export const GET = withHousehold(async ({ user, householdId }) => json(await listChores(householdId, user.userId)));
// created_by is always the caller; who it is assigned to must be a current roommate (checked in createChore)
export const POST = withHousehold(async ({ user, householdId, req }) => json(await createChore(user, householdId, await body(req)), 201));

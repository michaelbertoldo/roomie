import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { deleteChore, updateChore } from '../chores.js';

// Only the creator can edit or delete (assertCreator inside).
export const PATCH = withHousehold(async ({ user, householdId, req }) => json(await updateChore(user, householdId, id(segments(req)[3], 'chore id'), await body(req))));
export const DELETE = withHousehold(async ({ user, householdId, req }) => { await deleteChore(user, householdId, id(segments(req)[3], 'chore id')); return json({ ok: true }); });

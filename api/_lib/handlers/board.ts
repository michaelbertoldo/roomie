import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { listBoard, postNote } from '../calendar.js';

export const GET = withHousehold(async ({ user, householdId }) => json(await listBoard(householdId, user.userId)));
export const POST = withHousehold(async ({ user, householdId, req }) => json(await postNote(user, householdId, await body(req)), 201));

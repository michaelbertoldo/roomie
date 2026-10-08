import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { createEvent, listEvents } from '../calendar.js';

export const GET = withHousehold(async ({ user, householdId }) => json(await listEvents(householdId, user.userId)));
export const POST = withHousehold(async ({ user, householdId, req }) => json(await createEvent(user, householdId, await body(req)), 201));

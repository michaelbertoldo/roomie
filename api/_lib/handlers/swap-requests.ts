import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { createSwapRequest } from '../chores.js';

export const POST = withHousehold(async ({ user, householdId, req }) => json(await createSwapRequest(user, householdId, await body(req)), 201));

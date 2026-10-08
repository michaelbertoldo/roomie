import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { respondToSwap } from '../chores.js';

export const PATCH = withHousehold(async ({ user, householdId, req }) => json(await respondToSwap(user, householdId, id(segments(req)[3], 'request id'), await body(req))));

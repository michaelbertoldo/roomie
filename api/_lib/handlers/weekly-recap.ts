import { withHousehold } from '../context.js';
import { json } from '../http.js';
import { weeklyRecap } from '../home.js';

// GET /households/:id/weekly-recap -> { enabled: false } unless RECAP_AI_ENABLED=1 and a key is set. Always about the caller's own week.
export const GET = withHousehold(async ({ user, householdId }) => json(await weeklyRecap(user, householdId)));

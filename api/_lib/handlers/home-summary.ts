import { withHousehold } from '../context.js';
import { json } from '../http.js';
import { homeSummary } from '../home.js';

// GET /households/:id/home-summary -> { enabled: false } unless HOME_AI_ENABLED=1 and a key is set. Always about the caller's own view.
export const GET = withHousehold(async ({ user, householdId }) => json(await homeSummary(user, householdId)));

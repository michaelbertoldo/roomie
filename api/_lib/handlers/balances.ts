import { withHousehold } from '../context.js';
import { json } from '../http.js';
import { getBalances } from '../finance.js';

export const GET = withHousehold(async ({ user, householdId }) => json(await getBalances(householdId, user.userId)));

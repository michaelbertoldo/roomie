import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { createExpense, listExpenses } from '../finance.js';

export const GET = withHousehold(async ({ user, householdId }) => json(await listExpenses(householdId, user.userId)));
// paid_by is always the caller; participants come from the body, everything else is validated server-side
export const POST = withHousehold(async ({ user, householdId, req }) => json(await createExpense(user, householdId, await body(req)), 201));

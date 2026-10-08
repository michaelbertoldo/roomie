import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { createPayment } from '../finance.js';

// The amount is never read from the body: the server sums the shares being settled.
export const POST = withHousehold(async ({ user, householdId, req }) => json(await createPayment(user, householdId, await body(req)), 201));

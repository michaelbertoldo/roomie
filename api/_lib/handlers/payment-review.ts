import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { reviewPayment } from '../finance.js';

export const PATCH = withHousehold(async ({ user, householdId, req }) => json(await reviewPayment(user, householdId, id(segments(req)[3], 'payment id'), await body(req))));

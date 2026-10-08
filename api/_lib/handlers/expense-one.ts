import { withHousehold } from '../context.js';
import { id, json, segments } from '../http.js';
import { deleteExpense } from '../finance.js';

export const DELETE = withHousehold(async ({ user, householdId, req }) => {
  await deleteExpense(user, householdId, id(segments(req)[3], 'expense id'));
  return json({ ok: true });
});

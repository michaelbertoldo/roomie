import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { deleteWishlistItem, updateWishlistItem } from '../finance.js';

// Only the creator can edit or delete (assertCreator inside).
export const PATCH = withHousehold(async ({ user, householdId, req }) => json(await updateWishlistItem(user, householdId, id(segments(req)[3], 'item id'), await body(req))));
export const DELETE = withHousehold(async ({ user, householdId, req }) => { await deleteWishlistItem(user, householdId, id(segments(req)[3], 'item id')); return json({ ok: true }); });

import { withHousehold } from '../context.js';
import { body, json } from '../http.js';
import { createWishlistItem, listWishlist } from '../finance.js';

export const GET = withHousehold(async ({ user, householdId }) => json(await listWishlist(householdId, user.userId)));
export const POST = withHousehold(async ({ user, householdId, req }) => json(await createWishlistItem(user, householdId, await body(req)), 201));

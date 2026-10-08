import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { respondToEvent } from '../calendar.js';

// POST /households/:id/events/:eventId/respond  { response: 'accepted' | 'declined' }. Always answers for the caller.
export const POST = withHousehold(async ({ user, householdId, req }) => json(await respondToEvent(user, householdId, id(segments(req)[3], 'event id'), await body(req))));

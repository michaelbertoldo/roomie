import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { deleteEvent, updateEvent } from '../calendar.js';

// Only the creator can edit or delete (assertCreator inside).
export const PATCH = withHousehold(async ({ user, householdId, req }) => json(await updateEvent(user, householdId, id(segments(req)[3], 'event id'), await body(req))));
export const DELETE = withHousehold(async ({ user, householdId, req }) => { await deleteEvent(user, householdId, id(segments(req)[3], 'event id')); return json({ ok: true }); });

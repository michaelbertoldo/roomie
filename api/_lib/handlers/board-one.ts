import { withHousehold } from '../context.js';
import { body, id, json, segments } from '../http.js';
import { deleteNote, updateNote } from '../calendar.js';

// Only the person who wrote a note can edit, pin or delete it.
export const PATCH = withHousehold(async ({ user, householdId, req }) => json(await updateNote(user, householdId, id(segments(req)[3], 'note id'), await body(req))));
export const DELETE = withHousehold(async ({ user, householdId, req }) => { await deleteNote(user, householdId, id(segments(req)[3], 'note id')); return json({ ok: true }); });

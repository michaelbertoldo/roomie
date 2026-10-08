import { withUser } from '../context.js';
import { body, json } from '../http.js';
import { markAllRead } from '../notifications.js';

// POST /notifications/read-all  { section?: 'chores' | 'money' | ... }. Always the caller's own rows.
export const POST = withUser(async (user, req) => json(await markAllRead(user.userId, await body(req).catch(() => ({})))));

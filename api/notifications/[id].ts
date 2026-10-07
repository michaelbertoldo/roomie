import { and, eq } from 'drizzle-orm';
import { db, schema } from '../_lib/db.js';
import { withUser } from '../_lib/context.js';
import { HttpError, body, id, json, segments } from '../_lib/http.js';

// Mark one of YOUR notifications read. Someone else's notification looks like it doesn't exist.
export const PATCH = withUser(async (user, req) => {
  const notificationId = id(segments(req)[1], 'notification id');
  const b = await body(req);
  if (typeof b.isRead !== 'boolean') throw new HttpError(400, 'isRead must be true or false');
  const n = schema.notification;
  const updated = await db.update(n).set({ isRead: b.isRead })
    .where(and(eq(n.notificationId, notificationId), eq(n.userId, user.userId)))
    .returning({ notificationId: n.notificationId, isRead: n.isRead });
  if (!updated[0]) throw new HttpError(404, 'Notification not found');
  return json(updated[0]);
});

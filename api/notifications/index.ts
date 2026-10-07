import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../_lib/db.js';
import { withUser } from '../_lib/context.js';
import { json } from '../_lib/http.js';

// Only ever the caller's own notifications: user_id comes from the token, never from the request.
export const GET = withUser(async (user) => {
  const n = schema.notification;
  const rows = await db.select({
    notificationId: n.notificationId, householdId: n.householdId, section: n.section, sourceType: n.sourceType,
    sourceId: n.sourceId, message: n.message, isRead: n.isRead, createdAt: n.createdAt, actorUserId: n.actorUserId,
  }).from(n).where(eq(n.userId, user.userId)).orderBy(desc(n.createdAt)).limit(100);
  return json({ notifications: rows });
});

import { withUser } from '../context.js';
import { json } from '../http.js';
import { listNotifications } from '../notifications.js';

// Only ever the caller's own notifications: user_id comes from the token, never from the request.
export const GET = withUser(async (user) => json(await listNotifications(user.userId)));

// The ONE route table. Vercel runs a handful of small entry files (api/me.ts, api/households/*,
// api/notifications/*) that all call dispatch(); locally scripts/dev-server.ts does the same.
// Why one table: the Hobby plan caps a deployment at 12 functions, and a single list makes it
// impossible to add a route that skips the guards (every handler is built with withUser or
// withHousehold, and tests/guards.test.ts checks that every handler file is registered here).
import { HttpError, json, segments } from './http.js';
import * as me from './handlers/me.js';
import * as households from './handlers/households.js';
import * as join from './handlers/join.js';
import * as members from './handlers/members.js';
import * as chores from './handlers/chores.js';
import * as choreOne from './handlers/chore-one.js';
import * as assignmentAction from './handlers/assignment-action.js';
import * as swapRequests from './handlers/swap-requests.js';
import * as swapRespond from './handlers/swap-respond.js';
import * as cronChores from './handlers/cron-chores.js';
import * as notifications from './handlers/notifications.js';
import * as notificationRead from './handlers/notification-read.js';
import * as notificationsReadAll from './handlers/notifications-read-all.js';
import * as expenses from './handlers/expenses.js';
import * as expenseOne from './handlers/expense-one.js';
import * as balances from './handlers/balances.js';
import * as payments from './handlers/payments.js';
import * as paymentReview from './handlers/payment-review.js';
import * as wishlist from './handlers/wishlist.js';
import * as wishlistOne from './handlers/wishlist-one.js';
import * as events from './handlers/events.js';
import * as eventOne from './handlers/event-one.js';
import * as eventRespond from './handlers/event-respond.js';
import * as board from './handlers/board.js';
import * as boardOne from './handlers/board-one.js';

type Handler = (req: Request) => Promise<Response>;
type Entry = { method: string; parts: string[]; handler: Handler };
const table: Entry[] = [];

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
function add(path: string, mod: object) {
  for (const method of METHODS) {
    const handler = (mod as Record<string, unknown>)[method];
    if (typeof handler === 'function') table.push({ method, parts: path.split('/').filter(Boolean), handler: handler as Handler });
  }
}

add('/me', me);
add('/households', households);
add('/households/join', join);
add('/households/:id/members', members);
add('/households/:id/chores', chores);
add('/households/:id/chores/:choreId', choreOne);
add('/households/:id/assignments/:assignmentId/:action', assignmentAction);
add('/households/:id/swap-requests', swapRequests);
add('/households/:id/swap-requests/:swapId', swapRespond);
add('/cron/chores', cronChores);
add('/households/:id/expenses', expenses);
add('/households/:id/expenses/:expenseId', expenseOne);
add('/households/:id/balances', balances);
add('/households/:id/payments', payments);
add('/households/:id/payments/:paymentId', paymentReview);
add('/households/:id/wishlist', wishlist);
add('/households/:id/wishlist/:itemId', wishlistOne);
add('/households/:id/events', events);
add('/households/:id/events/:eventId', eventOne);
add('/households/:id/events/:eventId/respond', eventRespond);
add('/households/:id/board', board);
add('/households/:id/board/:messageId', boardOne);
add('/notifications', notifications);
add('/notifications/read-all', notificationsReadAll);
add('/notifications/:id', notificationRead);

// static segments beat :params when two routes could match
table.sort((a, b) => a.parts.filter((p) => p.startsWith(':')).length - b.parts.filter((p) => p.startsWith(':')).length);

const matches = (parts: string[], seg: string[]) => parts.length === seg.length && parts.every((p, i) => p.startsWith(':') || p === seg[i]);

export async function dispatch(req: Request): Promise<Response> {
  const seg = segments(req);
  const sameShape = table.filter((e) => matches(e.parts, seg));
  if (!sameShape.length) return json({ error: 'Not found' }, 404);
  const hit = sameShape.find((e) => e.method === req.method);
  if (!hit) return json({ error: 'Method not allowed' }, 405);
  try { return await hit.handler(req); }
  catch (e) { if (e instanceof HttpError) return json({ error: e.message }, e.status); console.error(e); return json({ error: 'Something went wrong' }, 500); }
}
export const registeredRoutes = () => table.map((e) => `${e.method} /${e.parts.join('/')}`);

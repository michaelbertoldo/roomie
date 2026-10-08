// Throwaway fixture for clicking through the UI by hand. Creates two roomie-test-* accounts with a
// known password, a household, and one expense where B owes A. Run `npm run test:cleanup` afterwards.
import pg from 'pg';
import { handle } from './dev-server.js';
import { assertDevEnv } from './lib/db-guard.js';

assertDevEnv('the UI fixture');
const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'RoomieUiFixture!2026';
const call = (path: string, init: { method?: string; token?: string; body?: unknown; cookie?: string } = {}) =>
  handle(new Request(ORIGIN + path, { method: init.method ?? 'GET', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
async function user(tag: string) {
  const email = `roomie-test-ui-${tag}@example.com`;
  const up = await call('/api/auth/sign-up/email', { method: 'POST', body: { email, password: PASSWORD, name: `Fixture ${tag.toUpperCase()}` } });
  if (up.status !== 200) throw new Error(`sign-up ${tag}: ${up.status} ${await up.text()}`);
  const cookie = up.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const jwt = (await call('/api/auth/get-session', { cookie })).headers.get('set-auth-jwt')!;
  const me = await (await call('/api/me', { token: jwt })).json();
  return { email, jwt, id: me.user.userId as number };
}
const A = await user('a'), B = await user('b');
const h = await (await call('/api/households', { method: 'POST', token: A.jwt, body: { householdName: 'UI Fixture House' } })).json();
await call('/api/households/join', { method: 'POST', token: B.jwt, body: { joinCode: h.joinCode } });
await call(`/api/households/${h.householdId}/expenses`, { method: 'POST', token: A.jwt, body: { itemName: 'Dish soap', totalAmount: '12.50', participantUserIds: [B.id] } });
await call(`/api/households/${h.householdId}/expenses`, { method: 'POST', token: A.jwt, body: { itemName: 'Trash bags', totalAmount: '9.00', participantUserIds: [B.id] } });
await call(`/api/households/${h.householdId}/wishlist`, { method: 'POST', token: A.jwt, body: { itemName: 'Air fryer', needOrWant: 'want', estimatedPrice: '59.99', itemLink: 'https://example.com/air-fryer', description: 'For weeknight dinners' } });
const base = `/api/households/${h.householdId}`;
const ymd = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const dowOf = (n: number) => new Date(`${ymd(n)}T12:00:00Z`).getUTCDay();
const chore = async (token: string, body: unknown) => (await (await call(`${base}/chores`, { method: 'POST', token, body })).json());
await chore(A.jwt, { choreName: 'Take out trash', description: 'Kitchen and bathroom bins to the curb', repeats: 'weekly', dayOfWeek: dowOf(1), dueTime: '19:00', effort: 'easy', assignment: { mode: 'rotate', userIds: [A.id, B.id] } });
await chore(A.jwt, { choreName: 'Clean bathroom', description: 'Toilet, sink, shower, mirror, floor', repeats: 'weekly', dayOfWeek: dowOf(3), dueTime: '10:00', effort: 'hard', assignment: { mode: 'person', userId: B.id } });
await chore(B.jwt, { choreName: 'Water the plants', repeats: 'none', date: ymd(2), dueTime: '18:00', effort: 'easy', assignment: { mode: 'person', userId: B.id } });
await chore(A.jwt, { choreName: 'Pay the internet', repeats: 'monthly', dayOfMonth: 15, dueTime: '09:00', effort: 'medium', assignment: { mode: 'person', userId: A.id } });
const list = await (await call(base + '/chores', { token: A.jwt })).json();
const aTrash = list.assignments.find((x: any) => x.assignedUserId === A.id && list.chores.find((c: any) => c.choreId === x.choreId)?.choreName === 'Take out trash'); // eslint-disable-line @typescript-eslint/no-explicit-any
const bBath = list.assignments.find((x: any) => x.assignedUserId === B.id && list.chores.find((c: any) => c.choreId === x.choreId)?.choreName === 'Clean bathroom'); // eslint-disable-line @typescript-eslint/no-explicit-any
if (aTrash && bBath) await call(`${base}/swap-requests`, { method: 'POST', token: A.jwt, body: { type: 'swap', requesterAssignmentId: aTrash.assignmentId, targetAssignmentId: bBath.assignmentId, message: 'Visiting family this weekend' } });
// B also does a few things so A has a notification in every section (chores, expense tracker, calendar) ...
await call(`${base}/wishlist`, { method: 'POST', token: B.jwt, body: { itemName: 'Dish rack', needOrWant: 'need', estimatedPrice: '14.00' } });
await chore(B.jwt, { choreName: 'Sweep the floor', repeats: 'none', date: ymd(4), dueTime: '17:00', effort: 'easy', assignment: { mode: 'person', userId: A.id } });
await call(`${base}/events`, { method: 'POST', token: B.jwt, body: { eventName: 'Movie night', date: ymd(5), time: '20:00', category: 'hosting', taggedUserIds: [A.id] } });
// ... and a system reminder (normally the daily cron sends these), plus "money" comes from B paying A back in the UI
if (aTrash) {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  await owner.query(`INSERT INTO notification (user_id, household_id, section, source_type, source_id, message) VALUES ($1, $2, 'system', 'chore_assignment', $3, 'Reminder: Take out trash is due tomorrow at 7:00 PM.')`, [A.id, h.householdId, aTrash.assignmentId]);
  await owner.end();
}
console.log(`fixture ready: sign in as roomie-test-ui-a@example.com or roomie-test-ui-b@example.com (B owes A $21.50); household "UI Fixture House"`);

// Throwaway fixture for clicking through the UI by hand. Creates two roomie-test-* accounts with a
// known password, a household, and one expense where B owes A. Run `npm run test:cleanup` afterwards.
import { handle } from './dev-server.js';
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
console.log(`fixture ready: sign in as roomie-test-ui-b@example.com (B owes A $12.00); household "UI Fixture House"`);

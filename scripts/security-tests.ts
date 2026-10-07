// Live security tests for the /api routes. Real Neon Auth sign-ups, real tokens, real database.
// Everything created here is deleted at the end (and swept at the start if a past run crashed).
// Run after EVERY migration:  npm run test:security
import { randomBytes } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { buildRoutes, handle } from './dev-server.js';
import { countTestData, sweepTestData } from './lib/test-cleanup.js';

const routes = buildRoutes();
const ORIGIN = 'http://localhost:3001'; // allowed by Neon Auth (allow_localhost)
const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 2 });
const run = randomBytes(3).toString('hex');
let passed = 0, failed = 0;

const api = (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  handle(new Request(ORIGIN + path, {
    method: init.method ?? 'GET',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), routes);
const read = async (res: Response) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}
async function expectStatus(name: string, p: Promise<Response>, status: number) {
  const res = await p; check(name, res.status === status, `(got ${res.status}, wanted ${status})`); return res;
}

// Sign up through OUR domain's /api/auth proxy (same-origin cookie path), then fetch a JWT.
async function signUp(tag: string) {
  const email = `roomie-test-${run}-${tag}@example.com`;
  const res = await api('/api/auth/sign-up/email', { method: 'POST', body: { email, password: randomBytes(12).toString('base64url') + 'Aa1!', name: `Test ${tag.toUpperCase()}` } });
  if (res.status !== 200) throw new Error(`sign-up failed for ${tag}: ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const getJwt = async () => {
    const s = await api('/api/auth/get-session', { headers: { cookie } });
    const jwt = s.headers.get('set-auth-jwt');
    if (!jwt) throw new Error(`no set-auth-jwt for ${tag} (status ${s.status})`);
    return jwt;
  };
  return { tag, email, getJwt, token: await getJwt() };
}
// pg returns BIGINT as strings; compare ids with Number()
const sql = async (text: string, params: unknown[] = []) => (await owner.query(text, params)).rows;

async function main() {
  console.log(`sweeping leftovers from earlier runs: ${JSON.stringify(await sweepTestData(owner))}`);
  console.log(`\nsecurity tests, run ${run}`);

  const [A, B, C] = await Promise.all([signUp('a'), signUp('b'), signUp('c')]);

  console.log('\n[1] authentication');
  for (const p of ['/api/me', '/api/notifications', '/api/households/1/members', '/api/households/1/chores'])
    await expectStatus(`no token -> 401 on ${p}`, api(p), 401);
  await expectStatus('garbage token -> 401', api('/api/me', { token: 'not.a.jwt' }), 401);
  const { privateKey } = await generateKeyPair('EdDSA');
  const origin = new URL(process.env.NEON_AUTH_URL!).origin;
  const forged = await new SignJWT({ email: 'evil@example.com' }).setProtectedHeader({ alg: 'EdDSA' }).setSubject('forged-user')
    .setIssuer(origin).setAudience(origin).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  await expectStatus('token signed with someone else\'s key -> 401', api('/api/me', { token: forged }), 401);
  const wrongAud = await new SignJWT({ email: 'evil@example.com' }).setProtectedHeader({ alg: 'EdDSA' }).setSubject('x')
    .setIssuer('https://evil.example').setAudience('https://evil.example').setIssuedAt().setExpirationTime('10m').sign(privateKey);
  await expectStatus('token from a different issuer -> 401', api('/api/me', { token: wrongAud }), 401);
  check('forged token created no users row', (await sql(`SELECT 1 FROM users WHERE auth_provider_id IN ('forged-user','x')`)).length === 0);

  console.log('\n[2] first sign-in creates the users row, stores the provider id');
  const meA = await read(await expectStatus('A GET /api/me', api('/api/me', { token: A.token }), 200));
  const meB = await read(await api('/api/me', { token: B.token })); const meC = await read(await api('/api/me', { token: C.token }));
  const row = (await sql('SELECT auth_provider_id, email FROM users WHERE user_id=$1', [meA.user.userId]))[0];
  const authId = (await sql('SELECT id::text FROM neon_auth."user" WHERE email=$1', [A.email]))[0].id;
  check('users.auth_provider_id = Neon Auth user id', row?.auth_provider_id === authId);
  check('second call returns the same user (no duplicate)', (await read(await api('/api/me', { token: A.token }))).user.userId === meA.user.userId);
  check('a refreshed token maps to the same user', (await read(await api('/api/me', { token: await A.getJwt() }))).user.userId === meA.user.userId);

  console.log('\n[3] households: outsiders get nothing');
  // body tries to smuggle other identities / roles; only the token may decide who acts
  const created = await read(await expectStatus('A creates a household', api('/api/households', { method: 'POST', token: A.token,
    body: { householdName: 'Test House', userId: meB.user.userId, user_id: meB.user.userId, role: 'member', createdByUserId: meB.user.userId } }), 201));
  const hid = created.householdId as number;
  const owners = await sql(`SELECT user_id FROM household_member WHERE household_id=$1 AND role='owner'`, [hid]);
  check('creator is the token user, not the id in the body', owners.length === 1 && Number(owners[0].user_id) === meA.user.userId, JSON.stringify({ owners, A: meA.user.userId, B: meB.user.userId }));
  check('only one member row exists after create', (await sql('SELECT 1 FROM household_member WHERE household_id=$1', [hid])).length === 1);
  await expectStatus('outsider C: GET members -> 404', api(`/api/households/${hid}/members`, { token: C.token }), 404);
  await expectStatus('outsider C: GET chores -> 404', api(`/api/households/${hid}/chores`, { token: C.token }), 404);
  const missing = await api('/api/households/999999999/members', { token: C.token });
  const real = await api(`/api/households/${hid}/members`, { token: C.token });
  check('real and nonexistent households look identical to an outsider', missing.status === real.status && JSON.stringify(await read(missing)) === JSON.stringify(await read(real)));
  await expectStatus('household id comes from the path, not ?householdId', api(`/api/households/${hid}/chores?householdId=1`, { token: C.token }), 404);
  await expectStatus('bad household id -> 400', api('/api/households/abc/members', { token: A.token }), 400);
  await expectStatus('invalid join code -> 404', api('/api/households/join', { method: 'POST', token: C.token, body: { joinCode: 'NOPE0000' } }), 404);

  console.log('\n[4] joining: you can only join as yourself');
  await expectStatus('B joins with the code (body tries to join C instead)', api('/api/households/join', { method: 'POST', token: B.token, body: { joinCode: created.joinCode, userId: meC.user.userId } }), 200);
  const members = await sql('SELECT user_id, role FROM household_member WHERE household_id=$1 ORDER BY user_id', [hid]);
  check('B became a member, C did not', members.some((m) => Number(m.user_id) === meB.user.userId && m.role === 'member') && !members.some((m) => Number(m.user_id) === meC.user.userId), JSON.stringify({ members, B: meB.user.userId, C: meC.user.userId }));
  await expectStatus('B can now read members', api(`/api/households/${hid}/members`, { token: B.token }), 200);
  await expectStatus('C still gets nothing', api(`/api/households/${hid}/members`, { token: C.token }), 404);

  console.log('\n[5] moved-out roommates');
  await sql('UPDATE household_member SET left_date = now() WHERE household_id=$1 AND user_id=$2', [hid, meB.user.userId]);
  await expectStatus('B (moved out) can no longer read the household', api(`/api/households/${hid}/chores`, { token: B.token }), 404);
  const listA = await read(await api(`/api/households/${hid}/members`, { token: A.token }));
  const bRow = listA.members.find((m: { userId: number }) => m.userId === meB.user.userId);
  check('A still sees B in the history, with a left date', !!bRow && !!bRow.leftDate);
  const { assertActiveMembers } = await import('../api/_lib/household.js');
  const { db } = await import('../api/_lib/db.js');
  let blocked = false; try { await assertActiveMembers(db, hid, [meA.user.userId, meB.user.userId]); } catch { blocked = true; }
  check('a moved-out roommate cannot be targeted by new chores/shares/tags/notifications', blocked);
  await expectStatus('B rejoins with the code', api('/api/households/join', { method: 'POST', token: B.token, body: { joinCode: created.joinCode } }), 200);
  check('rejoin cleared left_date on the SAME row', (await sql('SELECT member_id, left_date FROM household_member WHERE household_id=$1 AND user_id=$2', [hid, meB.user.userId])).length === 1
    && (await sql('SELECT 1 FROM household_member WHERE household_id=$1 AND user_id=$2 AND left_date IS NULL', [hid, meB.user.userId])).length === 1);
  await expectStatus('B has access again', api(`/api/households/${hid}/chores`, { token: B.token }), 200);

  console.log('\n[6] notifications: only the recipient can read or change their own');
  const ins = async (uid: number, msg: string) => (await sql(
    `INSERT INTO notification (user_id, household_id, actor_user_id, section, message) VALUES ($1,$2,$3,'system',$4) RETURNING notification_id`, [uid, hid, meA.user.userId, msg]))[0].notification_id as number;
  const nA = await ins(meA.user.userId, 'for A'), nB = await ins(meB.user.userId, 'for B');
  const listNA = (await read(await api('/api/notifications', { token: A.token }))).notifications as { message: string }[];
  const listNB = (await read(await api('/api/notifications', { token: B.token }))).notifications as { message: string }[];
  const listNC = (await read(await api('/api/notifications', { token: C.token }))).notifications as unknown[];
  check('A sees only A\'s notifications', listNA.length === 1 && listNA[0]!.message === 'for A');
  check('B sees only B\'s notifications', listNB.length === 1 && listNB[0]!.message === 'for B');
  check('C (outsider) sees none', listNC.length === 0);
  const spoof = (await read(await api(`/api/notifications?userId=${meA.user.userId}`, { token: B.token }))).notifications as { message: string }[];
  check('?userId=<someone else> is ignored', spoof.length === 1 && spoof[0]!.message === 'for B');
  await expectStatus('B marking A\'s notification read -> 404', api(`/api/notifications/${nA}`, { method: 'PATCH', token: B.token, body: { isRead: true } }), 404);
  check('...and it stayed unread', (await sql('SELECT is_read FROM notification WHERE notification_id=$1', [nA]))[0].is_read === false);
  await expectStatus('C marking B\'s notification read -> 404', api(`/api/notifications/${nB}`, { method: 'PATCH', token: C.token, body: { isRead: true } }), 404);
  await expectStatus('A marking own notification read -> 200', api(`/api/notifications/${nA}`, { method: 'PATCH', token: A.token, body: { isRead: true } }), 200);
  check('...and it is now read', (await sql('SELECT is_read FROM notification WHERE notification_id=$1', [nA]))[0].is_read === true);
  await expectStatus('bad body -> 400', api(`/api/notifications/${nA}`, { method: 'PATCH', token: A.token, body: { isRead: 'yes' } }), 400);

  console.log('\n[7] the database itself is closed to everything except /api');
  const dataApi = await fetch(`${new URL(process.env.NEON_AUTH_URL!).origin.replace('neonauth', 'apirest')}/neondb/rest/v1/users?select=*`, { headers: { authorization: `Bearer ${A.token}` } });
  check('Neon Data API is OFF: a real signed-in token cannot read tables directly', dataApi.status === 503 || dataApi.status === 404, `(got ${dataApi.status})`);
  const priv = (await sql(`SELECT r.rolname, count(*) FILTER (WHERE has_table_privilege(r.rolname, format('public.%I', t.tablename), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS any_priv,
      count(*) FILTER (WHERE has_table_privilege(r.rolname, format('public.%I', t.tablename), 'SELECT')) AS can_select, count(*) AS tables
    FROM pg_roles r CROSS JOIN pg_tables t WHERE r.rolname IN ('authenticated','anonymous') AND t.schemaname='public' GROUP BY r.rolname`));
  check('authenticated and anonymous have zero privileges on every public table', priv.length === 2 && priv.every((r) => Number(r.any_priv) === 0 && Number(r.can_select) === 0 && Number(r.tables) >= 18), JSON.stringify(priv));
}

let exitCode = 0;
try { await main(); }
catch (e) { console.error('\nTEST RUN ERROR:', e); exitCode = 1; }
finally {
  const swept = await sweepTestData(owner);
  const left = await countTestData(owner);
  const clean = left.app_users === 0 && left.auth_users === 0 && left.households === 0;
  console.log(`\ncleanup: removed ${JSON.stringify(swept)}; leftover roomie-test data: ${JSON.stringify(left)} -> ${clean ? 'CLEAN' : 'NOT CLEAN'}`);
  if (!clean) exitCode = 1;
  await owner.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(exitCode || (failed ? 1 : 0));

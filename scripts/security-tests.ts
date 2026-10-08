// Live security tests for the /api routes. Real Neon Auth sign-ups, real tokens, real database.
// Everything created here is deleted at the end (and swept at the start if a past run crashed).
// Run after EVERY migration:  npm run test:security
import { randomBytes } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { handle } from './dev-server.js';
import { countTestData, sweepTestData } from './lib/test-cleanup.js';

const ORIGIN = 'http://localhost:3001'; // allowed by Neon Auth (allow_localhost)
const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 2 });
const run = randomBytes(3).toString('hex');
let passed = 0, failed = 0;

const api = (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  handle(new Request(ORIGIN + path, {
    method: init.method ?? 'GET',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
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

  const [A, B, C, D] = await Promise.all([signUp('a'), signUp('b'), signUp('c'), signUp('d')]);

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
  const meB = await read(await api('/api/me', { token: B.token })); const meC = await read(await api('/api/me', { token: C.token })); const meD = await read(await api('/api/me', { token: D.token }));
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

  // =====================================================================================================
  console.log('\n[8] expense tracker: money rules over the real API');
  const uA = meA.user.userId as number, uB = meB.user.userId as number, uC = meC.user.userId as number, uD = meD.user.userId as number;
  const H2 = (await read(await api('/api/households', { method: 'POST', token: A.token, body: { householdName: 'Money House' } })));
  const h2 = H2.householdId as number;
  await api('/api/households/join', { method: 'POST', token: B.token, body: { joinCode: H2.joinCode } });
  const p2 = (path: string) => `/api/households/${h2}${path}`;
  const post = (path: string, token: string, body: unknown) => api(p2(path), { method: 'POST', token, body });
  const patch = (path: string, token: string, body: unknown) => api(p2(path), { method: 'PATCH', token, body });
  const del = (path: string, token: string) => api(p2(path), { method: 'DELETE', token });
  const get = async (path: string, token: string) => read(await api(p2(path), { token }));
  const count = async (q: string, params: unknown[] = []) => Number((await sql(q, params))[0].n);
  const exCount = () => count('SELECT count(*) n FROM expense WHERE household_id=$1', [h2]);
  const noteCount = () => count('SELECT count(*) n FROM notification WHERE household_id=$1', [h2]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

  console.log(' [8a] logging an expense');
  const r1 = await post('/expenses', A.token, { itemName: 'Paper towels', totalAmount: '10.01', participantUserIds: [uB], paidByUserId: uB, paid_by_user_id: uB, purchaseDate: today });
  const e1b = await read(r1);
  check('A logs a $10.01 expense split with B (201)', r1.status === 201, JSON.stringify(e1b));
  const e1 = e1b.expenseId as number;
  const dbE1 = (await sql('SELECT paid_by_user_id, total_amount FROM expense WHERE expense_id=$1', [e1]))[0];
  check('paid_by is the token user, even though the body named B', Number(dbE1.paid_by_user_id) === uA);
  const sh1 = await sql('SELECT user_id, amount_owed FROM expense_share WHERE expense_id=$1 ORDER BY amount_owed DESC, user_id', [e1]);
  check('leftover cent goes to the first share (buyer): A 5.01, B 5.00', sh1.length === 2 && sh1[0].amount_owed === '5.01' && Number(sh1[0].user_id) === uA && sh1[1].amount_owed === '5.00');
  check('shares sum exactly to the total', (await sql('SELECT sum(amount_owed) s FROM expense_share WHERE expense_id=$1', [e1]))[0].s === '10.01');
  const noteB = await sql(`SELECT section, source_type, source_id, message FROM notification WHERE user_id=$1 AND household_id=$2`, [uB, h2]);
  check('B is notified (expense_tracker, pointing at the expense), A is not', noteB.length === 1 && noteB[0].section === 'expense_tracker' && noteB[0].source_type === 'expense' && Number(noteB[0].source_id) === e1 && /\$5\.00/.test(noteB[0].message)
    && (await count('SELECT count(*) n FROM notification WHERE user_id=$1 AND household_id=$2', [uA, h2])) === 0, JSON.stringify(noteB));

  console.log(' [8b] bad input is rejected and leaves nothing behind');
  const before = { e: await exCount(), n: await noteCount() };
  const bad = async (name: string, body: unknown) => { const r = await post('/expenses', A.token, body); check(`${name} -> 400`, r.status === 400, `(got ${r.status}: ${(await r.text()).slice(0, 80)})`); };
  await bad('total 0', { itemName: 'x', totalAmount: '0', participantUserIds: [uB] });
  await bad('total with 3 decimals', { itemName: 'x', totalAmount: '12.345', participantUserIds: [uB] });
  await bad('total as a float number', { itemName: 'x', totalAmount: 12.34, participantUserIds: [uB] });
  await bad('negative total', { itemName: 'x', totalAmount: '-5.00', participantUserIds: [uB] });
  await bad('total over $1,000,000', { itemName: 'x', totalAmount: '1000000.01', participantUserIds: [uB] });
  await bad('empty item name', { itemName: '   ', totalAmount: '5.00', participantUserIds: [uB] });
  await bad('no other roommate to split with', { itemName: 'x', totalAmount: '5.00', participantUserIds: [uA] });
  await bad('participant who is not in the household (D)', { itemName: 'x', totalAmount: '5.00', participantUserIds: [uB, uD] });
  await bad('participant id is not a number', { itemName: 'x', totalAmount: '5.00', participantUserIds: ['abc'] });
  await bad('purchase date in the future', { itemName: 'x', totalAmount: '5.00', participantUserIds: [uB], purchaseDate: '2099-01-01' });
  await bad('impossible date', { itemName: 'x', totalAmount: '5.00', participantUserIds: [uB], purchaseDate: '2026-02-31' });
  await bad('total too small to split ($0.01 three ways)', { itemName: 'x', totalAmount: '0.01', participantUserIds: [uB, uC] });
  check('none of those left an expense or a notification behind', (await exCount()) === before.e && (await noteCount()) === before.n);
  const tiny = await post('/expenses', A.token, { itemName: 'Penny split', totalAmount: '0.02', participantUserIds: [uB] });
  const tinyId = (await read(tiny.clone())).expenseId as number;
  check('$0.02 between two people is exactly 0.01 each', tiny.status === 201 && (await sql('SELECT array_agg(amount_owed::text) a FROM expense_share WHERE expense_id=$1', [tinyId]))[0].a.join() === '0.01,0.01');
  await expectStatus('(clean up: A deletes the penny expense so later balances are round numbers)', api(p2(`/expenses/${tinyId}`), { method: 'DELETE', token: A.token }), 200);

  console.log(' [8c] outsiders get nothing');
  for (const [name, res] of [
    ['GET expenses', api(p2('/expenses'), { token: D.token })], ['POST expense', api(p2('/expenses'), { method: 'POST', token: D.token, body: { itemName: 'x', totalAmount: '5.00', participantUserIds: [uA] } })],
    ['GET balances', api(p2('/balances'), { token: D.token })], ['POST payment', api(p2('/payments'), { method: 'POST', token: D.token, body: { payeeUserId: uA, expenseIds: [e1], paidWith: 'venmo' } })],
    ['PATCH payment', api(p2('/payments/1'), { method: 'PATCH', token: D.token, body: { status: 'confirmed' } })], ['GET wishlist', api(p2('/wishlist'), { token: D.token })],
    ['POST wishlist', api(p2('/wishlist'), { method: 'POST', token: D.token, body: { itemName: 'x', needOrWant: 'need' } })], ['DELETE expense', api(p2(`/expenses/${e1}`), { method: 'DELETE', token: D.token })],
  ] as const) await expectStatus(`outsider D: ${name} -> 404`, res, 404);

  console.log(' [8d] only the buyer can delete');
  await expectStatus('B cannot delete A\'s expense (403)', api(p2(`/expenses/${e1}`), { method: 'DELETE', token: B.token }), 403);
  check('...and it still exists', (await count('SELECT count(*) n FROM expense WHERE expense_id=$1', [e1])) === 1);
  const e2 = (await read(await post('/expenses', A.token, { itemName: 'Delete me', totalAmount: '9.00', participantUserIds: [uB] }))).expenseId as number;
  await expectStatus('A deletes an unpaid expense of their own (200)', api(p2(`/expenses/${e2}`), { method: 'DELETE', token: A.token }), 200);
  check('...its shares and its notifications are gone too', (await count('SELECT count(*) n FROM expense_share WHERE expense_id=$1', [e2])) === 0 && (await count(`SELECT count(*) n FROM notification WHERE source_type='expense' AND source_id=$1`, [e2])) === 0);

  console.log(' [8e] a roommate who joins later owes nothing on earlier expenses');
  await api('/api/households/join', { method: 'POST', token: C.token, body: { joinCode: H2.joinCode } });
  const cList = (await get('/expenses', C.token)).expenses as { expenseId: number; shares: { userId: number }[] }[];
  check('C sees the household\'s expense history', cList.some((e) => e.expenseId === e1) && cList.length === 1);
  check('C has no share on any earlier expense', cList.every((e) => e.shares.every((x) => x.userId !== uC)) && (await count('SELECT count(*) n FROM expense_share WHERE user_id=$1', [uC])) === 0);
  const cBal = await get('/balances', C.token);
  check('C owes nothing and is owed nothing; nothing for C to pay', cBal.mine.length === 0 && cBal.payable.length === 0 && cBal.incoming.length === 0);
  check('C still sees the household\'s other balances (B owes A $5.00)', cBal.pairs.some((x: { debtorUserId: number; creditorUserId: number; amount: string }) => x.debtorUserId === uB && x.creditorUserId === uA && x.amount === '5.00'));
  await expectStatus('C cannot "pay back" an expense they have no share in (400)', api(p2('/payments'), { method: 'POST', token: C.token, body: { payeeUserId: uA, expenseIds: [e1], paidWith: 'venmo' } }), 400);

  console.log(' [8f] paying back: only confirmed payments count');
  const bBal0 = await get('/balances', B.token);
  check('B sees the $5.00 as payable, to A', bBal0.payable.length === 1 && bBal0.payable[0].expenseId === e1 && bBal0.payable[0].payeeUserId === uA && bBal0.payable[0].amountOwed === '5.00');
  for (const [name, body, st] of [
    ['unknown payment app', { payeeUserId: uA, expenseIds: [e1], paidWith: 'paypal' }, 400], ['paying yourself', { payeeUserId: uB, expenseIds: [e1], paidWith: 'venmo' }, 400],
    ['payee outside the household', { payeeUserId: uD, expenseIds: [e1], paidWith: 'venmo' }, 400], ['no items', { payeeUserId: uA, expenseIds: [], paidWith: 'venmo' }, 400],
    ['A\'s own (buyer) share', null, 0],
  ] as const) { if (!body) continue; await expectStatus(`B: ${name} -> ${st}`, api(p2('/payments'), { method: 'POST', token: B.token, body }), st); }
  await expectStatus('A cannot pay B for A\'s own purchase (the buyer share is never owed) (400)', api(p2('/payments'), { method: 'POST', token: A.token, body: { payeeUserId: uB, expenseIds: [e1], paidWith: 'venmo' } }), 400);
  const pay1 = await read(await post('/payments', B.token, { payeeUserId: uA, expenseIds: [e1], paidWith: 'venmo', amount: '0.01', status: 'confirmed' }));
  check('B pays back; the amount is computed ($5.00), not taken from the request ($0.01); status starts at sent', pay1.amount === '5.00' && pay1.status === 'sent', JSON.stringify(pay1));
  const pRow = (await sql('SELECT payer_user_id, payee_user_id, amount, status FROM payment WHERE payment_id=$1', [pay1.paymentId]))[0];
  check('payment row: payer B, payee A, sent', Number(pRow.payer_user_id) === uB && Number(pRow.payee_user_id) === uA && pRow.status === 'sent');
  check('B\'s share now points at that payment (set in the same transaction)', Number((await sql('SELECT settled_by_payment_id s FROM expense_share WHERE expense_id=$1 AND user_id=$2', [e1, uB]))[0].s) === pay1.paymentId);
  check('A was notified in the money section, pointing at the payment', (await count(`SELECT count(*) n FROM notification WHERE user_id=$1 AND section='money' AND source_type='payment' AND source_id=$2`, [uA, pay1.paymentId])) === 1);
  await expectStatus('paying the same item twice (400)', api(p2('/payments'), { method: 'POST', token: B.token, body: { payeeUserId: uA, expenseIds: [e1], paidWith: 'zelle' } }), 400);
  const afterSent = await get('/balances', A.token);
  const pairSent = afterSent.pairs.find((x: { debtorUserId: number }) => x.debtorUserId === uB);
  check('a SENT payment does not reduce the balance: B still owes $5.00, shown as pending', pairSent?.amount === '5.00' && pairSent?.pendingAmount === '5.00', JSON.stringify(pairSent));
  const eShare = ((await get('/expenses', B.token)).expenses as { expenseId: number; shares: { userId: number; status: string }[] }[]).find((e) => e.expenseId === e1)!.shares.find((x) => x.userId === uB)!;
  check('B\'s share shows as pending (derived from the payment, no is_paid flag)', eShare.status === 'pending');
  check('A sees the payment waiting for confirmation', afterSent.incoming.some((x: { paymentId: number; status: string }) => x.paymentId === pay1.paymentId && x.status === 'sent'));
  await expectStatus('B cannot confirm their own payment (404)', api(p2(`/payments/${pay1.paymentId}`), { method: 'PATCH', token: B.token, body: { status: 'confirmed' } }), 404);
  await expectStatus('C cannot confirm it (404)', api(p2(`/payments/${pay1.paymentId}`), { method: 'PATCH', token: C.token, body: { status: 'confirmed' } }), 404);
  await expectStatus('invalid status (400)', api(p2(`/payments/${pay1.paymentId}`), { method: 'PATCH', token: A.token, body: { status: 'paid' } }), 400);
  check('...none of that changed the payment', (await sql('SELECT status FROM payment WHERE payment_id=$1', [pay1.paymentId]))[0].status === 'sent');
  await expectStatus('B cannot delete an expense that has a payment on it (A is the buyer: 403 first)', api(p2(`/expenses/${e1}`), { method: 'DELETE', token: B.token }), 403);
  await expectStatus('A cannot delete it either: someone already paid (409)', api(p2(`/expenses/${e1}`), { method: 'DELETE', token: A.token }), 409);
  await expectStatus('A confirms receipt (200)', api(p2(`/payments/${pay1.paymentId}`), { method: 'PATCH', token: A.token, body: { status: 'confirmed' } }), 200);
  const afterConf = await get('/balances', A.token);
  check('a CONFIRMED payment clears the balance', !afterConf.pairs.some((x: { debtorUserId: number }) => x.debtorUserId === uB));
  check('B\'s share now shows as paid', ((await get('/expenses', B.token)).expenses as { expenseId: number; shares: { userId: number; status: string }[] }[]).find((e) => e.expenseId === e1)!.shares.find((x) => x.userId === uB)!.status === 'paid');
  check('B was told it was confirmed', (await count(`SELECT count(*) n FROM notification WHERE user_id=$1 AND section='money' AND message LIKE '%confirmed%'`, [uB])) === 1);
  await expectStatus('confirming again (400: already confirmed)', api(p2(`/payments/${pay1.paymentId}`), { method: 'PATCH', token: A.token, body: { status: 'confirmed' } }), 400);
  await expectStatus('disputing a confirmed payment (400)', api(p2(`/payments/${pay1.paymentId}`), { method: 'PATCH', token: A.token, body: { status: 'disputed' } }), 400);

  console.log(' [8g] disputes');
  const e3 = (await read(await post('/expenses', A.token, { itemName: 'Pizza', totalAmount: '20.00', participantUserIds: [uB, uC] }))).expenseId as number;
  check('$20.00 three ways = 6.67 / 6.67 / 6.66, summing to 20.00', (await sql('SELECT array_agg(amount_owed::text ORDER BY amount_owed DESC, user_id) a FROM expense_share WHERE expense_id=$1', [e3]))[0].a.join() === '6.67,6.67,6.66');
  const pay2 = await read(await post('/payments', B.token, { payeeUserId: uA, expenseIds: [e3], paidWith: 'zelle' }));
  await expectStatus('A says "I did not get it" (200)', api(p2(`/payments/${pay2.paymentId}`), { method: 'PATCH', token: A.token, body: { status: 'disputed' } }), 200);
  const disp = (await get('/balances', A.token)).pairs.find((x: { debtorUserId: number; creditorUserId: number }) => x.debtorUserId === uB && x.creditorUserId === uA);
  check('a DISPUTED payment does not count: B still owes 6.67, flagged as disputed', disp?.amount === '6.67' && disp?.disputedAmount === '6.67' && disp?.pendingAmount === '0.00', JSON.stringify(disp));
  check('B\'s share shows as disputed', ((await get('/expenses', B.token)).expenses as { expenseId: number; shares: { userId: number; status: string }[] }[]).find((e) => e.expenseId === e3)!.shares.find((x) => x.userId === uB)!.status === 'disputed');
  check('B was told about the dispute', (await count(`SELECT count(*) n FROM notification WHERE user_id=$1 AND message LIKE '%did not get%'`, [uB])) === 1);
  await expectStatus('B cannot pay the same item again while it is disputed (400)', api(p2('/payments'), { method: 'POST', token: B.token, body: { payeeUserId: uA, expenseIds: [e3], paidWith: 'venmo' } }), 400);
  await expectStatus('A can still confirm later if the money turns up (200)', api(p2(`/payments/${pay2.paymentId}`), { method: 'PATCH', token: A.token, body: { status: 'confirmed' } }), 200);
  check('...and then B owes A nothing', !(await get('/balances', A.token)).pairs.some((x: { debtorUserId: number; creditorUserId: number }) => x.debtorUserId === uB && x.creditorUserId === uA));
  const pairC = (await get('/balances', C.token)).pairs.find((x: { debtorUserId: number }) => x.debtorUserId === uC);
  check('C (who was tagged on the pizza) owes A 6.66', pairC?.amount === '6.66' && pairC?.creditorUserId === uA);

  console.log(' [8h] who owes who nets in BOTH directions');
  await post('/expenses', B.token, { itemName: 'Groceries', totalAmount: '30.00', participantUserIds: [uA] });
  const pa = (await get('/balances', A.token)).pairs.find((x: { debtorUserId: number; creditorUserId: number }) => x.debtorUserId === uA && x.creditorUserId === uB);
  check('B bought $30 for two: A owes B 15.00', pa?.amount === '15.00');
  await post('/expenses', A.token, { itemName: 'Lamp', totalAmount: '50.00', participantUserIds: [uB] });
  const flip = (await get('/balances', A.token)).pairs.filter((x: { debtorUserId: number; creditorUserId: number }) => [x.debtorUserId, x.creditorUserId].sort().join() === [uA, uB].sort().join());
  check('then A buys a $50 lamp for two: B now owes A 10.00 (25.00 minus 15.00), one netted line', flip.length === 1 && flip[0].debtorUserId === uB && flip[0].creditorUserId === uA && flip[0].amount === '10.00', JSON.stringify(flip));

  console.log(' [8i] wish list: only the creator can edit or delete');
  const w1r = await post('/wishlist', B.token, { itemName: 'Air fryer', needOrWant: 'want', estimatedPrice: '59.99', itemLink: 'https://example.com/air-fryer', description: 'for the oven-free dinners', createdByUserId: uA, created_by_user_id: uA });
  const w1 = await read(w1r);
  check('B adds a wish list item (201), created_by = B even though the body said A', w1r.status === 201 && Number((await sql('SELECT created_by_user_id c FROM wishlist_item WHERE wishlist_item_id=$1', [w1.wishlistItemId]))[0].c) === uB);
  check('A and C are notified (expense_tracker, wishlist_item), B is not', (await count(`SELECT count(*) n FROM notification WHERE section='expense_tracker' AND source_type='wishlist_item' AND source_id=$1 AND user_id IN ($2,$3)`, [w1.wishlistItemId, uA, uC])) === 2
    && (await count(`SELECT count(*) n FROM notification WHERE source_type='wishlist_item' AND source_id=$1 AND user_id=$2`, [w1.wishlistItemId, uB])) === 0);
  await expectStatus('A cannot edit B\'s item (403)', api(p2(`/wishlist/${w1.wishlistItemId}`), { method: 'PATCH', token: A.token, body: { itemName: 'Hacked' } }), 403);
  await expectStatus('A cannot delete B\'s item (403)', api(p2(`/wishlist/${w1.wishlistItemId}`), { method: 'DELETE', token: A.token }), 403);
  check('...the item is unchanged', (await sql('SELECT item_name FROM wishlist_item WHERE wishlist_item_id=$1', [w1.wishlistItemId]))[0].item_name === 'Air fryer');
  await expectStatus('B edits their own item (200)', api(p2(`/wishlist/${w1.wishlistItemId}`), { method: 'PATCH', token: B.token, body: { estimatedPrice: '54.99' } }), 200);
  const wl = (await get('/wishlist', A.token)).items as { wishlistItemId: number; canEdit: boolean }[];
  check('canEdit is false for A and true for B on B\'s item', wl.find((x) => x.wishlistItemId === w1.wishlistItemId)!.canEdit === false && (await get('/wishlist', B.token)).items.find((x: { wishlistItemId: number }) => x.wishlistItemId === w1.wishlistItemId).canEdit === true);
  for (const [name, b] of [['javascript: link', { itemLink: 'javascript:alert(1)' }], ['ftp: link', { itemLink: 'ftp://example.com/x' }], ['negative price', { estimatedPrice: '-1' }], ['"maybe" instead of need/want', { needOrWant: 'maybe' }], ['300-char name', { itemName: 'x'.repeat(300) }]] as const)
    await expectStatus(`B: ${name} -> 400`, api(p2(`/wishlist/${w1.wishlistItemId}`), { method: 'PATCH', token: B.token, body: b }), 400);
  await expectStatus('new item with a javascript: link -> 400', api(p2('/wishlist'), { method: 'POST', token: B.token, body: { itemName: 'x', needOrWant: 'need', itemLink: 'javascript:alert(1)' } }), 400);

  console.log(' [8j] buying a wish list item');
  const beforeW = { e: await exCount(), n: await noteCount() };
  const buy = await post('/expenses', A.token, { itemName: 'Air fryer', totalAmount: '54.99', participantUserIds: [uB, uC], wishlistItemId: w1.wishlistItemId });
  const buyId = (await read(buy)).expenseId as number;
  check('A buys it (201) and the item is marked bought', buy.status === 201 && (await sql('SELECT is_bought b FROM wishlist_item WHERE wishlist_item_id=$1', [w1.wishlistItemId]))[0].b === true);
  const afterBuy = { e: await exCount(), n: await noteCount() };
  const again = await post('/expenses', B.token, { itemName: 'Air fryer again', totalAmount: '54.99', participantUserIds: [uA], wishlistItemId: w1.wishlistItemId });
  check('buying the same item twice is refused (400) and creates NOTHING (all-or-nothing)', again.status === 400 && (await exCount()) === afterBuy.e && (await noteCount()) === afterBuy.n, `(${again.status})`);
  void beforeW;
  await expectStatus('deleting that expense (nobody has paid yet) works', api(p2(`/expenses/${buyId}`), { method: 'DELETE', token: A.token }), 200);
  check('...and the wish list item goes back to "not bought"', (await sql('SELECT is_bought b FROM wishlist_item WHERE wishlist_item_id=$1', [w1.wishlistItemId]))[0].b === false);
  await expectStatus('B deletes their own wish list item (200)', api(p2(`/wishlist/${w1.wishlistItemId}`), { method: 'DELETE', token: B.token }), 200);
  check('...and its notifications are removed', (await count(`SELECT count(*) n FROM notification WHERE source_type='wishlist_item' AND source_id=$1`, [w1.wishlistItemId])) === 0);

  console.log(' [8k] roommates who moved out');
  const e6 = (await read(await post('/expenses', C.token, { itemName: 'Cleaning spray', totalAmount: '9.00', participantUserIds: [uA, uB] }))).expenseId as number; // C buys while still living there
  await sql('UPDATE household_member SET left_date = now() WHERE household_id=$1 AND user_id=$2', [h2, uC]);
  const nBefore = await count('SELECT count(*) n FROM notification WHERE user_id=$1', [uC]);
  const nExp = await exCount();
  const withEx = await post('/expenses', A.token, { itemName: 'After C left', totalAmount: '12.00', participantUserIds: [uB, uC] });
  check('A cannot split a NEW expense with someone who moved out (400), nothing created', withEx.status === 400 && (await exCount()) === nExp);
  await expectStatus('C (moved out) can no longer use the household (404)', api(p2('/expenses'), { token: C.token }), 404);
  check('C\'s old balance is still visible to the household, netted: owes A 6.66 for pizza minus 3.00 A owes C for the spray = 3.66', (await get('/balances', A.token)).pairs.some((x: { debtorUserId: number; creditorUserId: number; amount: string }) => x.debtorUserId === uC && x.creditorUserId === uA && x.amount === '3.66'));
  const payC = await post('/payments', A.token, { payeeUserId: uC, expenseIds: [e6], paidWith: 'venmo' });
  check('A can still pay back C for something C bought before moving out (201)', payC.status === 201, `(${payC.status})`);
  check('...but C gets no notification', (await count('SELECT count(*) n FROM notification WHERE user_id=$1', [uC])) === nBefore);
  const wlC = await post('/wishlist', A.token, { itemName: 'After C left', needOrWant: 'need' });
  check('a wish list item added after C left is accepted (201)', wlC.status === 201);
  check('...and C (moved out) got no notification for it', (await count('SELECT count(*) n FROM notification WHERE user_id=$1', [uC])) === nBefore);
  check('...while the current roommates did', (await count(`SELECT count(*) n FROM notification WHERE source_type='wishlist_item' AND source_id=$1 AND user_id IN ($2,$3)`, [(await read(wlC.clone())).wishlistItemId, uA, uB])) === 1);

  console.log(' [8l] database invariants after all of the above');
  check('every expense: shares sum exactly to total_amount', (await sql(`SELECT 1 FROM expense e JOIN (SELECT expense_id, sum(amount_owed) s FROM expense_share GROUP BY 1) x USING (expense_id) WHERE e.household_id=$1 AND x.s <> e.total_amount`, [h2])).length === 0);
  check('every payment equals the sum of the shares it settles', (await sql(`SELECT 1 FROM payment p LEFT JOIN (SELECT settled_by_payment_id id, sum(amount_owed) s FROM expense_share WHERE settled_by_payment_id IS NOT NULL GROUP BY 1) x ON x.id=p.payment_id WHERE p.household_id=$1 AND p.amount <> coalesce(x.s,0)`, [h2])).length === 0);
  check('no payment settles a buyer\'s own share, and every share settled by a payment is the payer\'s', (await sql(`SELECT 1 FROM expense_share s JOIN expense e USING (expense_id) JOIN payment p ON p.payment_id=s.settled_by_payment_id WHERE e.household_id=$1 AND (s.user_id=e.paid_by_user_id OR p.payer_user_id<>s.user_id OR p.payee_user_id<>e.paid_by_user_id)`, [h2])).length === 0);
  check('no share belongs to someone outside the household', (await sql(`SELECT 1 FROM expense_share s JOIN expense e USING (expense_id) WHERE e.household_id=$1 AND NOT EXISTS (SELECT 1 FROM household_member m WHERE m.household_id=e.household_id AND m.user_id=s.user_id)`, [h2])).length === 0);

  // =====================================================================================================
  console.log('\n[9] chores: rules, generated occurrences, rotation, reminders, swap and skip');
  const { generateAll, sendDueReminders } = await import('../api/_lib/chores.js');
  const { addDays: addD, dayOfWeek: dow } = await import('../shared/chore-dates.js');
  const H3 = await read(await api('/api/households', { method: 'POST', token: A.token, body: { householdName: 'Chore House', timezone: 'America/Denver' } }));
  const h3 = H3.householdId as number;
  for (const t of [B.token, C.token]) await api('/api/households/join', { method: 'POST', token: t, body: { joinCode: H3.joinCode } });
  const p3 = (path: string) => `/api/households/${h3}${path}`;
  const post3 = (path: string, token: string, body: unknown) => api(p3(path), { method: 'POST', token, body });
  const patch3 = (path: string, token: string, body: unknown) => api(p3(path), { method: 'PATCH', token, body });
  const del3 = (path: string, token: string) => api(p3(path), { method: 'DELETE', token });
  const list3 = async (token: string) => read(await api(p3('/chores'), { token })) as Promise<{ chores: any[]; assignments: any[]; swapRequests: any[] }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const asg = async (choreId: number) => (await sql('SELECT assignment_id, assigned_user_id, is_completed, completed_at, due_at, last_reminded_at FROM chore_assignment WHERE chore_id=$1 ORDER BY due_at', [choreId]));
  const notes3 = (q: string, params: unknown[] = []) => count(`SELECT count(*) n FROM notification WHERE household_id=${h3} AND ${q}`, params);
  const tomorrow = addD(today, 1), inDays = (n: number) => addD(today, n);
  const mk = async (body: Record<string, unknown>, token = A.token) => { const r = await post3('/chores', token, body); return { status: r.status, body: await read(r) }; };

  console.log(' [9a] adding a chore: validation, and outsiders');
  const goodOne = { choreName: 'x', repeats: 'none', date: inDays(2), dueTime: '18:00', assignment: { mode: 'person', userId: uB } };
  const before9 = { c: await count('SELECT count(*) n FROM chore WHERE household_id=$1', [h3]), n: await notes3('true') };
  for (const [name, body] of [
    ['no name', { ...goodOne, choreName: ' ' }], ['unknown repeat type', { ...goodOne, repeats: 'daily' }], ['bad time', { ...goodOne, dueTime: '7pm' }], ['missing time', { ...goodOne, dueTime: undefined }],
    ['one-time without a date', { ...goodOne, date: undefined }], ['impossible date', { ...goodOne, date: '2026-02-31' }], ['one-time in the past', { ...goodOne, date: '2020-01-01' }],
    ['weekly without a weekday', { ...goodOne, repeats: 'weekly', date: undefined }], ['weekday 9', { ...goodOne, repeats: 'weekly', dayOfWeek: 9 }], ['monthly day 32', { ...goodOne, repeats: 'monthly', dayOfMonth: 32 }],
    ['bad effort', { ...goodOne, effort: 'brutal' }], ['no assignee', { ...goodOne, assignment: undefined }], ['rotation of one', { ...goodOne, repeats: 'weekly', dayOfWeek: 1, assignment: { mode: 'rotate', userIds: [uA] } }],
    ['one-time with a rotation', { ...goodOne, assignment: { mode: 'rotate', userIds: [uA, uB] } }], ['assigned to someone outside the household', { ...goodOne, assignment: { mode: 'person', userId: uD } }],
    ['rotation including an outsider', { ...goodOne, repeats: 'weekly', dayOfWeek: 1, assignment: { mode: 'rotate', userIds: [uA, uD] } }], ['300-char description', { ...goodOne, description: 'x'.repeat(600) }],
  ] as const) { const r = await mk(body as Record<string, unknown>); check(`${name} -> 400`, r.status === 400, `(got ${r.status}: ${JSON.stringify(r.body).slice(0, 80)})`); }
  check('none of those created a chore or a notification', (await count('SELECT count(*) n FROM chore WHERE household_id=$1', [h3])) === before9.c && (await notes3('true')) === before9.n);
  for (const [name, res] of [['GET chores', api(p3('/chores'), { token: D.token })], ['POST chore', api(p3('/chores'), { method: 'POST', token: D.token, body: goodOne })], ['PATCH chore', api(p3('/chores/1'), { method: 'PATCH', token: D.token, body: { choreName: 'x' } })],
    ['DELETE chore', api(p3('/chores/1'), { method: 'DELETE', token: D.token })], ['complete', api(p3('/assignments/1/complete'), { method: 'POST', token: D.token })], ['remind', api(p3('/assignments/1/remind'), { method: 'POST', token: D.token })],
    ['swap request', api(p3('/swap-requests'), { method: 'POST', token: D.token, body: { type: 'skip', requesterAssignmentId: 1, message: 'x' } })], ['answer a request', api(p3('/swap-requests/1'), { method: 'PATCH', token: D.token, body: { action: 'accept' } })]] as const)
    await expectStatus(`outsider D: ${name} -> 404`, res, 404);

  console.log(' [9b] a weekly chore that rotates A -> B -> C');
  const wd = (dow(today) + 2) % 7;
  const rot = await mk({ choreName: 'Take out trash', description: 'Bins to the curb', repeats: 'weekly', dayOfWeek: wd, dueTime: '19:00', effort: 'easy', assignment: { mode: 'rotate', userIds: [uA, uB, uC] }, createdByUserId: uB });
  check('created (201) with the first occurrences generated', rot.status === 201 && rot.body.occurrences === 4, JSON.stringify(rot.body));
  const rotId = rot.body.choreId as number;
  check('created_by is the caller, not the id in the body', Number((await sql('SELECT created_by_user_id c FROM chore WHERE chore_id=$1', [rotId]))[0].c) === uA);
  let rows = await asg(rotId);
  check('occurrences go in turn: A, B, C, A', rows.map((r) => Number(r.assigned_user_id)).join() === [uA, uB, uC, uA].join(), rows.map((r) => r.assigned_user_id).join());
  check('rotation order is stored: A=1, B=2, C=3', (await sql('SELECT array_agg(user_id ORDER BY turn_order) a FROM chore_rotation WHERE chore_id=$1', [rotId]))[0].a.map(Number).join() === [uA, uB, uC].join());
  check('every due time is 19:00 in the HOUSEHOLD timezone (America/Denver)', (await sql(`SELECT bool_and((due_at AT TIME ZONE 'America/Denver')::time = '19:00') ok FROM chore_assignment WHERE chore_id=$1`, [rotId]))[0].ok === true);
  check('B and C were told about their first turn (chores section), A (the creator) was not', (await notes3(`section='chores' AND source_type='chore_assignment' AND user_id IN ($1,$2)`, [uB, uC])) === 2 && (await notes3(`user_id=$1`, [uA])) === 0);
  const g1 = await generateAll({ householdId: h3 }), g2 = await generateAll({ householdId: h3 });
  check('running the generator again creates nothing (safe to re-run)', g1.created === 0 && g2.created === 0 && (await asg(rotId)).length === 4, JSON.stringify([g1, g2]));
  const nowIso = new Date().toISOString();
  const g3 = await generateAll({ householdId: h3, asOf: { today: addD(today, 14), nowIso } });
  rows = await asg(rotId);
  check('weeks later the generator tops up the next occurrences and the rotation continues (B next, after A)', g3.created >= 2 && rows.length === 4 + g3.created && Number(rows[4].assigned_user_id) === uB, `${g3.created} new; next=${rows[4]?.assigned_user_id}`);
  check('and still never twice for the same due_at', (await sql(`SELECT 1 FROM chore_assignment WHERE chore_id=$1 GROUP BY due_at HAVING count(*) > 1`, [rotId])).length === 0);

  console.log(' [9c] daylight saving: 6 PM stays 6 PM local when the clocks change');
  const dst = await mk({ choreName: 'Sunday reset', repeats: 'weekly', dayOfWeek: 0, date: '2026-10-24', dueTime: '18:00', assignment: { mode: 'person', userId: uA } });
  await generateAll({ householdId: h3, asOf: { today: '2026-10-24', nowIso: '2026-10-24T06:00:00Z' } });
  const dstRows = await sql(`SELECT to_char(due_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') utc, to_char(due_at AT TIME ZONE 'America/Denver','YYYY-MM-DD HH24:MI') local FROM chore_assignment WHERE chore_id=$1 AND due_at BETWEEN '2026-10-25' AND '2026-11-03' ORDER BY due_at`, [dst.body.choreId]);
  check('Oct 25 (still daylight time) is 18:00 local = 00:00 UTC next day', dstRows[0]?.local === '2026-10-25 18:00' && dstRows[0]?.utc === '2026-10-26 00:00', JSON.stringify(dstRows[0]));
  check('Nov 1 (the day the clocks fall back) is STILL 18:00 local = 01:00 UTC next day', dstRows[1]?.local === '2026-11-01 18:00' && dstRows[1]?.utc === '2026-11-02 01:00', JSON.stringify(dstRows[1]));

  console.log(' [9d] monthly on the 31st');
  const mon = await mk({ choreName: 'Pay rent reminder', repeats: 'monthly', dayOfMonth: 31, dueTime: '09:00', assignment: { mode: 'person', userId: uB } });
  await generateAll({ householdId: h3, horizonDays: 200 });
  const monRows = await sql(`SELECT (due_at AT TIME ZONE 'America/Denver')::date d, (date_trunc('month', due_at AT TIME ZONE 'America/Denver') + interval '1 month - 1 day')::date last FROM chore_assignment WHERE chore_id=$1`, [mon.body.choreId]);
  check('every occurrence lands on the LAST day of its month (Feb 28, Apr 30, ...)', monRows.length >= 3 && monRows.every((r) => String(r.d) === String(r.last)), JSON.stringify(monRows.slice(0, 3)));

  console.log(' [9e] one-time chore: marking it done');
  const one = await mk({ choreName: 'Water the plants', repeats: 'none', date: tomorrow, dueTime: '18:00', assignment: { mode: 'person', userId: uB } });
  const oneId = one.body.choreId as number; const oneAid = Number((await asg(oneId))[0].assignment_id);
  check('created with exactly one occurrence, assigned to B; B was told', one.status === 201 && (await asg(oneId)).length === 1 && (await notes3(`user_id=$1 AND source_id=$2`, [uB, oneAid])) === 1);
  await expectStatus('A (not the assignee) cannot mark it done (403)', api(p3(`/assignments/${oneAid}/complete`), { method: 'POST', token: A.token }), 403);
  await expectStatus('C cannot either (403)', api(p3(`/assignments/${oneAid}/complete`), { method: 'POST', token: C.token }), 403);
  check('...still not done', (await asg(oneId))[0].is_completed === false);
  await expectStatus('B marks it done (200)', api(p3(`/assignments/${oneAid}/complete`), { method: 'POST', token: B.token }), 200);
  const done = (await asg(oneId))[0];
  check('is_completed and completed_at are set together, with the date it was done', done.is_completed === true && done.completed_at != null);
  check('the creator (A) is told; B is not told about their own action', (await notes3(`user_id=$1 AND source_id=$2 AND message LIKE '%finished%'`, [uA, oneAid])) === 1 && (await notes3(`user_id=$1 AND message LIKE '%finished%'`, [uB])) === 0);
  await expectStatus('marking it done twice (400)', api(p3(`/assignments/${oneAid}/complete`), { method: 'POST', token: B.token }), 400);
  await expectStatus('A cannot undo it (403)', api(p3(`/assignments/${oneAid}/uncomplete`), { method: 'POST', token: A.token }), 403);
  await expectStatus('B undoes it (200)', api(p3(`/assignments/${oneAid}/uncomplete`), { method: 'POST', token: B.token }), 200);
  check('...and completed_at is cleared with it', (await asg(oneId))[0].is_completed === false && (await asg(oneId))[0].completed_at === null);
  await expectStatus('undoing something not done (400)', api(p3(`/assignments/${oneAid}/uncomplete`), { method: 'POST', token: B.token }), 400);
  const listed = await list3(C.token);
  const listedOne = listed.chores.find((c) => c.choreId === oneId);
  check('the chart shows what C needs: schedule text, rotation, canEdit=false for C, canEdit=true for A', listedOne.schedule.startsWith('One time at 6:00 PM') && listedOne.canEdit === false && (await list3(A.token)).chores.find((c) => c.choreId === oneId).canEdit === true);
  check('assignments carry a status: upcoming here, overdue/done derived from the data', listed.assignments.find((a) => a.assignmentId === oneAid).status === 'upcoming');

  console.log(' [9f] reminders never spam (last_reminded_at)');
  const remChore = await mk({ choreName: 'Reminder target', repeats: 'none', date: tomorrow, dueTime: '18:00', assignment: { mode: 'person', userId: uB } });
  const rAid = Number((await asg(remChore.body.choreId))[0].assignment_id);
  await sql(`UPDATE chore_assignment SET due_at = now() + interval '5 hours' WHERE assignment_id=$1`, [rAid]); // due soon
  const rem = (q = '') => count(`SELECT count(*) n FROM notification WHERE source_type='chore_assignment' AND source_id=$1 AND section='system' ${q}`, [rAid]);
  const run1 = await sendDueReminders();
  check('the job reminds B once for the chore that is due within 24 hours', run1.reminded >= 1 && (await rem()) === 1 && (await asg(remChore.body.choreId))[0].last_reminded_at != null, JSON.stringify(run1));
  const run2 = await sendDueReminders();
  check('running it again right away sends NOTHING for that chore', (await rem()) === 1, JSON.stringify(run2));
  await sql(`UPDATE chore_assignment SET last_reminded_at = now() - interval '21 hours' WHERE assignment_id=$1`, [rAid]);
  await sendDueReminders();
  check('about a day later it is allowed to remind once more', (await rem()) === 2);
  await sql(`UPDATE chore_assignment SET last_reminded_at = NULL, is_completed = true, completed_at = now() WHERE assignment_id=$1`, [rAid]);
  await sendDueReminders();
  check('a chore that is already done is never reminded', (await rem()) === 2);
  await sql(`UPDATE chore_assignment SET is_completed = false, completed_at = NULL, last_reminded_at = now() - interval '2 hours' WHERE assignment_id=$1`, [rAid]);
  await expectStatus('A nudges B manually, but B was reminded 2 hours ago (429)', api(p3(`/assignments/${rAid}/remind`), { method: 'POST', token: A.token }), 429);
  await sql(`UPDATE chore_assignment SET last_reminded_at = NULL WHERE assignment_id=$1`, [rAid]);
  await expectStatus('with no recent reminder, A can nudge B (200)', api(p3(`/assignments/${rAid}/remind`), { method: 'POST', token: A.token }), 200);
  check('B got a chores-section notification from A', (await notes3(`user_id=$1 AND actor_user_id=$2 AND source_id=$3 AND message LIKE '%reminded you%'`, [uB, uA, rAid])) === 1);
  await expectStatus('and nudging again straight away is throttled (429)', api(p3(`/assignments/${rAid}/remind`), { method: 'POST', token: C.token }), 429);
  await expectStatus('B cannot remind themselves (400)', api(p3(`/assignments/${rAid}/remind`), { method: 'POST', token: B.token }), 400);

  console.log(' [9g] swapping and skipping');
  const X = await mk({ choreName: 'Dishes', repeats: 'none', date: inDays(3), dueTime: '18:00', assignment: { mode: 'person', userId: uA } });
  const Y = await mk({ choreName: 'Vacuum', repeats: 'none', date: inDays(4), dueTime: '19:00', assignment: { mode: 'person', userId: uB } });
  const Z = await mk({ choreName: 'Bathroom', repeats: 'none', date: inDays(5), dueTime: '10:00', assignment: { mode: 'person', userId: uA } });
  const a1 = Number((await asg(X.body.choreId))[0].assignment_id), b1 = Number((await asg(Y.body.choreId))[0].assignment_id), a2 = Number((await asg(Z.body.choreId))[0].assignment_id);
  const swapBody = { type: 'swap', requesterAssignmentId: a1, targetAssignmentId: b1, message: 'Studying for an exam' };
  const sw = async (token: string, b: unknown) => api(p3('/swap-requests'), { method: 'POST', token, body: b });
  for (const [name, token, body, st] of [
    ['no reason', A.token, { ...swapBody, message: '' }, 400], ['B asking about A\'s chore', B.token, swapBody, 403], ['swapping with your own other chore', A.token, { ...swapBody, targetAssignmentId: a2 }, 400],
    ['swapping with yourself', A.token, { ...swapBody, targetAssignmentId: a1 }, 400], ['swap without a target', A.token, { ...swapBody, targetAssignmentId: undefined }, 400],
    ['skip that names a target', A.token, { type: 'skip', requesterAssignmentId: a1, targetAssignmentId: b1, message: 'x' }, 400], ['unknown type', A.token, { ...swapBody, type: 'trade' }, 400],
    ['a chore that does not exist', A.token, { ...swapBody, requesterAssignmentId: 999999999 }, 404], ['reason over 300 characters', A.token, { ...swapBody, message: 'x'.repeat(301) }, 400],
  ] as const) await expectStatus(`${name} -> ${st}`, sw(token, body), st);
  check('none of that created a request', (await count('SELECT count(*) n FROM chore_swap_request s JOIN chore_assignment a ON a.assignment_id=s.requester_assignment_id JOIN chore c USING (chore_id) WHERE c.household_id=$1', [h3])) === 0);
  const s1b = await read(await sw(A.token, swapBody)); const s1 = s1b.swapId as number;
  check('A asks B to swap Dishes for Vacuum (201, pending)', s1b.status === 'pending');
  check('only B is notified (chores section, pointing at the request)', (await notes3(`source_type='chore_swap_request' AND source_id=$1`, [s1])) === 1 && (await notes3(`source_type='chore_swap_request' AND source_id=$1 AND user_id=$2 AND section='chores'`, [s1, uB])) === 1);
  await expectStatus('a second open request on the same chore is refused (409)', sw(A.token, swapBody), 409);
  const W = await mk({ choreName: 'Sweep', repeats: 'none', date: inDays(4), dueTime: '08:00', assignment: { mode: 'person', userId: uC } });
  const wAid = Number((await asg(W.body.choreId))[0].assignment_id);
  await expectStatus('C cannot pull B\'s chore into a second request while one is open on it (409)', sw(C.token, { type: 'swap', requesterAssignmentId: wAid, targetAssignmentId: b1, message: 'x' }), 409);
  await expectStatus('B asking A to cover Vacuum is also blocked: it is already in an open request (409)', sw(B.token, { type: 'skip', requesterAssignmentId: b1, message: 'x' }), 409);
  check('the open request shows in the list for everyone', (await list3(C.token)).swapRequests.some((r) => r.swapId === s1 && r.requesterUserId === uA && r.targetUserId === uB));
  const respond = (token: string, swapId: number, b: unknown) => api(p3(`/swap-requests/${swapId}`), { method: 'PATCH', token, body: b });
  await expectStatus('C (not involved) cannot answer (403)', respond(C.token, s1, { action: 'accept' }), 403);
  await expectStatus('A cannot accept their own request (403)', respond(A.token, s1, { action: 'accept' }), 403);
  await expectStatus('nonsense action (400)', respond(B.token, s1, { action: 'maybe' }), 400);
  await expectStatus('B declines with a reply (200)', respond(B.token, s1, { action: 'decline', message: 'I have plans Thursday' }), 200);
  const d1 = (await sql('SELECT status, response_message, responded_date FROM chore_swap_request WHERE swap_id=$1', [s1]))[0];
  check('declined: status, reply and responded_date recorded; nothing moved', d1.status === 'declined' && d1.response_message === 'I have plans Thursday' && d1.responded_date != null && Number((await sql('SELECT assigned_user_id u FROM chore_assignment WHERE assignment_id=$1', [a1]))[0].u) === uA);
  check('A is told, including the reply', (await notes3(`user_id=$1 AND source_id=$2 AND message LIKE '%declined%' AND message LIKE '%plans Thursday%'`, [uA, s1])) === 1);
  await expectStatus('answering again (409: already handled)', respond(B.token, s1, { action: 'accept' }), 409);
  check('a decided request leaves the open list', !(await list3(A.token)).swapRequests.some((r) => r.swapId === s1));
  const s2 = (await read(await sw(A.token, swapBody))).swapId as number;
  await expectStatus('B accepts (200)', respond(B.token, s2, { action: 'accept', message: 'Sure' }), 200);
  check('BOTH chores changed hands in one step: Dishes -> B, Vacuum -> A', Number((await sql('SELECT assigned_user_id u FROM chore_assignment WHERE assignment_id=$1', [a1]))[0].u) === uB && Number((await sql('SELECT assigned_user_id u FROM chore_assignment WHERE assignment_id=$1', [b1]))[0].u) === uA);
  const acc = (await sql('SELECT status, responded_date FROM chore_swap_request WHERE swap_id=$1', [s2]))[0];
  check('accepted with a responded_date, and A was notified', acc.status === 'accepted' && acc.responded_date != null && (await notes3(`user_id=$1 AND source_id=$2 AND message LIKE '%accepted%'`, [uA, s2])) === 1);
  const s3 = (await read(await sw(A.token, { type: 'swap', requesterAssignmentId: b1, targetAssignmentId: a1, message: 'Swap back?' }))).swapId as number;
  await expectStatus('B completes Dishes while a request about it is open (200)', api(p3(`/assignments/${a1}/complete`), { method: 'POST', token: B.token }), 200);
  check('that open request was closed automatically (declined, "done before anyone answered")', (await sql('SELECT status, response_message FROM chore_swap_request WHERE swap_id=$1', [s3]))[0].status === 'declined');
  await expectStatus('and it can no longer be accepted (409)', respond(B.token, s3, { action: 'accept' }), 409);
  const s4 = (await read(await sw(A.token, { type: 'skip', requesterAssignmentId: a2, message: 'Out of town' }))).swapId as number;
  check('skip: BOTH other roommates are asked', (await notes3(`source_type='chore_swap_request' AND source_id=$1 AND user_id IN ($2,$3)`, [s4, uB, uC])) === 2 && (await notes3(`source_type='chore_swap_request' AND source_id=$1 AND user_id=$2`, [s4, uA])) === 0);
  await expectStatus('A cannot cover their own skip (403)', respond(A.token, s4, { action: 'accept' }), 403);
  await expectStatus('B says "not me" (200): the request stays open', respond(B.token, s4, { action: 'decline' }), 200);
  check('...still pending, and only B\'s own notification was marked read', (await sql('SELECT status FROM chore_swap_request WHERE swap_id=$1', [s4]))[0].status === 'pending' && (await notes3(`source_id=$1 AND user_id=$2 AND is_read`, [s4, uB])) === 1 && (await notes3(`source_id=$1 AND user_id=$2 AND NOT is_read`, [s4, uC])) === 1);
  await expectStatus('C accepts (200): the first to say yes covers it', respond(C.token, s4, { action: 'accept' }), 200);
  check('the chore is now C\'s and A was told', Number((await sql('SELECT assigned_user_id u FROM chore_assignment WHERE assignment_id=$1', [a2]))[0].u) === uC && (await notes3(`user_id=$1 AND source_id=$2 AND message LIKE '%cover%'`, [uA, s4])) === 1);
  await expectStatus('B accepting after C already did (409)', respond(B.token, s4, { action: 'accept' }), 409);
  const Q = await mk({ choreName: 'Mop', repeats: 'none', date: inDays(6), dueTime: '12:00', assignment: { mode: 'person', userId: uA } });
  const qAid = Number((await asg(Q.body.choreId))[0].assignment_id);
  const s5 = (await read(await sw(A.token, { type: 'skip', requesterAssignmentId: qAid, message: 'Race!' }))).swapId as number;
  await expectStatus('B cannot withdraw A\'s request (403)', respond(B.token, s5, { action: 'withdraw' }), 403);
  const race = await Promise.all([respond(B.token, s5, { action: 'accept' }), respond(C.token, s5, { action: 'accept' })]);
  const codes = race.map((r) => r.status).sort();
  check('B and C accept at the SAME moment: exactly one wins (200) and one is told it is taken (409)', codes.join() === '200,409', codes.join());
  const winner = Number((await sql('SELECT assigned_user_id u FROM chore_assignment WHERE assignment_id=$1', [qAid]))[0].u);
  check('...and the chore belongs to exactly one of them', [uB, uC].includes(winner));
  const Q2 = await mk({ choreName: 'Windows', repeats: 'none', date: inDays(7), dueTime: '12:00', assignment: { mode: 'person', userId: uA } });
  const q2 = Number((await asg(Q2.body.choreId))[0].assignment_id);
  const s6 = (await read(await sw(A.token, { type: 'skip', requesterAssignmentId: q2, message: 'Changed my mind soon' }))).swapId as number;
  await expectStatus('A withdraws their own request (200)', respond(A.token, s6, { action: 'withdraw' }), 200);
  check('...it is closed and the chore is still A\'s', (await sql('SELECT status, response_message FROM chore_swap_request WHERE swap_id=$1', [s6]))[0].status === 'declined' && Number((await sql('SELECT assigned_user_id u FROM chore_assignment WHERE assignment_id=$1', [q2]))[0].u) === uA);

  console.log(' [9h] only the creator edits or deletes');
  await expectStatus('B cannot rename A\'s chore (403)', patch3(`/chores/${oneId}`, B.token, { choreName: 'Hacked' }), 403);
  await expectStatus('B cannot delete it (403)', del3(`/chores/${oneId}`, B.token), 403);
  check('...unchanged', (await sql('SELECT chore_name n FROM chore WHERE chore_id=$1', [oneId]))[0].n === 'Water the plants');
  await expectStatus('A renames it (200)', patch3(`/chores/${oneId}`, A.token, { choreName: 'Water the plants (all)', effort: 'hard' }), 200);
  await expectStatus('a 700-character description is refused (400)', patch3(`/chores/${oneId}`, A.token, { description: 'x'.repeat(700) }), 400);
  const sCount = await notes3(`source_type IN ('chore_assignment','chore_swap_request')`);
  await expectStatus('A deletes the Dishes chore (200)', del3(`/chores/${X.body.choreId}`, A.token), 200);
  check('its occurrences, requests and notifications went with it', (await count('SELECT count(*) n FROM chore_assignment WHERE chore_id=$1', [X.body.choreId])) === 0 && (await count('SELECT count(*) n FROM chore_swap_request WHERE swap_id=ANY($1)', [[s1, s2, s3]])) === 0 && (await notes3(`source_type='chore_swap_request' AND source_id IN ($1,$2,$3)`, [s1, s2, s3])) === 0 && (await notes3(`source_type IN ('chore_assignment','chore_swap_request')`)) < sCount);

  console.log(' [9i] the daily job, and its secret');
  const cron = (headers: Record<string, string>) => api('/api/cron/chores', { headers });
  const secret = process.env.CRON_SECRET!;
  await expectStatus('no secret -> 401', cron({}), 401);
  await expectStatus('wrong secret -> 401', cron({ authorization: 'Bearer nope' }), 401);
  await expectStatus('right secret but wrong scheme -> 401', cron({ authorization: secret }), 401);
  const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
  await expectStatus('with NO secret configured the endpoint is disabled, not open (503)', cron({ authorization: 'Bearer ' }), 503);
  process.env.CRON_SECRET = saved;
  const ok = await cron({ authorization: `Bearer ${secret}` });
  const okBody = await read(ok);
  check('the right secret runs the job (200) and reports counts', ok.status === 200 && typeof okBody.created === 'number' && typeof okBody.reminded === 'number', JSON.stringify(okBody));
  const cronAgain = await read(await cron({ authorization: `Bearer ${secret}` }));
  check('running it twice in a row creates and reminds nothing new (idempotent)', cronAgain.created === 0 && cronAgain.reminded === 0, JSON.stringify(cronAgain));

  console.log(' [9j] roommates who moved out');
  await sql('UPDATE household_member SET left_date = now() WHERE household_id=$1 AND user_id=$2', [h3, uC]);
  for (const [name, b] of [['a new chore assigned to them', { ...goodOne, assignment: { mode: 'person', userId: uC } }], ['a new rotation that includes them', { ...goodOne, repeats: 'weekly', dayOfWeek: 2, date: undefined, assignment: { mode: 'rotate', userIds: [uA, uC] } }]] as const) {
    const r = await mk(b as Record<string, unknown>); check(`${name} -> 400`, r.status === 400, `(${r.status})`);
  }
  const lastBefore = (await asg(rotId)).length;
  await generateAll({ householdId: h3, asOf: { today: addD(today, 230), nowIso } }); // beyond everything generated so far
  const afterLeft = (await asg(rotId)).slice(lastBefore);
  check('the generator keeps going but NEVER hands a new occurrence to someone who moved out', afterLeft.length >= 2 && afterLeft.every((r) => Number(r.assigned_user_id) !== uC), afterLeft.map((r) => r.assigned_user_id).join());
  check('the rotation just skips them: A and B alternate', afterLeft.every((r) => [uA, uB].includes(Number(r.assigned_user_id))));
  const skipOpen = (await read(await sw(A.token, { type: 'skip', requesterAssignmentId: qAid === a2 ? a2 : (await asg(Q2.body.choreId))[0].assignment_id, message: 'Cover please' })));
  check('a new skip request is only sent to people who still live here (B), never to C', skipOpen.swapId != null && (await notes3(`source_type='chore_swap_request' AND source_id=$1 AND user_id=$2`, [skipOpen.swapId, uC])) === 0 && (await notes3(`source_type='chore_swap_request' AND source_id=$1 AND user_id=$2`, [skipOpen.swapId, uB])) === 1);
  const cNotes = await notes3('user_id=$1', [uC]);
  await sql(`UPDATE chore_assignment SET due_at = now() + interval '3 hours', last_reminded_at = NULL, is_completed=false, completed_at=NULL WHERE assignment_id=$1`, [a2]); // a2 belongs to C, who moved out
  await sendDueReminders();
  check('no reminder goes to someone who moved out', (await notes3('user_id=$1', [uC])) === cNotes);
  await expectStatus('C (moved out) can no longer use the chore routes (404)', api(p3('/chores'), { token: C.token }), 404);

  console.log(' [9k] database invariants after all of the above');
  check('no occurrence is assigned to someone who was never a member of the household', (await sql(`SELECT 1 FROM chore_assignment a JOIN chore c USING (chore_id) WHERE c.household_id=$1 AND NOT EXISTS (SELECT 1 FROM household_member m WHERE m.household_id=c.household_id AND m.user_id=a.assigned_user_id)`, [h3])).length === 0);
  check('is_completed always matches completed_at', (await sql(`SELECT 1 FROM chore_assignment a JOIN chore c USING (chore_id) WHERE c.household_id=$1 AND a.is_completed <> (a.completed_at IS NOT NULL)`, [h3])).length === 0);
  check('every swap request is either pending with no response date, or decided with one', (await sql(`SELECT 1 FROM chore_swap_request r JOIN chore_assignment a ON a.assignment_id=r.requester_assignment_id JOIN chore c USING (chore_id) WHERE c.household_id=$1 AND ((r.status='pending') <> (r.responded_date IS NULL))`, [h3])).length === 0);
  check('no two open requests ever touch the same occurrence', (await sql(`WITH o AS (SELECT requester_assignment_id a FROM chore_swap_request WHERE status='pending' UNION ALL SELECT target_assignment_id FROM chore_swap_request WHERE status='pending' AND target_assignment_id IS NOT NULL) SELECT a FROM o GROUP BY a HAVING count(*) > 1`)).length === 0);
  console.log('\n[10] calendar and board: events, tags, the hosting check, notes');
  const H4 = await read(await api('/api/households', { method: 'POST', token: A.token, body: { householdName: 'Calendar House', timezone: 'America/Denver' } }));
  const h4 = H4.householdId as number;
  for (const t of [B.token, D.token]) await api('/api/households/join', { method: 'POST', token: t, body: { joinCode: H4.joinCode } });
  const p4 = (path: string) => `/api/households/${h4}${path}`;
  const send4 = (method: string, path: string, token: string, body?: unknown) => api(p4(path), { method, token, body });
  const notes4 = (q: string, params: unknown[] = []) => count(`SELECT count(*) n FROM notification WHERE household_id=${h4} AND ${q}`, params);
  const goodEv = { eventName: 'Game night', date: addD(today, 3), time: '19:00', endTime: '23:00', category: 'hosting', color: '#7c3aed', reminderMinutesBefore: 60, taggedUserIds: [uB] };

  console.log(' [10a] outsiders and bad input');
  for (const [m, path] of [['GET', '/events'], ['POST', '/events'], ['GET', '/board'], ['POST', '/board']] as const)
    await expectStatus(`outsider C: ${m} ${path} -> 404`, send4(m, path, C.token, m === 'POST' ? (path === '/events' ? goodEv : { messageText: 'hi' }) : undefined), 404);
  const evCount = () => count('SELECT count(*) n FROM event WHERE household_id=$1', [h4]);
  const before10 = { e: await evCount(), n: await notes4('true') };
  for (const [name, b] of [
    ['no name', { ...goodEv, eventName: ' ' }], ['bad date', { ...goodEv, date: '2026-02-31' }], ['bad time', { ...goodEv, time: '7pm' }], ['bad category', { ...goodEv, category: 'party' }],
    ['bad color', { ...goodEv, color: 'purple' }], ['negative reminder', { ...goodEv, reminderMinutesBefore: -5 }], ['ends before it starts', { ...goodEv, endTime: '18:00' }],
    ['tagging an outsider', { ...goodEv, taggedUserIds: [uC] }], ['tag list that is not a list', { ...goodEv, taggedUserIds: 'everyone' }], ['name too long', { ...goodEv, eventName: 'x'.repeat(121) }],
  ] as [string, Record<string, unknown>][]) await expectStatus(`${name} -> 400`, send4('POST', '/events', A.token, b), 400);
  check('none of those created an event or a notification', (await evCount()) === before10.e && (await notes4('true')) === before10.n);

  console.log(' [10b] creating an event, tags and the hosting check');
  const ev = await read(await expectStatus('A creates a hosting event, tagging B (body also claims C made it)', send4('POST', '/events', A.token, { ...goodEv, createdByUserId: uC, created_by_user_id: uC }), 201));
  const evId = ev.eventId as number;
  check('the creator is the token user, not the id in the body', Number((await sql('SELECT created_by_user_id FROM event WHERE event_id=$1', [evId]))[0].created_by_user_id) === uA);
  check('start and end are in the household timezone (7 PM and 11 PM Denver)', (await sql(`SELECT to_char(event_date AT TIME ZONE 'America/Denver','HH24:MI') s, to_char(end_date AT TIME ZONE 'America/Denver','HH24:MI') e FROM event WHERE event_id=$1`, [evId]))[0].s === '19:00');
  const tagB = (await sql('SELECT response FROM event_tag WHERE event_id=$1 AND user_id=$2', [evId, uB]))[0];
  check('B is tagged and the hosting check is pending', tagB?.response === 'pending' && ev.tags.length === 1);
  check('B was asked (calendar_board section, points at the event); A was not notified', (await notes4(`user_id=$1 AND section='calendar_board' AND source_type='event' AND source_id=$2 AND message LIKE '%Is that okay%'`, [uB, evId])) === 1 && (await notes4('user_id=$1', [uA])) === 0);
  const plain = await read(await expectStatus('A creates a non-hosting event tagging B', send4('POST', '/events', A.token, { eventName: 'Landlord visit', date: addD(today, 5), time: '10:00', category: 'other', taggedUserIds: [uB, uA] }), 201));
  check('a non-hosting tag asks no question (response stays empty) and the creator never tags themselves', (await sql('SELECT response, user_id FROM event_tag WHERE event_id=$1', [plain.eventId])).length === 1 && (await sql('SELECT response FROM event_tag WHERE event_id=$1', [plain.eventId]))[0].response === null);
  const evList = await read(await expectStatus('B lists events', send4('GET', '/events', B.token), 200));
  const asB = evList.events.find((e: any) => e.eventId === evId), asA = (await read(await send4('GET', '/events', A.token))).events.find((e: any) => e.eventId === evId); // eslint-disable-line @typescript-eslint/no-explicit-any
  check('canEdit is true only for the creator', asA.canEdit === true && asB.canEdit === false);

  console.log(' [10c] only the creator edits; only the person asked answers');
  await expectStatus('B cannot edit A\'s event (403)', send4('PATCH', `/events/${evId}`, B.token, { ...goodEv, eventName: 'Hijacked' }), 403);
  await expectStatus('B cannot delete A\'s event (403)', send4('DELETE', `/events/${evId}`, B.token), 403);
  await expectStatus('outsider C cannot touch it (404)', send4('PATCH', `/events/${evId}`, C.token, goodEv), 404);
  await expectStatus('the same event through another household\'s path is 404', api(`/api/households/${hid}/events/${evId}/respond`, { method: 'POST', token: A.token, body: { response: 'accepted' } }), 404);
  check('nothing changed', (await sql('SELECT event_name FROM event WHERE event_id=$1', [evId]))[0].event_name === 'Game night');
  await expectStatus('A (the creator, not asked) cannot answer (400)', send4('POST', `/events/${evId}/respond`, A.token, { response: 'accepted' }), 400);
  await expectStatus('D (not tagged) cannot answer (400)', send4('POST', `/events/${evId}/respond`, D.token, { response: 'accepted' }), 400);
  await expectStatus('B answering "maybe" -> 400', send4('POST', `/events/${evId}/respond`, B.token, { response: 'maybe' }), 400);
  await expectStatus('B cannot answer a non-hosting tag (400)', send4('POST', `/events/${plain.eventId}/respond`, B.token, { response: 'accepted' }), 400);
  await expectStatus('B accepts (body tries to answer as D)', send4('POST', `/events/${evId}/respond`, B.token, { response: 'accepted', userId: uD, user_id: uD }), 200);
  check('B\'s tag says accepted with a date; nobody else got a tag out of it', (await sql('SELECT user_id, response, responded_date FROM event_tag WHERE event_id=$1', [evId])).every((r) => Number(r.user_id) === uB && r.response === 'accepted' && r.responded_date));
  check('A was told B is fine with it', (await notes4(`user_id=$1 AND source_type='event' AND source_id=$2 AND message LIKE '%fine with%'`, [uA, evId])) === 1);
  await expectStatus('A edits the event and adds D', send4('PATCH', `/events/${evId}`, A.token, { ...goodEv, eventName: 'Game night (updated)', taggedUserIds: [uB, uD] }), 200);
  check('only D is newly asked; B keeps the answer already given', (await notes4(`user_id=$1 AND source_id=$2 AND message LIKE '%Is that okay%'`, [uD, evId])) === 1 && (await notes4(`user_id=$1 AND source_id=$2 AND message LIKE '%Is that okay%'`, [uB, evId])) === 1 && (await sql(`SELECT response FROM event_tag WHERE event_id=$1 AND user_id=$2`, [evId, uB]))[0].response === 'accepted');
  await expectStatus('A edits and removes B from the tags', send4('PATCH', `/events/${evId}`, A.token, { ...goodEv, taggedUserIds: [uD] }), 200);
  check('B is no longer tagged', (await sql('SELECT 1 FROM event_tag WHERE event_id=$1 AND user_id=$2', [evId, uB])).length === 0);

  console.log(' [10d] the board');
  const note = await read(await expectStatus('A posts a note linked to the event', send4('POST', '/board', A.token, { messageText: 'Anyone mind game night?', eventId: evId, senderUserId: uC }), 201));
  check('the sender is the token user, not the id in the body', Number((await sql('SELECT sender_user_id FROM bulletin_message WHERE message_id=$1', [note.messageId]))[0].sender_user_id) === uA && note.eventId === evId);
  for (const [name, b] of [['empty note', { messageText: '  ' }], ['501 characters', { messageText: 'x'.repeat(501) }], ['an event that does not exist', { messageText: 'hi', eventId: 999999999 }], ['an event from another household', { messageText: 'hi', eventId: (await sql('SELECT event_id FROM event WHERE household_id=$1 LIMIT 1', [hid]))[0]?.event_id ?? 1 }], ['a parent that does not exist', { messageText: 'hi', parentMessageId: 999999999 }]] as [string, Record<string, unknown>][]) {
    const r = await send4('POST', '/board', B.token, b); check(`${name} -> 400 or 404`, r.status === 400 || r.status === 404, `(${r.status})`);
  }
  const reply = await read(await expectStatus('B replies to A\'s note', send4('POST', '/board', B.token, { messageText: 'Fine by me!', parentMessageId: note.messageId }), 201));
  check('A was told about the reply (and B was not told about their own)', (await notes4(`user_id=$1 AND source_type='bulletin_message' AND source_id=$2`, [uA, reply.messageId])) === 1 && (await notes4('user_id=$1 AND source_type=\'bulletin_message\'', [uB])) === 0);
  await expectStatus('a reply to a reply -> 400', send4('POST', '/board', A.token, { messageText: 'nested', parentMessageId: reply.messageId }), 400);
  await expectStatus('a reply cannot be linked to an event (400)', send4('POST', '/board', A.token, { messageText: 'x', parentMessageId: note.messageId, eventId: evId }), 400);
  const board = await read(await expectStatus('B reads the board', send4('GET', '/board', B.token), 200));
  const shown = board.notes.find((n: any) => n.messageId === note.messageId); // eslint-disable-line @typescript-eslint/no-explicit-any
  check('replies nest under their note; canEdit is per viewer', shown.replies.length === 1 && shown.canEdit === false && shown.replies[0].canEdit === true);
  await expectStatus('B cannot edit A\'s note (403)', send4('PATCH', `/board/${note.messageId}`, B.token, { messageText: 'changed' }), 403);
  await expectStatus('B cannot pin A\'s note (403)', send4('PATCH', `/board/${note.messageId}`, B.token, { isPinned: true }), 403);
  await expectStatus('B cannot delete A\'s note (403)', send4('DELETE', `/board/${note.messageId}`, B.token), 403);
  await expectStatus('outsider C cannot read or change notes (404)', send4('PATCH', `/board/${note.messageId}`, C.token, { isPinned: true }), 404);
  await expectStatus('a note through another household\'s path is 404', api(`/api/households/${hid}/board/${note.messageId}`, { method: 'PATCH', token: A.token, body: { isPinned: true } }), 404);
  await expectStatus('A pins their note', send4('PATCH', `/board/${note.messageId}`, A.token, { isPinned: true }), 200);
  await expectStatus('a reply cannot be pinned (400)', send4('PATCH', `/board/${reply.messageId}`, B.token, { isPinned: true }), 400);
  await expectStatus('isPinned must be a boolean (400)', send4('PATCH', `/board/${note.messageId}`, A.token, { isPinned: 'yes' }), 400);
  check('the pinned note comes first', (await read(await send4('GET', '/board', A.token))).notes[0].messageId === note.messageId);
  await expectStatus('A deletes the note', send4('DELETE', `/board/${note.messageId}`, A.token), 200);
  check('its reply and the notification about it went with it', (await sql('SELECT 1 FROM bulletin_message WHERE message_id IN ($1,$2)', [note.messageId, reply.messageId])).length === 0 && (await notes4(`source_type='bulletin_message'`)) === 0);

  console.log(' [10e] deleting an event, and roommates who moved out');
  await expectStatus('A deletes the event', send4('DELETE', `/events/${evId}`, A.token), 200);
  check('its tags and notifications are gone', (await sql('SELECT 1 FROM event_tag WHERE event_id=$1', [evId])).length === 0 && (await notes4(`source_type='event' AND source_id=$1`, [evId])) === 0);
  await sql('UPDATE household_member SET left_date = now() WHERE household_id=$1 AND user_id=$2', [h4, uD]);
  await expectStatus('D (moved out) can no longer read events (404)', send4('GET', '/events', D.token), 404);
  await expectStatus('D (moved out) can no longer read or post on the board (404)', send4('POST', '/board', D.token, { messageText: 'hello?' }), 404);
  await expectStatus('a new event cannot tag someone who moved out (400)', send4('POST', '/events', A.token, { ...goodEv, taggedUserIds: [uD] }), 400);
  check('every tag belongs to a roommate who was a member', (await sql(`SELECT 1 FROM event_tag t JOIN event e USING (event_id) WHERE e.household_id=$1 AND NOT EXISTS (SELECT 1 FROM household_member m WHERE m.household_id=e.household_id AND m.user_id=t.user_id)`, [h4])).length === 0);

  console.log('\n[11] notification dashboard: own rows only, red alert, read-all, moved-out households');
  const H5 = await read(await api('/api/households', { method: 'POST', token: A.token, body: { householdName: 'Notify House', timezone: 'America/Denver' } }));
  const h5 = H5.householdId as number;
  for (const t of [B.token, D.token]) await api('/api/households/join', { method: 'POST', token: t, body: { joinCode: H5.joinCode } });
  const p5 = (path: string) => `/api/households/${h5}${path}`;
  const inbox = async (token: string) => read(await api('/api/notifications', { token })) as Promise<{ notifications: any[]; unread: number; swapPending: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const mkChore = async (token: string, userId: number, name: string, days: number) => (await read(await api(p5('/chores'), { method: 'POST', token, body: { choreName: name, repeats: 'none', date: addD(today, days), dueTime: '18:00', assignment: { mode: 'person', userId } } }))).choreId as number;
  const aChore = await mkChore(A.token, uA, 'A chore', 2), bChore = await mkChore(A.token, uB, 'B chore', 3);
  const aAsg = Number((await sql('SELECT assignment_id FROM chore_assignment WHERE chore_id=$1', [aChore]))[0].assignment_id), bAsg = Number((await sql('SELECT assignment_id FROM chore_assignment WHERE chore_id=$1', [bChore]))[0].assignment_id);

  console.log(' [11a] what the list contains');
  const inbB0 = await inbox(B.token);
  check('B sees the chore A gave them, with a source that still exists', inbB0.notifications.some((n) => n.householdId === h5 && n.sourceType === 'chore_assignment' && n.sourceId === bAsg && n.sourceGone === false && n.isRead === false));
  check('every row belongs to the caller (checked against the database)', (await sql(`SELECT 1 FROM notification WHERE notification_id = ANY($1::bigint[]) AND user_id <> $2`, [inbB0.notifications.map((n) => n.notificationId), uB])).length === 0);
  check('unread count matches the unread rows', inbB0.unread === inbB0.notifications.filter((n) => !n.isRead).length);
  const swapMade = await read(await expectStatus('A asks B to swap (A\'s chore for B\'s)', api(p5('/swap-requests'), { method: 'POST', token: A.token, body: { type: 'swap', requesterAssignmentId: aAsg, targetAssignmentId: bAsg, message: 'Can we trade?' } }), 201));
  const inbB1 = await inbox(B.token), swapNote = inbB1.notifications.find((n) => n.sourceType === 'chore_swap_request' && n.sourceId === swapMade.swapId);
  check('B has the swap request: pending, can respond, and it raises the red alert', swapNote?.sourceStatus === 'pending' && swapNote.canRespond === true && swapNote.swapPending === true && inbB1.swapPending >= 1);
  check('A (the one who asked) gets no red alert from their own request', (await inbox(A.token)).notifications.every((n) => !(n.sourceType === 'chore_swap_request' && n.swapPending)));
  check('D (not involved) sees nothing about it', (await inbox(D.token)).notifications.every((n) => !(n.sourceType === 'chore_swap_request' && n.sourceId === swapMade.swapId)));

  console.log(' [11b] marking read: only your own');
  await expectStatus('B marks the swap notification read', api(`/api/notifications/${swapNote.notificationId}`, { method: 'PATCH', token: B.token, body: { isRead: true } }), 200);
  check('reading it clears the red alert', (await inbox(B.token)).swapPending === inbB1.swapPending - 1);
  await expectStatus('B accepts the swap', api(p5(`/swap-requests/${swapMade.swapId}`), { method: 'PATCH', token: B.token, body: { action: 'accept' } }), 200);
  const swapAfter = (await inbox(B.token)).notifications.find((n) => n.notificationId === swapNote.notificationId);
  check('once decided, the card shows it as accepted and offers no more buttons', swapAfter.sourceStatus === 'accepted' && swapAfter.canRespond === false);
  const dBefore = await inbox(D.token);
  await expectStatus('unknown section -> 400', api('/api/notifications/read-all', { method: 'POST', token: B.token, body: { section: 'everything' } }), 400);
  const dUnreadDb = () => count(`SELECT count(*) n FROM notification WHERE user_id=$1 AND is_read=false`, [uD]);
  const dUnread0 = await dUnreadDb();
  const part = await read(await expectStatus('B marks only the chores section read (body also names D)', api('/api/notifications/read-all', { method: 'POST', token: B.token, body: { section: 'chores', userId: uD, user_id: uD } }), 200));
  check('only chores rows of B changed; D\'s rows were not touched', (await count(`SELECT count(*) n FROM notification WHERE user_id=$1 AND section='chores' AND is_read=false`, [uB])) === 0 && (await dUnreadDb()) === dUnread0 && part.marked >= 0);
  await read(await expectStatus('B marks everything read', api('/api/notifications/read-all', { method: 'POST', token: B.token, body: {} }), 200));
  check('B has nothing unread; D still has the same unread count', (await inbox(B.token)).unread === 0 && (await dUnreadDb()) === dUnread0 && (await inbox(D.token)).unread === dBefore.unread);
  await expectStatus('read-all with no token -> 401', api('/api/notifications/read-all', { method: 'POST', body: {} }), 401);

  console.log(' [11c] money and calendar cards offer the right buttons to the right person');
  const exp = await read(await api(p5('/expenses'), { method: 'POST', token: A.token, body: { itemName: 'Pizza', totalAmount: '30.00', participantUserIds: [uB, uD] } }));
  const payRes = await api(p5('/payments'), { method: 'POST', token: B.token, body: { payeeUserId: uA, expenseIds: [exp.expenseId], paidWith: 'venmo' } });
  const payNote = (await inbox(A.token)).notifications.find((n) => n.sourceType === 'payment');
  check('A (the payee) can confirm the payment from the card; B (the payer) is not offered it', payRes.status === 201 && payNote?.canRespond === true && (await inbox(B.token)).notifications.every((n) => !(n.sourceType === 'payment' && n.canRespond)));
  const ev5 = await read(await api(p5('/events'), { method: 'POST', token: A.token, body: { eventName: 'Movie night', date: addD(today, 4), time: '20:00', category: 'hosting', taggedUserIds: [uB] } }));
  const evNote = (await inbox(B.token)).notifications.find((n) => n.sourceType === 'event' && n.sourceId === ev5.eventId);
  check('B is asked about the event (card can answer); A, the host, is not offered buttons', evNote?.canRespond === true && evNote.sourceStatus === 'pending' && (await inbox(A.token)).notifications.every((n) => !(n.sourceType === 'event' && n.sourceId === ev5.eventId && n.canRespond)));
  await api(p5(`/events/${ev5.eventId}`), { method: 'DELETE', token: A.token });
  check('after A deletes the event its notification is gone', (await inbox(B.token)).notifications.every((n) => !(n.sourceType === 'event' && n.sourceId === ev5.eventId)));

  console.log(' [11d] a household you moved out of disappears from the list');
  check('before leaving: D has rows from this household', (await inbox(D.token)).notifications.some((n) => n.householdId === h5));
  await sql('UPDATE household_member SET left_date = now() WHERE household_id=$1 AND user_id=$2', [h5, uD]);
  const dAfter = await inbox(D.token);
  check('after leaving: none of that household\'s notifications are shown, and they do not count as unread', dAfter.notifications.every((n) => n.householdId !== h5) && dAfter.unread === dAfter.notifications.filter((n) => !n.isRead).length);
  check('the rows still exist (history is kept), just hidden', (await count('SELECT count(*) n FROM notification WHERE user_id=$1 AND household_id=$2', [uD, h5])) > 0);

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

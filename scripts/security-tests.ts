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

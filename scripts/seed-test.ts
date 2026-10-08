// Joins the live seed household (MAPLE412) as a throwaway 5th member using the LOCAL api code,
// checks what they see, then deletes the throwaway account.   npm run test:seed
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { handle } from './dev-server.js';
import { sweepTestData } from './lib/test-cleanup.js';
import { assertSeedAsFifthMember, type Call } from './lib/seed-assertions.js';

const ORIGIN = 'http://localhost:5173';
const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`); };
const raw = (path: string, init: { method?: string; token?: string; body?: unknown; cookie?: string } = {}) =>
  handle(new Request(ORIGIN + path, { method: init.method ?? 'GET', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));

let code = 0;
try {
  await sweepTestData(owner);
  console.log('seed household, as a new 5th member (local api code, live Neon)\n');
  const email = `roomie-test-seed-${randomBytes(3).toString('hex')}@example.com`;
  const up = await raw('/api/auth/sign-up/email', { method: 'POST', body: { email, password: randomBytes(12).toString('base64url') + 'Aa1!', name: 'Casey Fifth' } });
  const cookie = up.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const jwt = (await raw('/api/auth/get-session', { cookie })).headers.get('set-auth-jwt')!;
  const me = await (await raw('/api/me', { token: jwt })).json();
  const call: Call = async (path, init = {}) => { const r = await raw(path, { ...init, token: jwt }); const t = await r.text(); let json: unknown = t; try { json = JSON.parse(t); } catch { /* not json */ } return { status: r.status, json }; };
  await assertSeedAsFifthMember(call, check, me.user.userId);
} catch (e) { console.error('ERROR:', e); code = 1; }
finally {
  const swept = await sweepTestData(owner);
  const left = (await owner.query(`SELECT (SELECT count(*) FROM users WHERE email LIKE 'roomie-test-%')::int u, (SELECT count(*) FROM household_member m JOIN household h USING (household_id) WHERE h.join_code='MAPLE412')::int seedmembers`)).rows[0];
  const clean = left.u === 0 && left.seedmembers === 4;
  console.log(`\ncleanup: removed ${JSON.stringify(swept)}; leftover test users: ${left.u}; seed household members back to ${left.seedmembers} -> ${clean ? 'CLEAN' : 'NOT CLEAN'}`);
  if (!clean) code = 1;
  await owner.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(code || (failed ? 1 : 0));

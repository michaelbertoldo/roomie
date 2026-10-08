// Sign-in test against a DEPLOYED preview (the real domain), through the same-domain auth proxy.
//   npm run test:preview -- https://roomie-is401-preview.vercel.app
// Uses `vercel curl` once to get the protection-bypass header (never printed), then plain fetch.
// Creates throwaway roomie-test-preview-* accounts and deletes them at the end.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { sweepTestData } from './lib/test-cleanup.js';
import { assertSeedAsFifthMember } from './lib/seed-assertions.js';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
if (!BASE.startsWith('https://')) { console.error('usage: npm run test:preview -- https://<preview-url>'); process.exit(2); }
const ORIGIN = new URL(BASE).origin;
const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });

const bypass = (() => {
  const out = execSync(`vercel curl /api/me --deployment ${BASE} -- -s -v 2>&1 || true`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const m = /x-vercel-protection-bypass:\s*([A-Za-z0-9_-]+)/i.exec(out);
  if (!m) throw new Error('could not obtain the protection bypass header from `vercel curl`');
  return m[1]!;
})();

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`); };
const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  fetch(BASE + path, { method: init.method ?? 'GET', redirect: 'manual', headers: { 'x-vercel-protection-bypass': bypass, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const cookieHeader = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

async function main() {
  await sweepTestData(owner);
  console.log(`preview sign-in test against ${ORIGIN}\n`);

  console.log('[1] the site and the functions');
  const home = await call('/');
  const html = await home.text();
  check('GET / serves the Vite app', home.status === 200 && html.includes('id="root"') && html.includes('/assets/'), `(status ${home.status})`);
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  check('its JS bundle loads', !!asset && (await call(asset)).status === 200);
  const me401 = await call('/api/me');
  check('/api/me without a token -> 401 JSON from our function', me401.status === 401 && (await me401.json()).error === 'Sign in required');
  const notif = await call('/api/notifications');
  check('GET /api/notifications (bare path) is routed to our function -> 401 JSON', notif.status === 401 && (await notif.json()).error === 'Sign in required', `(status ${notif.status})`);
  const hh = await call('/api/households');
  check('GET /api/households (bare path, POST-only) -> our 405 JSON', hh.status === 405 && (await hh.json()).error === 'Method not allowed', `(status ${hh.status})`);
  const deep = await call('/api/households/1/members');
  check('GET /api/households/1/members (3 segments) is routed to our function -> 401 JSON', deep.status === 401 && (await deep.json()).error === 'Sign in required', `(status ${deep.status})`);
  const cronNo = await call('/api/cron/chores'); const cronBad = await call('/api/cron/chores', { headers: { authorization: 'Bearer not-the-secret' } });
  check('the cron endpoint is routed but closed to the public (401/503 with our JSON, never 200 or a platform 404)', [401, 503].includes(cronNo.status) && [401, 503].includes(cronBad.status) && /^\{"error":/.test(await cronNo.text()), `(${cronNo.status}/${cronBad.status})`);
  const sess0 = await call('/api/auth/get-session', { headers: { origin: ORIGIN } });
  check('/api/auth/get-session through our domain reaches Neon Auth (no INVALID_HOSTNAME)', sess0.status === 200 && (await sess0.text()).trim() === 'null', `(status ${sess0.status})`);
  for (const path of ['/api/auth/%2e%2e/x', '/api/auth/a%2Fb']) {
    const bad = await call(path); const b = await bad.text();
    check(`auth proxy never forwards ${path} (answers with our own JSON error, status ${bad.status})`, bad.status >= 400 && /^\{"error":/.test(b), b.slice(0, 60));
  }

  console.log('\n[2] sign-up through the proxy, on the real domain');
  const email = `roomie-test-preview-${randomBytes(3).toString('hex')}@example.com`;
  const password = randomBytes(12).toString('base64url') + 'Aa1!';
  const evil = await call('/api/auth/sign-up/email', { method: 'POST', headers: { origin: 'https://evil.example' }, body: { email: `roomie-test-preview-evil-${randomBytes(2).toString('hex')}@example.com`, password, name: 'Evil' } });
  const evilBody = await evil.text();
  check('sign-up from an UNTRUSTED origin is rejected by Neon Auth (JSON error, not a platform 404)', [400, 403].includes(evil.status) && /json/.test(evil.headers.get('content-type') ?? '') && !/NOT_FOUND/.test(evilBody), `(status ${evil.status}: ${evilBody.slice(0, 80)})`);
  const up = await call('/api/auth/sign-up/email', { method: 'POST', headers: { origin: ORIGIN }, body: { email, password, name: 'Preview Tester' } });
  check('sign-up from our trusted origin works', up.status === 200, `(status ${up.status}: ${(await up.clone().text()).slice(0, 120)})`);
  const rawCookies = up.headers.getSetCookie();
  check('a session cookie is set', rawCookies.length > 0);
  const session = rawCookies.find((c) => /session_token/i.test(c)) ?? rawCookies[0] ?? '';
  console.log(`        cookie attributes (what Safari sees): ${session.split(';').slice(1).map((s) => s.trim().replace(/=.*/, (m) => (/^=?(Max-Age|Expires|SameSite)/i.test(m) ? m : ''))).join('; ')}`);
  check('cookie is host-only (no Domain attribute), so it belongs to OUR domain', rawCookies.length > 0 && rawCookies.every((c) => !/;\s*Domain=/i.test(c)));
  check('cookie is HttpOnly and Secure', /;\s*HttpOnly/i.test(session) && /;\s*Secure/i.test(session));
  check('cookie is SameSite=Lax or Strict (first-party; no third-party-cookie dependency)', /SameSite=(Lax|Strict)/i.test(session), session.replace(/=[^;]+/, '=…'));
  check('cookie is not Partitioned and has no cross-site (None) setting', !/Partitioned/i.test(session) && !/SameSite=None/i.test(session));
  const cookie = cookieHeader(up);

  console.log('\n[3] token, API, refresh, sign-out');
  const s1 = await call('/api/auth/get-session', { headers: { cookie, origin: ORIGIN } });
  const jwt1 = s1.headers.get('set-auth-jwt');
  check('get-session returns a JWT in set-auth-jwt', s1.status === 200 && !!jwt1);
  const exp = jwt1 ? JSON.parse(Buffer.from(jwt1.split('.')[1]!, 'base64url').toString()).exp * 1000 - Date.now() : 0;
  check('JWT is short-lived (about 15 minutes)', exp > 10 * 60_000 && exp <= 16 * 60_000, `(${Math.round(exp / 1000)}s)`);
  const meRes = await call('/api/me', { headers: { authorization: `Bearer ${jwt1}` } });
  const me = await meRes.json();
  check('/api/me with the JWT creates and returns the users row on first sign-in', meRes.status === 200 && me.user?.email === email, JSON.stringify(me).slice(0, 120));
  const jwt2 = (await call('/api/auth/get-session', { headers: { cookie, origin: ORIGIN } })).headers.get('set-auth-jwt');
  check('refresh: a second get-session yields a JWT that works', !!jwt2 && (await call('/api/me', { headers: { authorization: `Bearer ${jwt2}` } })).status === 200);
  check('same person after refresh (no duplicate user)', (await (await call('/api/me', { headers: { authorization: `Bearer ${jwt2}` } })).json()).user?.userId === me.user?.userId);

  console.log('\n[4] the seed household on the real stack (as a new 5th member)');
  await assertSeedAsFifthMember(async (path, init = {}) => {
    const r = await call(path, { method: init.method, headers: { authorization: `Bearer ${jwt2}` }, body: init.body });
    const t = await r.text(); let json: unknown = t; try { json = JSON.parse(t); } catch { /* not json */ }
    return { status: r.status, json };
  }, check, me.user.userId);

  console.log('\n[5] sign-out');
  const out = await call('/api/auth/sign-out', { method: 'POST', headers: { cookie, origin: ORIGIN }, body: {} });
  check('sign-out works', out.status === 200, `(status ${out.status})`);
  const after = await call('/api/auth/get-session', { headers: { cookie, origin: ORIGIN } });
  check('the old cookie no longer gives a session', !after.headers.get('set-auth-jwt'));
}

let code = 0;
try { await main(); } catch (e) { console.error('\nERROR:', e); code = 1; }
finally {
  const swept = await sweepTestData(owner);
  const left = (await owner.query(`SELECT (SELECT count(*) FROM users WHERE email LIKE 'roomie-test-%')::int u, (SELECT count(*) FROM neon_auth."user" WHERE email LIKE 'roomie-test-%')::int a`)).rows[0];
  const clean = left.u === 0 && left.a === 0;
  console.log(`\ncleanup: removed ${JSON.stringify(swept)}; leftover roomie-test users: ${left.u} app / ${left.a} auth -> ${clean ? 'CLEAN' : 'NOT CLEAN'}`);
  if (!clean) code = 1;
  await owner.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(code || (failed ? 1 : 0));

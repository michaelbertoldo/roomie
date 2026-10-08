import { apiPath } from './http.js';

// Same-domain proxy to Neon Auth. Why a function and not a plain vercel.json rewrite to Neon: Vercel's external
// rewrite forwards the ORIGINAL Host header and Neon Auth rejects it (400 INVALID_HOSTNAME).
// A fetch() from here sends the right Host. Result: the browser only ever talks to our own domain,
// so the session cookie is first-party and Safari does not block it.
// This file holds no secrets: NEON_AUTH_URL is a public endpoint URL.

const FORWARD_REQUEST = ['cookie', 'content-type', 'origin', 'referer', 'user-agent', 'accept', 'accept-language', 'authorization', 'x-forwarded-for'];
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

/**
 * Neon sets its cookie for third-party use (SameSite=None; Partitioned). Behind our own domain it is
 * first-party, so tighten it: Lax (sent on same-site requests and top-level navigations such as OAuth
 * returns, never on cross-site subrequests) and no Partitioned. Domain is dropped so it stays host-only.
 */
/**
 * Forward ONLY Neon Auth's own cookies upstream. The browser sends every cookie for our host, and
 * unrelated ones (other apps on localhost, analytics, ...) must never reach the auth service.
 */
export function neonAuthCookies(header: string | null): string {
  if (!header) return '';
  // A browser can hold two cookies with the same name (for example an old Partitioned one and a new
  // first-party one) and sends the OLDEST first. Neon would read the stale one, so keep the LAST
  // (newest) of each name.
  const byName = new Map<string, string>();
  for (const part of header.split(';')) {
    const c = part.trim();
    const name = c.split('=')[0]!;
    if (/^(__Secure-|__Host-)?neon-auth\./.test(name)) byName.set(name, c);
  }
  return [...byName.values()].join('; ');
}

export function firstPartyCookie(cookie: string): string {
  return cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Partitioned/gi, '').replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
}

export async function proxyAuth(req: Request): Promise<Response> {
  const base = process.env.NEON_AUTH_URL;
  if (!base) return Response.json({ error: 'Auth is not configured' }, { status: 500 });

  const url = new URL(req.url);
  const full = apiPath(req); // "auth/sign-up/email"
  if (!full.startsWith('auth/')) return Response.json({ error: 'Bad path' }, { status: 400 });
  const rest = '/' + full.slice('auth/'.length);
  // Only paths under the auth base are reachable: no "..", no encoded dots, no double slashes.
  if (/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\/\/|\\/i.test(rest)) return Response.json({ error: 'Bad path' }, { status: 400 });
  url.searchParams.delete('p'); // our routing parameter, not the caller's
  const target = new URL(base.replace(/\/$/, '') + rest + (url.search ? url.search : ''));
  if (!target.pathname.startsWith(new URL(base).pathname)) return Response.json({ error: 'Bad path' }, { status: 400 });

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) { const v = req.headers.get(name); if (v && name !== 'cookie') headers.set(name, v); }
  const cookies = neonAuthCookies(req.headers.get('cookie'));
  if (cookies) headers.set('cookie', cookies);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(target, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: 'manual' });

  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (k !== 'set-cookie' && !DROP_RESPONSE.has(k)) out.set(k, v); });
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', firstPartyCookie(c));
  out.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

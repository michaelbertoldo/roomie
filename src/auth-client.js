// Browser-side sign-in for Neon Auth. Everything goes through OUR domain (/api/auth/*, proxied to
// Neon Auth by vercel.json) so the session cookie is first-party and Safari keeps it.
// The API wants a short-lived JWT (15 minutes): we fetch one from the session, cache it, and
// refresh it a minute before it expires. No database URL or secret ever lives in this file.

const AUTH = '/api/auth';
let cached = null; // { token, exp } (exp in ms)

const jwtExp = (token) => {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
  catch { return 0; }
};

async function authPost(path, body) {
  const res = await fetch(`${AUTH}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Sign-in failed');
  cached = null;
  return data;
}

export const signUp = (email, password, name) => authPost('/sign-up/email', { email, password, name });
export const signIn = (email, password) => authPost('/sign-in/email', { email, password });
export async function signOut() { cached = null; await fetch(`${AUTH}/sign-out`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }); }

/** A valid JWT, or null when signed out. Refreshes when under 60 seconds remain. */
export async function getToken({ force = false } = {}) {
  if (!force && cached && cached.exp - Date.now() > 60_000) return cached.token;
  const res = await fetch(`${AUTH}/get-session`, { credentials: 'same-origin' });
  const token = res.headers.get('set-auth-jwt');
  if (!res.ok || !token) { cached = null; return null; }
  cached = { token, exp: jwtExp(token) };
  return token;
}

/** fetch() for our own /api routes. Adds the token; on a 401 refreshes once and retries. */
export async function api(path, { method = 'GET', body } = {}) {
  const call = async (force) => {
    const token = await getToken({ force });
    if (!token) { const e = new Error('Sign in required'); e.status = 401; throw e; }
    return fetch(`/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  let res = await call(false);
  if (res.status === 401) res = await call(true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
  return data;
}

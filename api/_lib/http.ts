// Tiny helpers shared by every route. Routes are Web-standard handlers: (Request) => Response.

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Wrap a route so thrown HttpErrors become clean JSON and anything else becomes a generic 500. */
export function route(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong' }, 500);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'Body must be JSON'); }
}

/** Positive integer path/body id, or 400. */
export function id(value: unknown, what = 'id'): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${what}`);
  return n;
}

/**
 * The API path after /api, e.g. "households/3/members". On Vercel, vercel.json rewrites every
 * /api/* request into /api/router (or /api/auth-proxy) and carries the original path in ?p=.
 * (Vercel's file-based catch-all routes only match ONE path segment, so we route ourselves.)
 * Locally, scripts/dev-server.ts serves the original path directly.
 */
export function apiPath(req: Request): string {
  const u = new URL(req.url);
  if (u.pathname === '/api/router' && u.searchParams.has('p')) return u.searchParams.get('p')!;
  if (u.pathname === '/api/auth-proxy' && u.searchParams.has('p')) return 'auth/' + u.searchParams.get('p')!;
  return u.pathname.replace(/^\/api\/?/, '');
}
export const segments = (req: Request) => apiPath(req).split('/').filter(Boolean);

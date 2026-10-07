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

/** Path segments after /api, e.g. /api/households/3/members -> ['households','3','members'] */
export const segments = (req: Request) => new URL(req.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

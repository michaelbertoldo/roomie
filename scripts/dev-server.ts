// Local stand-in for Vercel: serves the same route table (api/_lib/routes.ts) and proxies
// /api/auth/* to Neon Auth, exactly like the rewrite in vercel.json does in production.
import { createServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = body && req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers, body: hasBody ? body : undefined });
}

export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path.startsWith('/api/auth/')) { const { proxyAuth } = await import('../api/_lib/authProxy.js'); return proxyAuth(req); }
  const { dispatch } = await import('../api/_lib/routes.js'); // imported late so env is loaded first
  return dispatch(req);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3001);
  createServer(async (nodeReq, nodeRes) => {
    try {
      const res = await handle(await toRequest(nodeReq));
      const headers: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      nodeRes.writeHead(res.status, headers);
      nodeRes.end(Buffer.from(await res.arrayBuffer()));
    } catch (e) { console.error(e); nodeRes.writeHead(500).end('dev server error'); }
  }).listen(port, () => console.log(`api on http://localhost:${port}`));
}

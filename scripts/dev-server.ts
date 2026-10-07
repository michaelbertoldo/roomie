// Local stand-in for Vercel: mounts every file in api/ as a route (same file-based rules)
// and proxies /api/auth/* to Neon Auth so the sign-in cookie is first-party, like production.
import { createServer, type IncomingMessage } from 'node:http';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

type Handler = (req: Request) => Promise<Response> | Response;
type Route = { regex: RegExp; file: string; static: boolean };

function scan(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '_lib') continue;
    if (statSync(p).isDirectory()) scan(p, out); else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

export function buildRoutes(apiDir = 'api'): Route[] {
  return scan(apiDir).map((file) => {
    const rel = relative(apiDir, file).split(sep).join('/').replace(/\.ts$/, '').replace(/\/index$/, '').replace(/^index$/, '');
    const isStatic = !rel.includes('[');
    const pattern = rel.split('/').map((s) => (s.startsWith('[') ? '[^/]+' : s.replace(/[.*+?^${}()|\\]/g, '\\$&'))).join('/');
    return { regex: new RegExp(`^/api/${pattern}/?$`), file, static: isStatic };
  }).sort((a, b) => Number(b.static) - Number(a.static));
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = body && req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers, body: hasBody ? body : undefined });
}

export async function handle(req: Request, routes: Route[]): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path.startsWith('/api/auth/')) return proxyAuth(req);
  const hit = routes.find((r) => r.regex.test(path));
  if (!hit) return Response.json({ error: 'Not found' }, { status: 404 });
  const mod = (await import(pathToFileURL(join(process.cwd(), hit.file)).href)) as Record<string, Handler>;
  const fn = mod[req.method];
  if (!fn) return Response.json({ error: 'Method not allowed' }, { status: 405 });
  return fn(req);
}

async function proxyAuth(req: Request): Promise<Response> {
  const base = process.env.NEON_AUTH_URL!;
  const url = new URL(req.url);
  const target = base + url.pathname.replace(/^\/api\/auth/, '') + url.search;
  const headers = new Headers(req.headers);
  headers.delete('host');
  const upstream = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(), redirect: 'manual' });
  const out = new Headers(upstream.headers);
  out.delete('content-encoding'); out.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const routes = buildRoutes();
  const port = Number(process.env.PORT ?? 3001);
  createServer(async (nodeReq, nodeRes) => {
    try {
      const res = await handle(await toRequest(nodeReq), routes);
      const headers: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      nodeRes.writeHead(res.status, headers);
      nodeRes.end(Buffer.from(await res.arrayBuffer()));
    } catch (e) { console.error(e); nodeRes.writeHead(500).end('dev server error'); }
  }).listen(port, () => console.log(`api on http://localhost:${port}  (${routes.length} routes)`));
}

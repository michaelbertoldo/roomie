import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../api/_lib/http.js';
import { assertCreator } from '../api/_lib/household.js';
import { newJoinCode } from '../api/_lib/joincode.js';

const files = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (n === '_lib') continue; statSync(p).isDirectory() ? files(p, out) : n.endsWith('.ts') && out.push(p); }
  return out;
};

describe('every API route is behind authentication', () => {
  const handlerFiles = files('api/_lib/handlers');
  it('every exported handler is built with withUser or withHousehold', () => {
    expect(handlerFiles.length).toBeGreaterThan(0);
    for (const f of handlerFiles) {
      const src = readFileSync(f, 'utf8');
      const handlers = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*(\w+)\(/g)];
      expect(handlers.length, `${f} exports no handler`).toBeGreaterThan(0);
      for (const h of handlers) expect(['withUser', 'withHousehold'], `${f}: ${h[1]} must be wrapped`).toContain(h[2]);
    }
  });
  it('every handler file is registered in the route table (no orphan handlers)', () => {
    const table = readFileSync('api/_lib/routes.ts', 'utf8');
    for (const f of handlerFiles) expect(table, `${f} is not registered in api/_lib/routes.ts`).toContain(`./handlers/${f.split('/').pop()!.replace(/\.ts$/, '')}.js`);
  });
  it('household-scoped handlers (/households/:id/...) all use withHousehold, never withUser', () => {
    const table = readFileSync('api/_lib/routes.ts', 'utf8');
    const scoped = [...table.matchAll(/add\('\/households\/:id\/[^']*', (\w+)\)/g)].map((m) => m[1]);
    expect(scoped.length).toBeGreaterThan(0);
    const imports = Object.fromEntries([...table.matchAll(/import \* as (\w+) from '\.\/handlers\/([\w-]+)\.js'/g)].map((m) => [m[1], m[2]]));
    for (const name of scoped) expect(readFileSync(`api/_lib/handlers/${imports[name!]}.ts`, 'utf8'), `${imports[name!]} must use withHousehold`).not.toMatch(/withUser\(/);
  });
  it('entry files in api/ only forward to dispatch (nothing can bypass the table)', () => {
    for (const f of files('api')) expect(readFileSync(f, 'utf8'), f).toMatch(/export const GET = (dispatch|proxyAuth);/);
    expect(files('api').length).toBeLessThanOrEqual(8); // Hobby plan allows 12 functions per deployment
  });
});

describe('auth cookie handling', () => {
  it('forwards only Neon Auth cookies upstream, never unrelated ones', async () => {
    const { neonAuthCookies } = await import('../api/_lib/authProxy.js');
    const header = 'sb-abc-auth-token=BIGSECRET; __Secure-neon-auth.session_token=tok; _ga=GA1; neon-auth.csrf=x; fake-neon-auth.x=1; __Host-neon-auth.state=s';
    expect(neonAuthCookies(header)).toBe('__Secure-neon-auth.session_token=tok; neon-auth.csrf=x; __Host-neon-auth.state=s');
    expect(neonAuthCookies('a=b; c=d')).toBe('');
    expect(neonAuthCookies('x=1; __Secure-neon-auth.session_token=STALE; __Secure-neon-auth.session_token=FRESH')).toBe('__Secure-neon-auth.session_token=FRESH');
    expect(neonAuthCookies(null)).toBe('');
  });
  it('turns Neon\'s third-party cookie into a first-party one', async () => {
    const { firstPartyCookie } = await import('../api/_lib/authProxy.js');
    const c = firstPartyCookie('__Secure-neon-auth.session_token=abc.def; Max-Age=604800; Domain=neon.tech; Path=/; HttpOnly; Secure; SameSite=None; Partitioned');
    expect(c).toBe('__Secure-neon-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(firstPartyCookie('a=b; Path=/; SameSite=Strict')).toBe('a=b; Path=/; SameSite=Strict');
  });
});

describe('auth proxy', () => {
  it('has a path guard so requests cannot escape the Neon Auth base path', async () => {
    process.env.NEON_AUTH_URL = 'https://example.neonauth.test/db/auth';
    const { proxyAuth } = await import('../api/_lib/authProxy.js');
    for (const bad of ['/api/auth/../rest/v1/users', '/api/auth/%2e%2e/x', '/api/auth//evil.example', '/api/auth/a%2Fb', '/api/auth/%5cevil'])
      expect((await proxyAuth(new Request('https://app.test' + bad))).status, bad).toBe(400);
  });
});

describe('frontend never sees a database credential', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : /\.(js|ts|html|css)$/.test(n) && out.push(p); }
    return out;
  };
  it('no VITE_ variable or browser-side file mentions a database URL or credential', () => {
    expect(readFileSync('.env.example', 'utf8')).not.toMatch(/VITE_[A-Z_]*(DATABASE|NEON_DATA|POSTGRES)/);
    const browserFiles = [...walk('src'), ...walk('shared'), ...walk('public'), 'index.html'];
    expect(browserFiles.length).toBeGreaterThan(5);
    for (const f of browserFiles) expect(readFileSync(f, 'utf8'), f).not.toMatch(/DATABASE_URL|postgres(ql)?:\/\/|npg_[A-Za-z0-9]{8,}/i);
  });
  it('browser code never imports from api/ (that path is proxied to the server in dev and is server-only)', () => {
    for (const f of walk('src')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"][./]*\/?api\//);
  });
});

describe('creator-only edits', () => {
  it('allows the creator and rejects everyone else (including rows with no creator)', () => {
    expect(() => assertCreator(5, 5)).not.toThrow();
    expect(() => assertCreator(5, 6)).toThrow(HttpError);
    expect(() => assertCreator(null, 6)).toThrow(HttpError);
  });
});

describe('join codes', () => {
  it('are 8 characters from an unambiguous alphabet and not repeated', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) { const c = newJoinCode(); expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/); seen.add(c); }
    expect(seen.size).toBe(2000);
  });
});

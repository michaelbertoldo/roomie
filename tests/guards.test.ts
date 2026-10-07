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
  it('each file in api/ uses withUser or withHousehold for every exported handler', () => {
    for (const f of files('api')) {
      const src = readFileSync(f, 'utf8');
      const handlers = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*(\w+)\(/g)];
      expect(handlers.length, `${f} exports no handler`).toBeGreaterThan(0);
      for (const h of handlers) expect(['withUser', 'withHousehold'], `${f}: ${h[1]} must be wrapped`).toContain(h[2]);
    }
  });
  it('routes under api/households/[id]/ always use withHousehold (the shared membership check)', () => {
    for (const f of files('api/households/[id]')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/withUser\(/);
  });
});

describe('frontend never sees a database credential', () => {
  it('no VITE_ variable or src/ file mentions DATABASE_URL', () => {
    for (const f of ['.env.example']) expect(readFileSync(f, 'utf8')).not.toMatch(/VITE_[A-Z_]*(DATABASE|NEON_DATA|POSTGRES)/);
    for (const f of files('src').concat(['index.html', 'app.js', 'app2.js'])) expect(readFileSync(f, 'utf8'), f).not.toMatch(/DATABASE_URL|postgres(ql)?:\/\//i);
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

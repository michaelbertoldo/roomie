import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import * as relations from './relations.js';

// Server only. DATABASE_URL is the pooled Neon URL of the table-owner role (neondb_owner).
// It must never reach frontend code or a VITE_ variable.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const globalForPool = globalThis as unknown as { __pool?: pg.Pool };
export const pool = (globalForPool.__pool ??= (() => {
  const p = new pg.Pool({ connectionString: url, max: 5 });
  // Neon (or the network) can drop an IDLE connection. pg reports that as an 'error' event on the pool, and with no
  // listener Node treats it as an uncaught exception. Log it; the pool discards that client and opens a new one.
  p.on('error', (e: NodeJS.ErrnoException) => console.error('idle database connection dropped:', e.code ?? e.message));
  // Same for a connection that is checked out (inside a transaction) between two statements: the error is emitted on the
  // client, not the pool. The next statement then fails with a normal error, which becomes a clean 500 instead of a crash.
  p.on('connect', (c) => c.on('error', (e: NodeJS.ErrnoException) => console.error('database connection error:', e.code ?? e.message)));
  return p;
})());

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

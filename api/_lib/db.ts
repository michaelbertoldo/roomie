import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import * as relations from './relations.js';

// Server only. DATABASE_URL is the pooled Neon URL of the table-owner role (neondb_owner).
// It must never reach frontend code or a VITE_ variable.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const globalForPool = globalThis as unknown as { __pool?: pg.Pool };
export const pool = (globalForPool.__pool ??= new pg.Pool({ connectionString: url, max: 5 }));

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

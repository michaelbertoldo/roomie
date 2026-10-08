// Apply ONE reviewed migration file in a single transaction.
//   npm run db:migrate -- db/migrations/0003_x.sql                 -> dev (default)
//   npm run db:migrate:prod -- db/migrations/0003_x.sql            -> main, only after it passed on dev and was reviewed
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { assertBranchFor } from './lib/db-guard.js';

const file = process.argv.slice(2).find((a) => a.endsWith('.sql'));
if (!file || !/^db\/migrations\/\d{4}_[\w-]+\.sql$/.test(file)) { console.error('usage: npm run db:migrate -- db/migrations/NNNN_name.sql'); process.exit(2); }
const production = process.argv.includes('--production');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
try {
  const branch = await assertBranchFor(pool, `migration ${file}`, { production });
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query(readFileSync(file, 'utf8')); await c.query('COMMIT'); console.log(`applied ${file} on ${branch}`); }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
} finally { await pool.end(); }

// Row count per table. `npm run db:counts` (dev) | `npm run db:counts:prod` (main, read-only)
import { pool } from '../api/_lib/db.js';
const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`);
for (const { table_name: t } of rows) console.log(t.padEnd(22), (await pool.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n);
console.log(rows.length, 'tables');
await pool.end();

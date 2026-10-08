// Removes everything test runs create. Only ever touches rows whose email starts with
// 'roomie-test-'. Used at the start of a run (sweep leftovers from a crash) and in `finally`.
import pg from 'pg';
import { assertDevDatabase } from './db-guard.js';

const PREFIX = 'roomie-test-';

export async function sweepTestData(pool: pg.Pool) {
  await assertDevDatabase(pool, 'the test cleanup');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // households whose members are ALL test users (never touches a household a real person is in)
    const houses = await c.query(`
      DELETE FROM household h WHERE EXISTS (
        SELECT 1 FROM household_member m JOIN users u USING (user_id) WHERE m.household_id = h.household_id AND u.email LIKE $1)
        AND NOT EXISTS (
        SELECT 1 FROM household_member m JOIN users u USING (user_id) WHERE m.household_id = h.household_id AND u.email NOT LIKE $1)
      RETURNING 1`, [PREFIX + '%']);
    const users = await c.query('DELETE FROM users WHERE email LIKE $1 RETURNING 1', [PREFIX + '%']);
    const auth = await c.query('DELETE FROM neon_auth."user" WHERE email LIKE $1 RETURNING 1', [PREFIX + '%']); // sessions/accounts cascade
    await c.query('COMMIT');
    return { households: houses.rowCount ?? 0, appUsers: users.rowCount ?? 0, authUsers: auth.rowCount ?? 0 };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export async function countTestData(pool: pg.Pool) {
  await assertDevDatabase(pool, 'the test cleanup');
  const r = await pool.query(`
    SELECT (SELECT count(*) FROM users WHERE email LIKE $1)::int AS app_users,
           (SELECT count(*) FROM neon_auth."user" WHERE email LIKE $1)::int AS auth_users,
           (SELECT count(*) FROM household h WHERE EXISTS (SELECT 1 FROM household_member m JOIN users u USING (user_id) WHERE m.household_id = h.household_id AND u.email LIKE $1))::int AS households`, [PREFIX + '%']);
  return r.rows[0] as { app_users: number; auth_users: number; households: number };
}

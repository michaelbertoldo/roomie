// Keeps tests and dev tooling away from production. The check asks the DATABASE ITSELF which
// Neon endpoint it is (neon.endpoint_id) and compares it to db/branches.json, so a wrong
// connection string, a copied env file or a stale shell variable cannot slip through.
import { readFileSync } from 'node:fs';
import type pg from 'pg';

const branches = JSON.parse(readFileSync(new URL('../../db/branches.json', import.meta.url), 'utf8')) as Record<'main' | 'dev', { endpointId: string }>;

/** Env-level check (no network): every URL in the environment must belong to the dev endpoint. */
export function assertDevEnv(what = 'this script') {
  const urls = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED, NEON_AUTH_URL: process.env.NEON_AUTH_URL };
  for (const [name, url] of Object.entries(urls)) {
    if (!url) throw new Error(`REFUSING TO RUN: ${what} needs ${name} from .env.local (dev).`);
    if (url.includes(branches.main.endpointId)) throw new Error(`REFUSING TO RUN: ${name} points at PRODUCTION (main). ${what} only runs against dev.`);
    if (!url.includes(branches.dev.endpointId)) throw new Error(`REFUSING TO RUN: ${name} does not point at the dev endpoint (${branches.dev.endpointId}).`);
  }
}

export type DbBranch = 'main' | 'dev' | 'unknown';
export async function dbBranch(pool: pg.Pool): Promise<DbBranch> {
  const r = await pool.query(`SELECT current_setting('neon.endpoint_id', true) AS ep`);
  const ep = r.rows[0]?.ep as string | null;
  return ep === branches.main.endpointId ? 'main' : ep === branches.dev.endpointId ? 'dev' : 'unknown';
}

/** Tests, sweeps and fixtures: dev only. Throws (loudly) on main or anything unrecognised. */
export async function assertDevDatabase(pool: pg.Pool, what = 'this script') {
  assertDevEnv(what);
  const b = await dbBranch(pool);
  if (b !== 'dev') throw new Error(`REFUSING TO RUN: ${what} is only allowed on the Neon "dev" branch, but this connection is "${b}". Check .env.local (it must point at dev). Production work uses .env.production.local on purpose.`);
  if (process.env.ROOMIE_DB_BRANCH && process.env.ROOMIE_DB_BRANCH !== 'dev') throw new Error(`REFUSING TO RUN: ROOMIE_DB_BRANCH=${process.env.ROOMIE_DB_BRANCH} but the database is dev.`);
}

/** Seed, unseed and migrations: dev by default; main only when the caller passed --production AND the env says main. */
export async function assertBranchFor(pool: pg.Pool, what: string, { production }: { production: boolean }) {
  const b = await dbBranch(pool);
  if (production) {
    if (b !== 'main' || process.env.ROOMIE_DB_BRANCH !== 'main') throw new Error(`REFUSING: --production needs .env.production.local (main), but this connection is "${b}" / ROOMIE_DB_BRANCH=${process.env.ROOMIE_DB_BRANCH}.`);
    console.log(`!! ${what} against PRODUCTION (main) !!`);
    return b;
  }
  if (b !== 'dev') throw new Error(`REFUSING: ${what} on "${b}" needs the --production flag and .env.production.local. By default it only runs on dev.`);
  return b;
}

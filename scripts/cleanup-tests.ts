// Removes any leftover roomie-test-* accounts and test-only households. Safe to run any time.
import pg from 'pg';
import { sweepTestData } from './lib/test-cleanup.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
console.log('cleanup:', JSON.stringify(await sweepTestData(pool)));
await pool.end();

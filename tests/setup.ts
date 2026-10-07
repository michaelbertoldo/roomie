// Unit tests never touch a real database; the pool only connects when a query runs.
process.env.DATABASE_URL ??= 'postgresql://unit:test@localhost:5432/unit';
process.env.NEON_AUTH_URL ??= 'https://example.neonauth.test/db/auth';

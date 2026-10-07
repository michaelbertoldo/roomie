# Roomie database

Neon project `roomie` (id royal-dawn-21099610), branch `main`, database `neondb`, Postgres 17.

- `schema.sql` is the source of truth (v3, 18 tables). It was applied once to the empty database.
- `migrations/` holds every change since, as numbered files that are reviewed before they run.
  - `0001_drop_prototype_and_lockdown.sql` removed the first RLS prototype and revoked all access for `authenticated` / `anonymous`.
  - `0002_lock_set_updated_at.sql` closed EXECUTE on the trigger function.
- `archive/` is the old row-level-security prototype. Kept for reference only. Never run.
- `../CLAUDE.md` has the Database and Security rules every session follows.

## How the app reaches the data
Browser -> `/api/*` (Vercel functions) -> Neon over `DATABASE_URL`. Nothing else. The Neon Data API is OFF.
Sign-in is Neon Auth, reached through our own domain at `/api/auth/*` (a rewrite in `vercel.json`).

## Roles
- `neondb_owner`: the role in `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Owns all 18 tables, full access. This is what `/api` uses.
- `authenticated`, `anonymous`: the Data API roles. Zero privileges on every table. Keep it that way.

## Changing the schema
1. Write the next numbered file in `migrations/` and get it reviewed.
2. Apply it with `psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -1 -f db/migrations/000N_name.sql`.
3. `npm run db:pull` to refresh `api/_lib/schema.ts` and `relations.ts`, then `npm run typecheck`.
4. `npm test && npm run test:security`.
5. Update `schema.sql` so it still describes the whole database.

## Seed data
`npm run db:seed` loads one demo household (join code `MAPLE412`, 3 current roommates and 1 who moved out). It deletes and recreates only its own rows (users ending `@seed.roomie.test`). Not run against Neon until reviewed.

## Environment
See `.env.example`. `DATABASE_URL` (pooled) for `/api`, `DATABASE_URL_UNPOOLED` for migrations and `db:pull`, `NEON_AUTH_URL` for token verification. In Vercel set `DATABASE_URL` and `NEON_AUTH_URL` as environment variables.

## Vercel
`vercel.json` proxies `/api/auth/*` to Neon Auth. After the first deploy, add the production domain (and preview domain pattern) to Neon Auth trusted origins, otherwise sign-in from that domain is rejected.

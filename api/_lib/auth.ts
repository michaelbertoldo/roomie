import { createRemoteJWKSet, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { db, schema } from './db.js';
import { HttpError } from './http.js';

// Neon Auth (Managed Better Auth) signs 15-minute EdDSA JWTs. We verify them locally
// against the JWKS, so no network call to the auth service is needed per request.
const AUTH_URL = process.env.NEON_AUTH_URL;
if (!AUTH_URL) throw new Error('NEON_AUTH_URL is not set');
const ORIGIN = new URL(AUTH_URL).origin;
const jwks = createRemoteJWKSet(new URL(`${AUTH_URL}/.well-known/jwks.json`));

export type CurrentUser = { userId: number; authId: string; email: string };

/** Verify the bearer token and return the provider's claims, or 401. */
export async function verifyToken(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sign in required');
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ORIGIN, audience: ORIGIN, algorithms: ['EdDSA'] });
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no sub');
    return payload as typeof payload & { sub: string; email?: string; name?: string };
  } catch {
    throw new HttpError(401, 'Session expired. Sign in again.');
  }
}

/**
 * Every route starts here. Returns the app user for the token, creating the users row
 * on first sign-in. We never link by email: someone could register another person's
 * email, so an email that already belongs to a different sign-in is a 409.
 */
export async function requireUser(req: Request): Promise<CurrentUser> {
  const claims = await verifyToken(req);
  const authId = claims.sub;
  const existing = await db.select({ userId: schema.users.userId, email: schema.users.email })
    .from(schema.users).where(eq(schema.users.authProviderId, authId)).limit(1);
  if (existing[0]) return { userId: existing[0].userId, authId, email: existing[0].email };

  const email = (claims.email ?? '').trim().toLowerCase();
  if (!email) throw new HttpError(400, 'Your account has no email address');
  const [first = '', ...rest] = (claims.name ?? '').trim().split(/\s+/);
  const inserted = await db.insert(schema.users)
    .values({ authProviderId: authId, email, firstName: first || email.split('@')[0]!, lastName: rest.join(' ') })
    .onConflictDoNothing({ target: schema.users.authProviderId })
    .returning({ userId: schema.users.userId }).catch((e) => {
      if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'That email is already registered to another sign-in');
      throw e;
    });
  if (inserted[0]) return { userId: inserted[0].userId, authId, email };
  // lost a race with a parallel first request: read the row the winner created
  const again = await db.select({ userId: schema.users.userId }).from(schema.users).where(eq(schema.users.authProviderId, authId)).limit(1);
  if (!again[0]) throw new HttpError(500, 'Could not create your profile');
  return { userId: again[0].userId, authId, email };
}

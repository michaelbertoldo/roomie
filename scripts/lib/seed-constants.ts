// Single source of truth for what counts as "seed data". seed.ts and unseed.ts both use it,
// so unseeding can only ever remove these exact rows.
export const SEED_JOIN_CODE = 'MAPLE412';
// @example.com is reserved, so these can never belong to a real person. They deliberately do
// NOT start with "roomie-test-", so the security-test cleanup never touches them.
export const SEED_EMAILS = {
  alex: 'maple.alex@example.com',
  priya: 'maple.priya@example.com',
  jake: 'maple.jake@example.com',
  sam: 'maple.sam@example.com',
} as const;
export const SEED_EMAIL_LIST: string[] = Object.values(SEED_EMAILS);

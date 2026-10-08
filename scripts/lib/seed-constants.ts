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
  dana: 'elm.dana@example.com', // owner of the second seed household
  eli: 'cedar.eli@example.com', // owner of the third seed household
} as const;
// two small extra households so the household table has several rows. Demo = SEED_JOIN_CODE.
export const SEED_EXTRA_JOIN_CODES = ['ELM208', 'CEDAR3B'];
export const SEED_ALL_JOIN_CODES = [SEED_JOIN_CODE, ...SEED_EXTRA_JOIN_CODES];
export const SEED_EMAIL_LIST: string[] = Object.values(SEED_EMAILS);

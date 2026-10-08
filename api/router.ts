import { dispatch } from './_lib/routes.js';

// Entry point only. vercel.json rewrites /api/* here; all logic is in api/_lib/handlers and is
// registered in api/_lib/routes.ts.
export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;

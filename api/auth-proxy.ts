import { proxyAuth } from './_lib/authProxy.js';

// Entry point only. vercel.json rewrites /api/auth/* here; see api/_lib/authProxy.ts.
export const GET = proxyAuth;
export const POST = proxyAuth;
export const PATCH = proxyAuth;
export const PUT = proxyAuth;
export const DELETE = proxyAuth;

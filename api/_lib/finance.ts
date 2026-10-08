// Slice (a): expenses, splits, balances, pay-back, wish list. Every function here is called from a
// withHousehold handler, so the caller is already proven to be an ACTIVE member of householdId.
// Rules live in CLAUDE.md; the short version: balances are calculated (shared/balances.ts), money is
// NUMERIC strings + integer cents, notifications are inserted in the same transaction as the action.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema as s, type Tx } from './db.js';
import type { CurrentUser } from './auth.js';
import { HttpError, id } from './http.js';
import { assertActiveMembers, assertCreator } from './household.js';
import { fromCents, splitCents, sumCents, toCents } from '../../shared/money.js';
import { balancesFor, computeBalances, shareStatus, type PaymentRow, type PaymentStatus, type ShareRow } from '../../shared/balances.js';

const MAX_CENTS = 100_000_000; // $1,000,000.00
const APPS = ['venmo', 'zelle', 'apple_cash'] as const;
const usd = (cents: number) => `$${fromCents(cents)}`;

// ---- validation helpers -----------------------------------------------------------------------
function str(v: unknown, min: number, max: number, label: string): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < min || t.length > max) throw new HttpError(400, min ? `${label} is required (up to ${max} characters)` : `${label} must be at most ${max} characters`);
  return t;
}
const optStr = (v: unknown, max: number, label: string) => (v == null || v === '' ? null : str(v, 1, max, label));
function moneyOf(v: unknown, label: string, { allowZero = false } = {}): number {
  if (typeof v !== 'string') throw new HttpError(400, `${label} must be an amount like "12.34"`);
  let c: number;
  try { c = toCents(v); } catch { throw new HttpError(400, `${label} must be an amount like "12.34"`); }
  if (c < 0 || (!allowZero && c === 0)) throw new HttpError(400, `${label} must be more than $0`);
  if (c > MAX_CENTS) throw new HttpError(400, `${label} is too large`);
  return c;
}
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
function ymd(v: unknown, tz: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`)) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) throw new HttpError(400, 'Date must look like 2026-10-31');
  const t = new Date(`${todayIn(tz)}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  if (v > t.toISOString().slice(0, 10)) throw new HttpError(400, 'The purchase date cannot be in the future');
  if (v < '2000-01-01') throw new HttpError(400, 'That date is too far back');
  return v;
}
function webUrl(v: unknown): string | null {
  const t = optStr(v, 500, 'Link'); if (!t) return null;
  let u: URL; try { u = new URL(t); } catch { throw new HttpError(400, 'Link must be a web address starting with https://'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'Link must be a web address starting with https://');
  return u.toString();
}
async function householdTz(ex: Tx | typeof db, householdId: number) {
  const [h] = await ex.select({ tz: s.household.timezone }).from(s.household).where(eq(s.household.householdId, householdId));
  return h?.tz ?? 'America/Denver';
}
const firstName = async (ex: Tx | typeof db, userId: number) => (await ex.select({ f: s.users.firstName }).from(s.users).where(eq(s.users.userId, userId)))[0]?.f ?? 'Someone';
async function activeIds(ex: Tx | typeof db, householdId: number) {
  return (await ex.select({ u: s.householdMember.userId }).from(s.householdMember).where(and(eq(s.householdMember.householdId, householdId), isNull(s.householdMember.leftDate)))).map((r) => r.u);
}

// ---- reading ----------------------------------------------------------------------------------
async function loadLedger(householdId: number) {
  const shares = await db.select({
    expenseId: s.expenseShare.expenseId, userId: s.expenseShare.userId, amountOwed: s.expenseShare.amountOwed,
    settledByPaymentId: s.expenseShare.settledByPaymentId, paidByUserId: s.expense.paidByUserId, itemName: s.expense.itemName, purchaseDate: s.expense.purchaseDate,
  }).from(s.expenseShare).innerJoin(s.expense, eq(s.expense.expenseId, s.expenseShare.expenseId)).where(eq(s.expense.householdId, householdId));
  const payments = await db.select().from(s.payment).where(eq(s.payment.householdId, householdId));
  return { shares, payments };
}

export async function listExpenses(householdId: number, viewerId: number) {
  const exps = await db.select().from(s.expense).where(eq(s.expense.householdId, householdId)).orderBy(desc(s.expense.purchaseDate), desc(s.expense.expenseId)).limit(200);
  const { shares, payments } = await loadLedger(householdId);
  const payMap = new Map(payments.map((p) => [p.paymentId, { status: p.status as PaymentStatus }]));
  const byExpense = new Map<number, typeof shares>();
  for (const sh of shares) (byExpense.get(sh.expenseId) ?? byExpense.set(sh.expenseId, []).get(sh.expenseId)!).push(sh);
  return {
    expenses: exps.map((e) => {
      const mine = (byExpense.get(e.expenseId) ?? []).sort((a, b) => Number(b.userId === e.paidByUserId) - Number(a.userId === e.paidByUserId) || a.userId - b.userId);
      return {
        expenseId: e.expenseId, itemName: e.itemName, totalAmount: e.totalAmount, purchaseDate: e.purchaseDate, paidByUserId: e.paidByUserId, wishlistItemId: e.wishlistItemId,
        shares: mine.map((sh) => ({ userId: sh.userId, amountOwed: sh.amountOwed, status: shareStatus(sh, payMap), paymentId: sh.settledByPaymentId })),
        canDelete: e.paidByUserId === viewerId && mine.every((sh) => sh.settledByPaymentId == null),
      };
    }),
  };
}

export async function getBalances(householdId: number, viewerId: number) {
  const { shares, payments } = await loadLedger(householdId);
  const rows: ShareRow[] = shares.map((x) => ({ expenseId: x.expenseId, userId: x.userId, paidByUserId: x.paidByUserId, amountOwed: x.amountOwed, settledByPaymentId: x.settledByPaymentId }));
  const pays: PaymentRow[] = payments.map((p) => ({ paymentId: p.paymentId, payerUserId: p.payerUserId, payeeUserId: p.payeeUserId, amount: p.amount, status: p.status as PaymentRow['status'] }));
  const pairs = computeBalances(rows, pays);
  const itemsOf = (paymentId: number) => shares.filter((x) => x.settledByPaymentId === paymentId).map((x) => ({ expenseId: x.expenseId, itemName: x.itemName, amountOwed: x.amountOwed }));
  const payment = (p: (typeof payments)[number]) => ({ paymentId: p.paymentId, payerUserId: p.payerUserId, payeeUserId: p.payeeUserId, amount: p.amount, paidWith: p.paidWith, status: p.status, paidDate: p.paidDate, items: itemsOf(p.paymentId) });
  const methods = await db.select({ userId: s.paymentMethod.userId, app: s.paymentMethod.app, username: s.paymentMethod.username, isPreferred: s.paymentMethod.isPreferred })
    .from(s.paymentMethod).innerJoin(s.householdMember, and(eq(s.householdMember.userId, s.paymentMethod.userId), eq(s.householdMember.householdId, householdId)));
  const paymentMethods: Record<number, { app: string; username: string; isPreferred: boolean }[]> = {};
  for (const m of methods) (paymentMethods[m.userId] ??= []).push({ app: m.app, username: m.username, isPreferred: m.isPreferred });
  return {
    pairs: pairs.map((p) => ({ debtorUserId: p.debtorUserId, creditorUserId: p.creditorUserId, amount: fromCents(p.cents), pendingAmount: fromCents(p.pendingCents), disputedAmount: fromCents(p.disputedCents) })),
    mine: balancesFor(viewerId, pairs).map((b) => ({ otherUserId: b.otherUserId, signedAmount: fromCents(b.signedCents), pendingAmount: fromCents(b.pendingCents), disputedAmount: fromCents(b.disputedCents) })),
    // my shares on other people's purchases that nobody has paid back or sent money for yet
    payable: shares.filter((x) => x.userId === viewerId && x.paidByUserId !== viewerId && x.settledByPaymentId == null)
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)).map((x) => ({ expenseId: x.expenseId, itemName: x.itemName, purchaseDate: x.purchaseDate, payeeUserId: x.paidByUserId, amountOwed: x.amountOwed })),
    incoming: payments.filter((p) => p.payeeUserId === viewerId && p.status !== 'confirmed').map(payment),
    outgoing: payments.filter((p) => p.payerUserId === viewerId && p.status !== 'confirmed').map(payment),
    paymentMethods,
  };
}

// ---- expenses ---------------------------------------------------------------------------------
export async function createExpense(user: CurrentUser, householdId: number, b: Record<string, unknown>) {
  const itemName = str(b.itemName, 1, 120, 'Item name');
  const total = moneyOf(b.totalAmount, 'Total');
  const tz = await householdTz(db, householdId);
  const date = b.purchaseDate === undefined || b.purchaseDate === '' ? todayIn(tz) : ymd(b.purchaseDate, tz);
  const raw = Array.isArray(b.participantUserIds) ? b.participantUserIds : [];
  if (raw.length > 12) throw new HttpError(400, 'Too many roommates');
  const others = [...new Set(raw.map((x) => id(x, 'roommate')))].filter((x) => x !== user.userId).sort((a, c) => a - c);
  if (!others.length) throw new HttpError(400, 'Pick at least one other roommate to split with');
  const wishId = b.wishlistItemId == null || b.wishlistItemId === '' ? null : id(b.wishlistItemId, 'wish list item');
  const order = [user.userId, ...others]; // the buyer comes first, so leftover cents land on the first shares
  if (total < order.length) throw new HttpError(400, 'That total is too small to split that many ways');
  const parts = splitCents(total, order.length);

  try {
    return await db.transaction(async (tx) => {
      await assertActiveMembers(tx, householdId, order);
      if (wishId != null) {
        const [w] = await tx.select().from(s.wishlistItem).where(and(eq(s.wishlistItem.wishlistItemId, wishId), eq(s.wishlistItem.householdId, householdId))).for('update');
        if (!w) throw new HttpError(404, 'Wish list item not found');
        if (w.isBought) throw new HttpError(400, 'That wish list item was already bought');
        await tx.update(s.wishlistItem).set({ isBought: true }).where(eq(s.wishlistItem.wishlistItemId, wishId));
      }
      // paid_by is ALWAYS the caller. Nobody can log a purchase as someone else.
      const [e] = await tx.insert(s.expense).values({ householdId, paidByUserId: user.userId, wishlistItemId: wishId, itemName, totalAmount: fromCents(total), purchaseDate: date }).returning();
      await tx.insert(s.expenseShare).values(order.map((u, i) => ({ expenseId: e!.expenseId, userId: u, amountOwed: fromCents(parts[i]!) })));
      const me = await firstName(tx, user.userId);
      await tx.insert(s.notification).values(others.map((u, i) => ({
        userId: u, householdId, actorUserId: user.userId, section: 'expense_tracker', sourceType: 'expense', sourceId: e!.expenseId,
        message: `${me} added ${itemName}: you owe ${usd(parts[i + 1]!)}.`,
      })));
      return { expenseId: e!.expenseId, shares: order.map((u, i) => ({ userId: u, amountOwed: fromCents(parts[i]!) })) };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(400, 'That wish list item was already bought');
    throw e;
  }
}

export async function deleteExpense(user: CurrentUser, householdId: number, expenseId: number) {
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(s.expense).where(and(eq(s.expense.expenseId, expenseId), eq(s.expense.householdId, householdId))).for('update');
    if (!e) throw new HttpError(404, 'Expense not found');
    assertCreator(e.paidByUserId, user.userId);
    const settled = await tx.select({ n: sql<number>`count(*)::int` }).from(s.expenseShare).where(and(eq(s.expenseShare.expenseId, expenseId), sql`${s.expenseShare.settledByPaymentId} is not null`));
    if ((settled[0]?.n ?? 0) > 0) throw new HttpError(409, 'Someone already paid back part of this, so it can no longer be deleted');
    if (e.wishlistItemId != null) await tx.update(s.wishlistItem).set({ isBought: false }).where(eq(s.wishlistItem.wishlistItemId, e.wishlistItemId));
    // no dangling "Check it out" links
    await tx.delete(s.notification).where(and(eq(s.notification.householdId, householdId), eq(s.notification.sourceType, 'expense'), eq(s.notification.sourceId, expenseId)));
    await tx.delete(s.expense).where(eq(s.expense.expenseId, expenseId));
  });
}

// ---- paying back ------------------------------------------------------------------------------
export async function createPayment(user: CurrentUser, householdId: number, b: Record<string, unknown>) {
  const payeeUserId = id(b.payeeUserId, 'roommate');
  const paidWith = typeof b.paidWith === 'string' && (APPS as readonly string[]).includes(b.paidWith) ? (b.paidWith as (typeof APPS)[number]) : null;
  if (!paidWith) throw new HttpError(400, 'Pick Venmo, Zelle or Apple Cash');
  const ids = Array.isArray(b.expenseIds) ? [...new Set(b.expenseIds.map((x) => id(x, 'item')))] : [];
  if (!ids.length || ids.length > 50) throw new HttpError(400, 'Pick the items you are paying back');
  if (payeeUserId === user.userId) throw new HttpError(400, 'You cannot pay yourself');

  return db.transaction(async (tx) => {
    // the payee may have moved out (they are still owed), but must belong to this household
    const [pm] = await tx.select({ left: s.householdMember.leftDate }).from(s.householdMember).where(and(eq(s.householdMember.householdId, householdId), eq(s.householdMember.userId, payeeUserId)));
    if (!pm) throw new HttpError(400, 'That person is not in this household');
    // lock the caller's own shares: two taps cannot create two payments for the same item
    const rows = await tx.select({ expenseId: s.expenseShare.expenseId, amountOwed: s.expenseShare.amountOwed, settled: s.expenseShare.settledByPaymentId, itemName: s.expense.itemName })
      .from(s.expenseShare).innerJoin(s.expense, eq(s.expense.expenseId, s.expenseShare.expenseId))
      .where(and(eq(s.expenseShare.userId, user.userId), inArray(s.expenseShare.expenseId, ids), eq(s.expense.householdId, householdId), eq(s.expense.paidByUserId, payeeUserId)))
      .for('update', { of: s.expenseShare });
    if (rows.length !== ids.length) throw new HttpError(400, 'Some of those items are not yours to pay back to that person');
    if (rows.some((r) => r.settled != null)) throw new HttpError(400, 'One of those items is already paid or waiting for confirmation');
    // the amount is computed here, never taken from the request: it must equal the sum of the shares it settles
    const amount = sumCents(rows.map((r) => r.amountOwed));
    if (amount <= 0) throw new HttpError(400, 'Nothing to pay back');
    const [p] = await tx.insert(s.payment).values({ householdId, payerUserId: user.userId, payeeUserId, amount: fromCents(amount), paidWith, status: 'sent' }).returning();
    await tx.update(s.expenseShare).set({ settledByPaymentId: p!.paymentId }).where(and(eq(s.expenseShare.userId, user.userId), inArray(s.expenseShare.expenseId, ids)));
    if (!pm.left) { // roommates who moved out get no new notifications
      const me = await firstName(tx, user.userId);
      await tx.insert(s.notification).values({ userId: payeeUserId, householdId, actorUserId: user.userId, section: 'money', sourceType: 'payment', sourceId: p!.paymentId,
        message: `${me} says they paid you ${usd(amount)} via ${paidWith === 'apple_cash' ? 'Apple Cash' : paidWith[0]!.toUpperCase() + paidWith.slice(1)}. Did you get it?` });
    }
    return { paymentId: p!.paymentId, amount: fromCents(amount), status: 'sent' };
  });
}

/** Only the payee can confirm or dispute. sent -> confirmed | disputed, disputed -> confirmed. Confirmed is final. */
export async function reviewPayment(user: CurrentUser, householdId: number, paymentId: number, b: Record<string, unknown>) {
  const status = b.status === 'confirmed' || b.status === 'disputed' ? b.status : null;
  if (!status) throw new HttpError(400, 'Status must be confirmed or disputed');
  const from = status === 'confirmed' ? ['sent', 'disputed'] : ['sent'];
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.payment).where(and(eq(s.payment.paymentId, paymentId), eq(s.payment.householdId, householdId), eq(s.payment.payeeUserId, user.userId))).for('update');
    if (!p) throw new HttpError(404, 'Payment not found'); // also what the payer sees if they try to confirm their own payment
    if (!from.includes(p.status)) throw new HttpError(400, `This payment is already ${p.status}`);
    await tx.update(s.payment).set({ status }).where(eq(s.payment.paymentId, paymentId));
    const [payer] = await tx.select({ left: s.householdMember.leftDate }).from(s.householdMember).where(and(eq(s.householdMember.householdId, householdId), eq(s.householdMember.userId, p.payerUserId)));
    if (payer && !payer.left) {
      const me = await firstName(tx, user.userId); const amt = usd(toCents(p.amount));
      await tx.insert(s.notification).values({ userId: p.payerUserId, householdId, actorUserId: user.userId, section: 'money', sourceType: 'payment', sourceId: paymentId,
        message: status === 'confirmed' ? `${me} confirmed your payment of ${amt}. You're all set.` : `${me} says they did not get your payment of ${amt}. Check with them.` });
    }
    return { paymentId, status };
  });
}

// ---- wish list --------------------------------------------------------------------------------
const wishRow = (w: typeof s.wishlistItem.$inferSelect, viewerId: number) => ({
  wishlistItemId: w.wishlistItemId, itemName: w.itemName, needOrWant: w.needOrWant, estimatedPrice: w.estimatedPrice, itemLink: w.itemLink, description: w.description,
  isBought: w.isBought, createdByUserId: w.createdByUserId, canEdit: w.createdByUserId === viewerId,
});
export async function listWishlist(householdId: number, viewerId: number) {
  const rows = await db.select().from(s.wishlistItem).where(eq(s.wishlistItem.householdId, householdId)).orderBy(asc(s.wishlistItem.isBought), desc(s.wishlistItem.createdAt));
  return { items: rows.map((w) => wishRow(w, viewerId)) };
}
function wishFields(b: Record<string, unknown>, partial: boolean) {
  const out: Partial<typeof s.wishlistItem.$inferInsert> = {};
  if (!partial || b.itemName !== undefined) out.itemName = str(b.itemName, 1, 120, 'Item name');
  if (!partial || b.needOrWant !== undefined) { if (b.needOrWant !== 'need' && b.needOrWant !== 'want') throw new HttpError(400, 'Choose need or want'); out.needOrWant = b.needOrWant; }
  if (b.estimatedPrice !== undefined) out.estimatedPrice = b.estimatedPrice === null || b.estimatedPrice === '' ? null : fromCents(moneyOf(b.estimatedPrice, 'Price', { allowZero: true }));
  if (b.itemLink !== undefined) out.itemLink = webUrl(b.itemLink);
  if (b.description !== undefined) out.description = optStr(b.description, 500, 'Description');
  return out;
}
export async function createWishlistItem(user: CurrentUser, householdId: number, b: Record<string, unknown>) {
  const f = wishFields(b, false);
  return db.transaction(async (tx) => {
    const [w] = await tx.insert(s.wishlistItem).values({ ...(f as { itemName: string; needOrWant: string }), householdId, createdByUserId: user.userId, estimatedPrice: f.estimatedPrice ?? null, itemLink: f.itemLink ?? null, description: f.description ?? null }).returning();
    const me = await firstName(tx, user.userId);
    const others = (await activeIds(tx, householdId)).filter((u) => u !== user.userId);
    if (others.length) await tx.insert(s.notification).values(others.map((u) => ({ userId: u, householdId, actorUserId: user.userId, section: 'expense_tracker', sourceType: 'wishlist_item', sourceId: w!.wishlistItemId, message: `${me} added ${w!.itemName} to the wish list.` })));
    return wishRow(w!, user.userId);
  });
}
export async function updateWishlistItem(user: CurrentUser, householdId: number, itemId: number, b: Record<string, unknown>) {
  const f = wishFields(b, true);
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(s.wishlistItem).where(and(eq(s.wishlistItem.wishlistItemId, itemId), eq(s.wishlistItem.householdId, householdId))).for('update');
    if (!w) throw new HttpError(404, 'Wish list item not found');
    assertCreator(w.createdByUserId, user.userId);
    if (!Object.keys(f).length) return wishRow(w, user.userId);
    const [u] = await tx.update(s.wishlistItem).set(f).where(eq(s.wishlistItem.wishlistItemId, itemId)).returning();
    return wishRow(u!, user.userId);
  });
}
export async function deleteWishlistItem(user: CurrentUser, householdId: number, itemId: number) {
  await db.transaction(async (tx) => {
    const [w] = await tx.select().from(s.wishlistItem).where(and(eq(s.wishlistItem.wishlistItemId, itemId), eq(s.wishlistItem.householdId, householdId))).for('update');
    if (!w) throw new HttpError(404, 'Wish list item not found');
    assertCreator(w.createdByUserId, user.userId);
    await tx.delete(s.notification).where(and(eq(s.notification.householdId, householdId), eq(s.notification.sourceType, 'wishlist_item'), eq(s.notification.sourceId, itemId)));
    await tx.delete(s.wishlistItem).where(eq(s.wishlistItem.wishlistItemId, itemId));
  });
}

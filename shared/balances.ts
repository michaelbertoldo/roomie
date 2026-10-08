// Balances are ALWAYS calculated from expenses, shares and payments. They are never stored.
// This file is pure (no database, no I/O) so the money rules can be tested directly, and the
// browser and the API can share it.
//
// Rules (from CLAUDE.md):
//  - For each pair, owed = sum of one person's shares on expenses the OTHER person paid for
//    (the buyer's own share is never owed), minus CONFIRMED payments between them, netted in both directions.
//  - Only payment.status = 'confirmed' counts. 'sent' is pending, 'disputed' is disputed.
//  - A share is "paid back" only when settled_by_payment_id points to a CONFIRMED payment. No is_paid flag.
import { toCents } from './money.js';

export type PaymentStatus = 'sent' | 'confirmed' | 'disputed';
export type ShareRow = { expenseId: number; userId: number; paidByUserId: number; amountOwed: string | number; settledByPaymentId: number | null };
export type PaymentRow = { paymentId: number; payerUserId: number; payeeUserId: number; amount: string | number; status: PaymentStatus };

const cents = (v: string | number) => (typeof v === 'number' ? v : toCents(v));

export type ShareStatus = 'buyer' | 'unpaid' | 'pending' | 'paid' | 'disputed';

/** What the UI shows for one share. */
export function shareStatus(share: Pick<ShareRow, 'userId' | 'paidByUserId' | 'settledByPaymentId'>, payments: Map<number, Pick<PaymentRow, 'status'>>): ShareStatus {
  if (share.userId === share.paidByUserId) return 'buyer'; // the buyer's own share is never owed
  if (share.settledByPaymentId == null) return 'unpaid';
  const p = payments.get(share.settledByPaymentId);
  if (!p) return 'unpaid';
  return p.status === 'confirmed' ? 'paid' : p.status === 'sent' ? 'pending' : 'disputed';
}

export type PairBalance = {
  /** the person who owes */ debtorUserId: number;
  /** the person who is owed */ creditorUserId: number;
  /** net cents owed right now, always > 0 */ cents: number;
  /** cents debtor has already sent that the creditor has not confirmed yet */ pendingCents: number;
  /** cents tied up in a payment the creditor disputed */ disputedCents: number;
};

/** Net balance for every pair of people that currently owes anything. */
export function computeBalances(shares: ShareRow[], payments: PaymentRow[]): PairBalance[] {
  const key = (d: number, c: number) => `${d}>${c}`;
  const owed = new Map<string, number>();        // debtor>creditor : total of their shares on creditor's purchases
  const confirmed = new Map<string, number>();   // payer>payee     : confirmed payments
  const pending = new Map<string, number>();
  const disputed = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const s of shares) if (s.userId !== s.paidByUserId) add(owed, key(s.userId, s.paidByUserId), cents(s.amountOwed));
  for (const p of payments) {
    const k = key(p.payerUserId, p.payeeUserId);
    if (p.status === 'confirmed') add(confirmed, k, cents(p.amount));
    else if (p.status === 'sent') add(pending, k, cents(p.amount));
    else add(disputed, k, cents(p.amount));
  }

  const directed = (d: number, c: number) => (owed.get(key(d, c)) ?? 0) - (confirmed.get(key(d, c)) ?? 0);
  const people = new Set<number>();
  for (const k of [...owed.keys(), ...confirmed.keys()]) { const [a, b] = k.split('>').map(Number); people.add(a!); people.add(b!); }
  const ids = [...people].sort((a, b) => a - b);

  const out: PairBalance[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const x = ids[i]!, y = ids[j]!;
    const net = directed(x, y) - directed(y, x); // > 0: x owes y
    if (net === 0) continue;
    const [d, c] = net > 0 ? [x, y] : [y, x];
    out.push({ debtorUserId: d, creditorUserId: c, cents: Math.abs(net), pendingCents: pending.get(key(d, c)) ?? 0, disputedCents: disputed.get(key(d, c)) ?? 0 });
  }
  return out.sort((a, b) => b.cents - a.cents || a.debtorUserId - b.debtorUserId);
}

/** Convenience: what `userId` owes / is owed, per other person (signed: + they owe me, - I owe them). */
export function balancesFor(userId: number, pairs: PairBalance[]) {
  return pairs.filter((p) => p.debtorUserId === userId || p.creditorUserId === userId).map((p) => {
    const iOwe = p.debtorUserId === userId;
    return { otherUserId: iOwe ? p.creditorUserId : p.debtorUserId, signedCents: iOwe ? -p.cents : p.cents, pendingCents: p.pendingCents, disputedCents: p.disputedCents };
  });
}

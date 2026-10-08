import { describe, expect, it } from 'vitest';
import { balancesFor, computeBalances, shareStatus, type PaymentRow, type ShareRow } from '../shared/balances.js';
import { splitCents, fromCents, sumCents } from '../shared/money.js';

// people: 1 Alex, 2 Priya, 3 Jake, 4 Sam
const share = (expenseId: number, userId: number, paidBy: number, amount: string, settledBy: number | null = null): ShareRow => ({ expenseId, userId, paidByUserId: paidBy, amountOwed: amount, settledByPaymentId: settledBy });
const pay = (paymentId: number, payer: number, payee: number, amount: string, status: PaymentRow['status']): PaymentRow => ({ paymentId, payerUserId: payer, payeeUserId: payee, amount, status });

describe('computeBalances', () => {
  it('a buyer\'s own share is never owed and never appears', () => {
    expect(computeBalances([share(1, 1, 1, '22.51')], [])).toEqual([]);
  });

  it('one expense: each other person owes the buyer their share', () => {
    const r = computeBalances([share(1, 1, 1, '10.00'), share(1, 2, 1, '10.00'), share(1, 3, 1, '10.00')], []);
    expect(r.map((p) => [p.debtorUserId, p.creditorUserId, p.cents])).toEqual([[2, 1, 1000], [3, 1, 1000]]);
  });

  it('only a CONFIRMED payment reduces the balance; sent shows as pending, disputed as disputed', () => {
    const shares = [share(1, 3, 2, '20.00', 7)];
    const sent = computeBalances(shares, [pay(7, 3, 2, '20.00', 'sent')]);
    expect(sent).toEqual([{ debtorUserId: 3, creditorUserId: 2, cents: 2000, pendingCents: 2000, disputedCents: 0 }]);
    const disputed = computeBalances(shares, [pay(7, 3, 2, '20.00', 'disputed')]);
    expect(disputed[0]).toMatchObject({ cents: 2000, pendingCents: 0, disputedCents: 2000 });
    expect(computeBalances(shares, [pay(7, 3, 2, '20.00', 'confirmed')])).toEqual([]);
  });

  it('partial payment leaves the remainder', () => {
    const r = computeBalances([share(1, 2, 1, '30.00')], [pay(1, 2, 1, '12.50', 'confirmed')]);
    expect(r).toEqual([{ debtorUserId: 2, creditorUserId: 1, cents: 1750, pendingCents: 0, disputedCents: 0 }]);
  });

  it('nets BOTH directions: you owe me 30 on my purchase, I owe you 18 on yours -> you owe me 12', () => {
    const r = computeBalances([share(1, 2, 1, '30.00'), share(2, 1, 2, '18.00')], []);
    expect(r).toEqual([{ debtorUserId: 2, creditorUserId: 1, cents: 1200, pendingCents: 0, disputedCents: 0 }]);
  });

  it('netting can flip direction', () => {
    const r = computeBalances([share(1, 2, 1, '10.00'), share(2, 1, 2, '25.00')], []);
    expect(r).toEqual([{ debtorUserId: 1, creditorUserId: 2, cents: 1500, pendingCents: 0, disputedCents: 0 }]);
  });

  it('overpaying flips the balance (confirmed payment bigger than what was owed)', () => {
    const r = computeBalances([share(1, 2, 1, '10.00')], [pay(1, 2, 1, '15.00', 'confirmed')]);
    expect(r).toEqual([{ debtorUserId: 1, creditorUserId: 2, cents: 500, pendingCents: 0, disputedCents: 0 }]);
  });

  it('exact to the cent with no float drift: ten shares of 0.10 owe exactly 1.00', () => {
    const shares = Array.from({ length: 10 }, (_, i) => share(i + 1, 2, 1, '0.10'));
    expect(computeBalances(shares, [])[0]!.cents).toBe(100);
    expect(computeBalances(shares, [pay(1, 2, 1, '0.30', 'confirmed')])[0]!.cents).toBe(70);
  });

  it('reproduces the seed household: Jake and Sam each owe Priya 20.00, everyone else is square', () => {
    // E1 $90.01 paid by Alex among 4 (Alex 22.51 own); P,J,S settled by CONFIRMED payments 1,2,3
    // E2 $80.00 paid by Priya among 4; Alex confirmed (4), Jake sent (5), Sam unsettled
    const shares = [
      share(1, 1, 1, '22.51'), share(1, 2, 1, '22.50', 1), share(1, 3, 1, '22.50', 2), share(1, 4, 1, '22.50', 3),
      share(2, 2, 2, '20.00'), share(2, 1, 2, '20.00', 4), share(2, 3, 2, '20.00', 5), share(2, 4, 2, '20.00'),
    ];
    const payments = [pay(1, 2, 1, '22.50', 'confirmed'), pay(2, 3, 1, '22.50', 'confirmed'), pay(3, 4, 1, '22.50', 'confirmed'), pay(4, 1, 2, '20.00', 'confirmed'), pay(5, 3, 2, '20.00', 'sent')];
    const r = computeBalances(shares, payments);
    expect(r.map((p) => [p.debtorUserId, p.creditorUserId, p.cents, p.pendingCents]).sort()).toEqual([[3, 2, 2000, 2000], [4, 2, 2000, 0]]);
    expect(balancesFor(2, r).map((b) => [b.otherUserId, b.signedCents]).sort()).toEqual([[3, 2000], [4, 2000]]); // Priya is owed
    expect(balancesFor(1, r)).toEqual([]); // Alex owes nothing and is owed nothing
  });

  it('a person who joins later has no shares on old expenses, so they owe nothing and are owed nothing', () => {
    const old = [share(1, 1, 1, '10.00'), share(1, 2, 1, '10.00')]; // person 5 joined after this
    const r = computeBalances(old, []);
    expect(balancesFor(5, r)).toEqual([]);
  });

  it('moved-out roommates keep their balances', () => {
    const r = computeBalances([share(1, 4, 2, '20.00')], []); // Sam (4) moved out but still owes Priya
    expect(r[0]).toMatchObject({ debtorUserId: 4, creditorUserId: 2, cents: 2000 });
  });

  it('is order-independent and pure (same input, same output, input unchanged)', () => {
    const shares = [share(1, 2, 1, '7.77'), share(2, 3, 1, '1.01'), share(3, 1, 3, '2.02')];
    const payments = [pay(1, 2, 1, '3.00', 'confirmed')];
    const snapshot = JSON.stringify([shares, payments]);
    const a = computeBalances(shares, payments), b = computeBalances([...shares].reverse(), [...payments].reverse());
    expect(a).toEqual(b);
    expect(JSON.stringify([shares, payments])).toBe(snapshot);
  });
});

describe('shareStatus', () => {
  const payments = new Map<number, Pick<PaymentRow, 'status'>>([[1, { status: 'confirmed' }], [2, { status: 'sent' }], [3, { status: 'disputed' }]]);
  it('derives paid back / pending / disputed ONLY from the settling payment', () => {
    expect(shareStatus({ userId: 1, paidByUserId: 1, settledByPaymentId: null }, payments)).toBe('buyer');
    expect(shareStatus({ userId: 2, paidByUserId: 1, settledByPaymentId: null }, payments)).toBe('unpaid');
    expect(shareStatus({ userId: 2, paidByUserId: 1, settledByPaymentId: 1 }, payments)).toBe('paid');
    expect(shareStatus({ userId: 2, paidByUserId: 1, settledByPaymentId: 2 }, payments)).toBe('pending');
    expect(shareStatus({ userId: 2, paidByUserId: 1, settledByPaymentId: 3 }, payments)).toBe('disputed');
  });
  it('a buyer is never "paid" even if a payment is attached', () => {
    expect(shareStatus({ userId: 1, paidByUserId: 1, settledByPaymentId: 1 }, payments)).toBe('buyer');
  });
});

describe('splitting feeds balances exactly', () => {
  it('splitCents shares always sum to the total, so balances sum to what the buyer is owed', () => {
    for (const [total, n] of [[9001, 4], [1000, 3], [1, 3], [99999, 7]] as const) {
      const parts = splitCents(total, n);
      const shares = parts.map((c, i) => share(1, i + 1, 1, fromCents(c)));
      expect(sumCents(shares.map((s) => s.amountOwed))).toBe(total);
      const owedToBuyer = computeBalances(shares, []).reduce((a, p) => a + p.cents, 0);
      expect(owedToBuyer).toBe(total - parts[0]!); // everyone except the buyer's own (first, largest) share
    }
  });
});

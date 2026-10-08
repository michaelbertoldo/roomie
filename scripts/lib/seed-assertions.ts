// What a brand-new person must see after joining the seed household (code MAPLE412).
// Shared by `npm run test:seed` (local code) and `npm run test:preview` (deployed code).
// Needs the seed loaded: `npm run db:seed`.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Call = (path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; json: Json }>;
export type Check = (name: string, ok: boolean, detail?: string) => void;

export async function assertSeedAsFifthMember(call: Call, check: Check, meUserId: number) {
  const join = await call('/api/households/join', { method: 'POST', body: { joinCode: 'MAPLE412' } });
  check('joining MAPLE412 works for a new member', join.status === 200, `(status ${join.status}; is the seed loaded? npm run db:seed)`);
  const hid = join.json.householdId as number;
  const h = `/api/households/${hid}`;

  const members = (await call(`${h}/members`)).json.members as { userId: number; firstName: string; leftDate: string | null }[];
  const names = members.map((m) => m.firstName).sort().join(',');
  check('sees the whole roster: Alex, Priya, Jake current; Sam moved out; and themselves', members.length === 5 && members.filter((m) => !m.leftDate).length === 4 && members.find((m) => m.firstName === 'Sam')?.leftDate != null, names);
  const id = (n: string) => members.find((m) => m.firstName === n)!.userId;

  const chores = (await call(`${h}/chores`)).json.chores as unknown[];
  check('sees the household chores', chores.length === 3);

  const { expenses } = (await call(`${h}/expenses`)).json as { expenses: { itemName: string; totalAmount: string; shares: { userId: number; amountOwed: string; status: string }[] }[] };
  check('sees both past purchases', expenses.length === 2 && expenses.some((e) => e.itemName.startsWith('Costco')) && expenses.some((e) => e.itemName.startsWith('Internet')), JSON.stringify(expenses.map((e) => e.itemName)));
  const costco = expenses.find((e) => e.itemName.startsWith('Costco'))!, internet = expenses.find((e) => e.itemName.startsWith('Internet'))!;
  check('Costco ($90.01) is fully paid back: buyer + three shares paid by confirmed payments', costco.totalAmount === '90.01' && costco.shares.filter((s) => s.status === 'paid').length === 3 && costco.shares.filter((s) => s.status === 'buyer').length === 1, JSON.stringify(costco.shares.map((s) => s.status)));
  check('Internet ($80.00) is partly paid back: one paid, one pending (sent), one unpaid, plus the buyer', internet.totalAmount === '80.00' && ['paid', 'pending', 'unpaid', 'buyer'].every((st) => internet.shares.some((s) => s.status === st)), JSON.stringify(internet.shares.map((s) => s.status)));
  check('the new member has NO share on either expense (they were not there)', expenses.every((e) => e.shares.every((s) => s.userId !== meUserId)));

  const bal = (await call(`${h}/balances`)).json;
  check('the new member owes nothing and is owed nothing', bal.mine.length === 0, JSON.stringify(bal.mine));
  check('...and has nothing to pay back', bal.payable.length === 0 && bal.incoming.length === 0 && bal.outgoing.length === 0);
  const pairs = (bal.pairs as { debtorUserId: number; creditorUserId: number; amount: string; pendingAmount: string }[]).map((p) => `${p.debtorUserId}>${p.creditorUserId}:${p.amount}:${p.pendingAmount}`).sort();
  check('the household balances match the seed: Jake owes Priya $20.00 (pending), Sam owes Priya $20.00', pairs.join('|') === [`${id('Jake')}>${id('Priya')}:20.00:20.00`, `${id('Sam')}>${id('Priya')}:20.00:0.00`].sort().join('|'), pairs.join(' | '));

  const pay = await call(`${h}/payments`, { method: 'POST', body: { payeeUserId: id('Alex'), expenseIds: [(await call(`${h}/expenses`)).json.expenses[0].expenseId], paidWith: 'venmo' } });
  check('cannot "pay back" an expense they have no share in (400)', pay.status === 400, `(status ${pay.status})`);

  const wish = (await call(`${h}/wishlist`)).json.items as { itemName: string; canEdit: boolean }[];
  check('sees the 3 wish list items and can edit none of them', wish.length === 3 && wish.every((w) => !w.canEdit), JSON.stringify(wish.map((w) => w.itemName)));
  return { hid };
}

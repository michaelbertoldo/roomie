// Demo data: one household, 3 current roommates + 1 who moved out.
//   npm run db:seed        (re-runnable: it first removes its own previous data)
//
// It only ever touches rows it owns: the household with join code MAPLE412 and users whose
// email ends in @seed.roomie.test. Those users have no sign-in, so to look around, sign up
// normally and join the household with the code MAPLE412.
import { eq, like, sql } from 'drizzle-orm';
import { db, pool, schema as s } from '../api/_lib/db.js';
import { fromCents, splitCents, toCents } from '../api/_lib/money.js';

const TZ = 'America/Denver';
const JOIN_CODE = 'MAPLE412';
const EMAIL_DOMAIN = '@seed.roomie.test';

// ---- date helpers (all calendar math in the household's timezone) ----------------------------
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
const addDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const nextDow = (from: string, target: number) => addDays(from, (target - dow(from) + 7) % 7);
/** local wall-clock date + time in the household timezone -> timestamptz (DST-safe) */
const at = (date: string, time: string) => sql`((${date}::date + ${time}::time) AT TIME ZONE ${TZ})`;
const daysAgo = (n: number) => sql`now() - make_interval(days => ${n})`;
const hoursAgo = (n: number) => sql`now() - make_interval(hours => ${n})`;

async function main() {
  await db.transaction(async (tx) => {
    // ---- wipe our own previous seed ----------------------------------------------------------
    await tx.delete(s.household).where(eq(s.household.joinCode, JOIN_CODE)); // cascades to everything in it
    await tx.delete(s.users).where(like(s.users.email, `%${EMAIL_DOMAIN}`));

    // ---- people, household, membership -------------------------------------------------------
    const [alex, priya, jake, sam] = await tx.insert(s.users).values([
      { firstName: 'Alex', lastName: 'Rivera', email: `alex${EMAIL_DOMAIN}`, phoneNumber: '(801) 555-0141' },
      { firstName: 'Priya', lastName: 'Shah', email: `priya${EMAIL_DOMAIN}`, phoneNumber: '(801) 555-0188' },
      { firstName: 'Jake', lastName: 'Moreno', email: `jake${EMAIL_DOMAIN}`, phoneNumber: '(801) 555-0102' },
      { firstName: 'Sam', lastName: 'Okafor', email: `sam${EMAIL_DOMAIN}`, phoneNumber: '(801) 555-0177' },
    ]).returning();
    const [A, P, J, S] = [alex!.userId, priya!.userId, jake!.userId, sam!.userId];

    const [house] = await tx.insert(s.household).values({
      householdName: '412 Maple St', address: '412 Maple St, Provo, UT 84604', joinCode: JOIN_CODE, themeColor: '#4338ca', timezone: TZ,
    }).returning();
    const H = house!.householdId;

    await tx.insert(s.householdMember).values([
      { householdId: H, userId: A, role: 'owner', joinedDate: sql`${daysAgo(60)}` },
      { householdId: H, userId: P, role: 'member', joinedDate: sql`${daysAgo(55)}` },
      { householdId: H, userId: J, role: 'member', joinedDate: sql`${daysAgo(55)}` },
      // Sam moved out 3 days ago: history stays, but nothing new is ever assigned to Sam
      { householdId: H, userId: S, role: 'member', joinedDate: sql`${daysAgo(60)}`, leftDate: sql`${daysAgo(3)}` },
    ]);
    await tx.insert(s.paymentMethod).values([
      { userId: A, app: 'venmo', username: '@alex-rivera', isPreferred: true },
      { userId: P, app: 'venmo', username: '@priya-shah', isPreferred: true },
      { userId: P, app: 'apple_cash', username: '(801) 555-0188', isPreferred: false },
      { userId: J, app: 'zelle', username: 'jake.moreno@seed.roomie.test', isPreferred: true },
    ]);

    // ---- chores: the rule + generated occurrences ---------------------------------------------
    const [trash, bath, plants] = await tx.insert(s.chore).values([
      { householdId: H, createdByUserId: A, choreName: 'Take out trash', description: 'Kitchen and bathroom bins to the curb.', repeats: 'weekly', dayOfWeek: 1, dueTime: '19:00', effort: 'easy', startDate: addDays(today, -21) },
      { householdId: H, createdByUserId: P, choreName: 'Clean bathroom', description: 'Toilet, sink, shower, mirror, floor.', repeats: 'weekly', dayOfWeek: 6, dueTime: '10:00', effort: 'hard', startDate: addDays(today, -21) },
      { householdId: H, createdByUserId: A, choreName: 'Water the plants', description: 'Living room and balcony.', repeats: 'none', dueTime: '18:00', effort: 'easy', startDate: addDays(today, 2) },
    ]).returning();
    // trash rotates through the three CURRENT roommates (never Sam)
    await tx.insert(s.choreRotation).values([{ choreId: trash!.choreId, userId: A, turnOrder: 1 }, { choreId: trash!.choreId, userId: P, turnOrder: 2 }, { choreId: trash!.choreId, userId: J, turnOrder: 3 }]);

    const m0 = nextDow(today, 1), sat0 = nextDow(today, 6);
    const trashRows = [
      { due: addDays(m0, -14), who: S, done: 14 }, // history: Sam did it before moving out
      { due: addDays(m0, -7), who: A, done: 7 },
      { due: m0, who: P }, { due: addDays(m0, 7), who: J }, { due: addDays(m0, 14), who: A },
    ];
    const bathRows = [{ due: addDays(sat0, -7), who: J, done: 3 }, { due: sat0, who: J }, { due: addDays(sat0, 7), who: A }];
    const asg = await tx.insert(s.choreAssignment).values([
      ...trashRows.map((r) => ({ choreId: trash!.choreId, assignedUserId: r.who, dueAt: at(r.due, '19:00'),
        isCompleted: r.done !== undefined, completedAt: r.done !== undefined ? sql`${daysAgo(r.done)}` : null,
        // an upcoming occurrence that already got its one reminder (the job must not send another)
        lastRemindedAt: r.due === m0 ? sql`${hoursAgo(5)}` : null })),
      ...bathRows.map((r) => ({ choreId: bath!.choreId, assignedUserId: r.who, dueAt: at(r.due, '10:00'),
        isCompleted: r.done !== undefined, completedAt: r.done !== undefined ? sql`${daysAgo(r.done)}` : null })),
      { choreId: plants!.choreId, assignedUserId: J, dueAt: at(addDays(today, 2), '18:00'), isCompleted: false, completedAt: null },
    ]).returning();
    const trashM0 = asg.find((a) => a.choreId === trash!.choreId && a.assignedUserId === P)!; // Priya, coming Monday
    const bathSat0 = asg.find((a) => a.choreId === bath!.choreId && a.assignedUserId === J && !a.isCompleted)!; // Jake, this Saturday

    // one pending swap: Priya (away this weekend) offers her trash night for Jake's bathroom Saturday
    const [swap] = await tx.insert(s.choreSwapRequest).values({
      requesterAssignmentId: trashM0.assignmentId, targetAssignmentId: bathSat0.assignmentId, type: 'swap',
      requestMessage: 'Visiting family this weekend. Could we trade?', status: 'pending',
    }).returning();

    // ---- calendar ----------------------------------------------------------------------------
    const [game, meeting] = await tx.insert(s.event).values([
      { householdId: H, createdByUserId: J, eventName: 'Game night (hosting)', eventDate: at(addDays(today, 3), '19:00'), endDate: at(addDays(today, 3), '23:00'), location: 'Living room', category: 'hosting', color: '#7c3aed', reminderMinutesBefore: 60, description: 'Jake is hosting about 6 friends.' },
      { householdId: H, createdByUserId: A, eventName: 'House meeting', eventDate: at(nextDow(addDays(today, 1), 0), '18:00'), location: 'Kitchen', category: 'meeting', color: '#0d9488', reminderMinutesBefore: 30, description: 'Chore review and rent.' },
    ]).returning();
    await tx.insert(s.eventTag).values([
      { eventId: game!.eventId, userId: A, response: 'accepted', respondedDate: sql`${hoursAgo(2)}` },
      { eventId: game!.eventId, userId: P, response: 'pending' }, // the "is it OK if I host?" question, still unanswered
    ]);

    // ---- money -------------------------------------------------------------------------------
    const [paperTowels, , airFryer] = await tx.insert(s.wishlistItem).values([
      { householdId: H, createdByUserId: P, itemName: 'Paper towels (bulk)', needOrWant: 'need', estimatedPrice: '24.99', description: 'We are out.', isBought: true },
      { householdId: H, createdByUserId: J, itemName: 'Trash bags (13 gal)', needOrWant: 'need', estimatedPrice: '9.00', description: 'The kitchen can is the 13 gallon kind.' },
      { householdId: H, createdByUserId: A, itemName: 'Air fryer', needOrWant: 'want', estimatedPrice: '59.99', itemLink: 'https://example.com/air-fryer', description: 'Would replace using the oven for everything.' },
    ]).returning();
    void airFryer;
    const [, internetBill] = await tx.insert(s.recurringBill).values([
      { householdId: H, billName: 'Rent', billType: 'rent', amount: '1800.00', dueDayOfMonth: 1 },
      { householdId: H, billName: 'Internet', billType: 'utility', amount: '80.00', dueDayOfMonth: 15 },
    ]).returning();

    // Expense 1: fully paid back. $90.01 across 4 people; leftover cent goes to the FIRST share (the buyer).
    // Expense 2: partly paid back. $80.00 Internet bill bought by Priya.
    const [e1, e2] = await tx.insert(s.expense).values([
      { householdId: H, paidByUserId: A, wishlistItemId: paperTowels!.wishlistItemId, itemName: 'Costco run: paper towels, soap', totalAmount: '90.01', purchaseDate: addDays(today, -14) },
      { householdId: H, paidByUserId: P, billId: internetBill!.billId, itemName: 'Internet (this month)', totalAmount: '80.00', purchaseDate: addDays(today, -10) },
    ]).returning();

    // Payments first, so shares can point at them. Every payment equals the sum of the shares it settles.
    const pay = (payer: number, payee: number, amount: string, paidWith: 'venmo' | 'zelle' | 'apple_cash', status: 'sent' | 'confirmed' | 'disputed', daysBack: number) =>
      ({ householdId: H, payerUserId: payer, payeeUserId: payee, amount, paidWith, status, paidDate: sql`${daysAgo(daysBack)}` });
    const [pPriyaToAlex, pJakeToAlex, pSamToAlex, pAlexToPriya, pJakeToPriya] = await tx.insert(s.payment).values([
      pay(P, A, '22.50', 'venmo', 'confirmed', 12),
      pay(J, A, '22.50', 'zelle', 'confirmed', 11),
      pay(S, A, '22.50', 'venmo', 'confirmed', 9),
      pay(A, P, '20.00', 'apple_cash', 'confirmed', 6),
      pay(J, P, '20.00', 'venmo', 'sent', 1), // sent, not yet confirmed by Priya: shows as pending
    ]).returning();

    const split1 = splitCents(toCents(e1!.totalAmount), 4); // [2251, 2250, 2250, 2250]
    const split2 = splitCents(toCents(e2!.totalAmount), 4); // [2000 x4]
    await tx.insert(s.expenseShare).values([
      // e1: buyer's own share is never owed; the other three are settled by CONFIRMED payments
      { expenseId: e1!.expenseId, userId: A, amountOwed: fromCents(split1[0]!) },
      { expenseId: e1!.expenseId, userId: P, amountOwed: fromCents(split1[1]!), settledByPaymentId: pPriyaToAlex!.paymentId },
      { expenseId: e1!.expenseId, userId: J, amountOwed: fromCents(split1[2]!), settledByPaymentId: pJakeToAlex!.paymentId },
      { expenseId: e1!.expenseId, userId: S, amountOwed: fromCents(split1[3]!), settledByPaymentId: pSamToAlex!.paymentId },
      // e2: Alex confirmed, Jake pending (payment 'sent'), Sam (moved out) still owes: his history stays visible
      { expenseId: e2!.expenseId, userId: P, amountOwed: fromCents(split2[0]!) },
      { expenseId: e2!.expenseId, userId: A, amountOwed: fromCents(split2[1]!), settledByPaymentId: pAlexToPriya!.paymentId },
      { expenseId: e2!.expenseId, userId: J, amountOwed: fromCents(split2[2]!), settledByPaymentId: pJakeToPriya!.paymentId },
      { expenseId: e2!.expenseId, userId: S, amountOwed: fromCents(split2[3]!) },
    ]);

    // ---- communication board -----------------------------------------------------------------
    const [note1, , note3] = await tx.insert(s.bulletinMessage).values([
      { householdId: H, senderUserId: A, eventId: meeting!.eventId, messageText: 'House meeting Sunday at 6. Please add anything for the agenda.', isPinned: true, postedDate: sql`${daysAgo(2)}` },
      { householdId: H, senderUserId: J, eventId: game!.eventId, messageText: 'Thinking game night Friday with ~6 friends. Anyone have a problem with that?', postedDate: sql`${hoursAgo(20)}` },
      { householdId: H, senderUserId: P, messageText: 'Anyone want to split a pizza tonight?', postedDate: sql`${hoursAgo(6)}` },
    ]).returning();
    const [reply] = await tx.insert(s.bulletinMessage).values({
      householdId: H, senderUserId: P, parentMessageId: note1!.messageId, messageText: 'I can bring snacks!', postedDate: sql`${hoursAgo(3)}`,
    }).returning();
    void note3;

    // ---- notifications: at least one in each of the five sections. Never to Sam. -------------
    await tx.insert(s.notification).values([
      { userId: J, householdId: H, actorUserId: P, section: 'chores', sourceType: 'chore_swap_request', sourceId: swap!.swapId, message: 'Priya asked to swap Take out trash for your Clean bathroom.', createdAt: sql`${hoursAgo(2)}` },
      { userId: P, householdId: H, actorUserId: J, section: 'money', sourceType: 'payment', sourceId: pJakeToPriya!.paymentId, message: 'Jake says they paid you $20.00 for Internet. Did you get it?', createdAt: sql`${hoursAgo(24)}` },
      { userId: A, householdId: H, actorUserId: P, section: 'expense_tracker', sourceType: 'expense', sourceId: e2!.expenseId, message: 'Priya added Internet (this month): you owe $20.00.', isRead: true, createdAt: sql`${daysAgo(10)}` },
      { userId: J, householdId: H, actorUserId: P, section: 'expense_tracker', sourceType: 'expense', sourceId: e2!.expenseId, message: 'Priya added Internet (this month): you owe $20.00.', createdAt: sql`${daysAgo(10)}` },
      { userId: P, householdId: H, actorUserId: null, section: 'system', sourceType: 'chore_assignment', sourceId: trashM0.assignmentId, message: 'Reminder: Take out trash is due Monday at 7:00 PM.', createdAt: sql`${hoursAgo(5)}` },
      { userId: A, householdId: H, actorUserId: P, section: 'calendar_board', sourceType: 'bulletin_message', sourceId: reply!.messageId, message: 'Priya replied to your House meeting note.', createdAt: sql`${hoursAgo(3)}` },
      { userId: P, householdId: H, actorUserId: J, section: 'calendar_board', sourceType: 'event', sourceId: game!.eventId, message: 'Jake is hosting Game night. Is that okay with you?', createdAt: sql`${hoursAgo(20)}` },
    ]);
  });

  const count = async (t: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
  console.log(`seeded household ${JOIN_CODE}:`);
  for (const t of ['users', 'household_member', 'chore', 'chore_assignment', 'chore_swap_request', 'event', 'event_tag', 'wishlist_item', 'expense', 'expense_share', 'payment', 'bulletin_message', 'notification'])
    console.log(`  ${t.padEnd(20)} ${await count(t)}`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

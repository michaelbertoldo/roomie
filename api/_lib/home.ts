// The snapshot is built from the database (never from the request), scoped to one household the caller
// belongs to, and contains first names and short item text only: no emails, phone numbers or ids.
import type { CurrentUser } from './auth.js';
import { db, schema as s } from './db.js';
import { and, eq, isNull } from 'drizzle-orm';
import { callText } from './ai.js';
import { listBoard, listEvents } from './calendar.js';
import { listChores } from './chores.js';
import { getBalances } from './finance.js';
import { listNotifications } from './notifications.js';
import { householdTz } from './validate.js';
import { capSentences, cleanAiText } from '../../shared/ai.js';
import { buildAiPrompt, buildRecapPrompt, type HomeSnapshot } from '../../shared/home-ai.js';
import { addDays } from '../../shared/chore-dates.js';

export async function homeSnapshot(householdId: number, viewerId: number): Promise<HomeSnapshot> {
  const tz = await householdTz(db, householdId);
  const nowD = new Date();
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const today = dayOf(nowD.toISOString()), last = addDays(today, 6), weekAgo = addDays(today, -7);

  const members = await db.select({ userId: s.householdMember.userId, firstName: s.users.firstName }).from(s.householdMember)
    .innerJoin(s.users, eq(s.users.userId, s.householdMember.userId)).where(and(eq(s.householdMember.householdId, householdId), isNull(s.householdMember.leftDate)));
  const name = (id: number) => (id === viewerId ? 'You' : members.find((m) => m.userId === id)?.firstName ?? 'A roommate');
  const [{ events }, chores, bal, { notes }, inbox, [h]] = await Promise.all([
    listEvents(householdId, viewerId), listChores(householdId, viewerId), getBalances(householdId, viewerId), listBoard(householdId, viewerId), listNotifications(viewerId),
    db.select({ n: s.household.householdName }).from(s.household).where(eq(s.household.householdId, householdId)),
  ]);
  const mine = chores.assignments.filter((a) => a.assignedUserId === viewerId && !a.isCompleted);
  const choreName = (id: number) => chores.chores.find((c) => c.choreId === id)?.choreName ?? 'A chore';
  const here = inbox.notifications.filter((n) => n.householdId === householdId && n.canRespond && !n.isRead);
  const answers = (e: (typeof events)[number]) => (e.category === 'hosting' && e.tags.length ? `${e.tags.filter((t) => t.response === 'accepted').length} okay, ${e.tags.filter((t) => t.response === 'pending').length} waiting, ${e.tags.filter((t) => t.response === 'declined').length} said no` : undefined);
  return {
    now: when(nowD.toISOString()), household: h?.n ?? 'the house', me: members.find((m) => m.userId === viewerId)?.firstName ?? 'You',
    events: events.filter((e) => dayOf(e.eventDate) >= today && dayOf(e.eventDate) <= last).slice(0, 8).map((e) => ({ name: e.eventName, when: when(e.eventDate), category: e.category, hostingAnswers: answers(e) })),
    myChores: mine.filter((a) => dayOf(a.dueAt) <= last).slice(0, 8).map((a) => ({ name: choreName(a.choreId), when: when(a.dueAt), overdue: Date.parse(a.dueAt) < nowD.getTime() })),
    overdueCount: mine.filter((a) => Date.parse(a.dueAt) < nowD.getTime()).length,
    money: {
      iOwe: bal.mine.filter((m) => Number(m.signedAmount) < 0).map((m) => ({ who: name(m.otherUserId), amount: `$${Math.abs(Number(m.signedAmount)).toFixed(2)}` })),
      owedToMe: bal.mine.filter((m) => Number(m.signedAmount) > 0).map((m) => ({ who: name(m.otherUserId), amount: `$${Number(m.signedAmount).toFixed(2)}` })),
    },
    waitingOnMe: { swapRequests: here.filter((n) => n.sourceType === 'chore_swap_request').length, hostingChecks: here.filter((n) => n.sourceType === 'event' && n.sourceStatus === 'pending').length, payments: here.filter((n) => n.sourceType === 'payment').length },
    lastWeek: {
      choresDone: chores.assignments.filter((a) => a.assignedUserId === viewerId && a.isCompleted && a.completedAt && dayOf(a.completedAt) >= weekAgo).length,
      choresMissed: chores.assignments.filter((a) => a.assignedUserId === viewerId && !a.isCompleted && dayOf(a.dueAt) >= weekAgo && dayOf(a.dueAt) < today).length,
      events: events.filter((e) => dayOf(e.eventDate) >= weekAgo && dayOf(e.eventDate) < today).slice(0, 5).map((e) => e.eventName),
    },
    board: notes.slice(0, 3).map((n) => `${name(n.senderUserId ?? 0)}: ${n.messageText}`),
  };
}

/** `{ enabled: false }` unless the flag and key are both set. Never throws on a model or network failure. */
export async function homeSummary(user: CurrentUser, householdId: number) {
  const result = await callText({
    feature: 'home',
    userId: user.userId,
    householdId,
    prompt: async () => buildAiPrompt(await homeSnapshot(householdId, user.userId)),
  });
  if (result.status === 'disabled') return { enabled: false as const };
  if (result.status === 'limited') return { enabled: true as const, text: null, limited: true };
  return { enabled: true as const, text: result.status === 'ok' ? cleanAiText(result.value) : null };
}

/** Personal two-sentence weekly recap for the caller. Same limits and failure behavior as homeSummary, hard-capped to 2 sentences. */
export async function weeklyRecap(user: CurrentUser, householdId: number) {
  const result = await callText({
    feature: 'recap',
    userId: user.userId,
    householdId,
    prompt: async () => buildRecapPrompt(await homeSnapshot(householdId, user.userId)),
  });
  if (result.status === 'disabled') return { enabled: false as const };
  if (result.status === 'limited') return { enabled: true as const, text: null, limited: true };
  return { enabled: true as const, text: result.status === 'ok' ? capSentences(result.value) : null };
}

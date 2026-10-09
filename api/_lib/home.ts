// Slice (e): the optional AI line on the Home page. OFF by default: it needs HOME_AI_ENABLED=1 AND an
// ANTHROPIC_API_KEY on the server. The snapshot is built here from the database (never from the request),
// scoped to ONE household the caller belongs to, and contains first names and short item text only: no
// emails, phone numbers or ids. It is sent to Anthropic's API, which is why the flag exists.
import type { CurrentUser } from './auth.js';
import { db, schema as s } from './db.js';
import { and, eq, isNull } from 'drizzle-orm';
import { listBoard, listEvents } from './calendar.js';
import { listChores } from './chores.js';
import { getBalances } from './finance.js';
import { listNotifications } from './notifications.js';
import { householdTz } from './validate.js';
import { buildAiPrompt, cleanAiText, type HomeSnapshot } from '../../shared/home.js';
import { addDays } from '../../shared/chore-dates.js';

export const aiEnabled = () => process.env.HOME_AI_ENABLED === '1' && !!process.env.ANTHROPIC_API_KEY;

type CallModel = (system: string, user: string) => Promise<string | null>;
export const anthropicCall: CallModel = async (system, user) => {
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, { // the override is for local testing against a mock
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.HOME_AI_MODEL || 'claude-haiku-5-5', max_tokens: 120, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { content?: { type: string; text?: string }[] };
  return j.content?.find((c) => c.type === 'text')?.text ?? null;
};

// a few calls per person per hour is plenty (the page asks once per sign-in); in memory, best effort
const calls = new Map<number, number[]>();
const withinLimit = (userId: number) => {
  const now = Date.now(), recent = (calls.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 6) { calls.set(userId, recent); return false; }
  calls.set(userId, [...recent, now]); return true;
};

export async function homeSnapshot(householdId: number, viewerId: number): Promise<HomeSnapshot> {
  const tz = await householdTz(db, householdId);
  const nowD = new Date();
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const today = dayOf(nowD.toISOString()), last = addDays(today, 6);

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
    board: notes.slice(0, 3).map((n) => `${name(n.senderUserId ?? 0)}: ${n.messageText}`),
  };
}

/** `{ enabled: false }` unless the flag and key are both set. Never throws on a model or network failure. */
export async function homeSummary(user: CurrentUser, householdId: number, callModel: CallModel = anthropicCall) {
  if (!aiEnabled()) return { enabled: false as const };
  if (!withinLimit(user.userId)) return { enabled: true as const, text: null, limited: true };
  try {
    const { system, user: prompt } = buildAiPrompt(await homeSnapshot(householdId, user.userId));
    return { enabled: true as const, text: cleanAiText(await callModel(system, prompt)) };
  } catch (e) {
    console.error('home summary failed', e instanceof Error ? e.message : e);
    return { enabled: true as const, text: null };
  }
}

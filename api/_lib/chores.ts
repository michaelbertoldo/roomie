// Slice (b): chores. A chore ROW is the rule; chore_assignment ROWS are generated occurrences (created
// when the chore is added and then by the daily cron, a few weeks ahead). Rules from CLAUDE.md:
//  - due_at is built from the chore's day and time in household.timezone (Postgres does the DST-safe
//    conversion). unique (chore_id, due_at) makes generation safe to re-run.
//  - respect last_reminded_at so reminders never spam.
//  - accept/decline lives on chore_swap_request; notifications only point at it (source_type + source_id).
//  - notifications are inserted in the same transaction as the action. Roommates who moved out never
//    receive new chores, swaps, tags or notifications.
import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema as s, type Tx } from './db.js';
import type { CurrentUser } from './auth.js';
import { HttpError, id } from './http.js';
import { assertActiveMembers, assertCreator } from './household.js';
import { activeIds, firstName, householdTz, optStr, str, todayIn } from './validate.js';
import { addDays, describeSchedule, nextInRotation, occurrenceDates } from '../../shared/chore-dates.js';

const HORIZON_DAYS = 28;
const EFFORTS = ['easy', 'medium', 'hard'] as const;
const REMIND_AUTO_GAP = '20 hours';
const REMIND_MANUAL_GAP_MS = 12 * 3600_000;
type Chore = typeof s.chore.$inferSelect;
type Ex = Tx | typeof db;

const timeOf = (v: unknown): string => { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, 'Time must look like 19:00'); return v; };
const ymdOf = (v: unknown, label: string): string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) throw new HttpError(400, `${label} must look like 2026-10-31`);
  if (v < '2000-01-01' || v > '2100-01-01') throw new HttpError(400, `${label} is out of range`);
  return v;
};
const whenText = (iso: string, tz: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '').replace(/(\d), /, '$1 at ');
const iso = (v: string) => new Date(v).toISOString();

// ---- generation -------------------------------------------------------------------------------
/** Create the missing occurrences of one recurring chore for the next few weeks. Safe to run any number of times. */
export async function generateForChore(tx: Tx, chore: Chore, tz: string, opts: { horizonDays?: number; asOf?: { today: string; nowIso: string } } = {}): Promise<number> {
  if (chore.repeats === 'none' || !chore.dueTime) return 0;
  const today = opts.asOf?.today ?? todayIn(tz);
  const nowMs = Date.parse(opts.asOf?.nowIso ?? new Date().toISOString());
  const dates = occurrenceDates({ repeats: chore.repeats as 'weekly' | 'monthly', startDate: chore.startDate, dayOfWeek: chore.dayOfWeek, dayOfMonth: chore.dayOfMonth }, today, addDays(today, opts.horizonDays ?? HORIZON_DAYS));
  if (!dates.length) return 0;

  // only CURRENT roommates are in the rotation, in turn order
  const rot = await tx.select({ userId: s.choreRotation.userId }).from(s.choreRotation)
    .innerJoin(s.householdMember, and(eq(s.householdMember.userId, s.choreRotation.userId), eq(s.householdMember.householdId, chore.householdId), isNull(s.householdMember.leftDate)))
    .where(eq(s.choreRotation.choreId, chore.choreId)).orderBy(asc(s.choreRotation.turnOrder));
  const rotation = rot.map((r) => r.userId);
  if (!rotation.length) return 0;

  // local wall-clock date + time -> real instant, with DST handled by Postgres
  const times = await tx.execute(sql`SELECT t.d AS d, to_char(((t.d::date + ${chore.dueTime}::time) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS due FROM jsonb_array_elements_text(${JSON.stringify(dates)}::jsonb) AS t(d) ORDER BY t.d`);
  const existing = await tx.select({ user: s.choreAssignment.assignedUserId, due: s.choreAssignment.dueAt }).from(s.choreAssignment).where(eq(s.choreAssignment.choreId, chore.choreId));
  const seq = existing.map((e) => ({ t: Date.parse(iso(e.due)), user: e.user })).sort((a, b) => a.t - b.t);
  const have = new Set(seq.map((e) => e.t));

  const toInsert: { choreId: number; assignedUserId: number; dueAt: string }[] = [];
  for (const row of times.rows as { due: string }[]) {
    const t = Date.parse(row.due);
    if (t <= nowMs || have.has(t)) continue;
    const prev = [...seq].reverse().find((e) => e.t < t);
    const user = nextInRotation(rotation, prev?.user ?? null);
    if (user == null) continue;
    seq.push({ t, user }); seq.sort((a, b) => a.t - b.t); have.add(t);
    toInsert.push({ choreId: chore.choreId, assignedUserId: user, dueAt: row.due });
  }
  if (toInsert.length) await tx.insert(s.choreAssignment).values(toInsert).onConflictDoNothing();
  return toInsert.length;
}

/** The daily job: top up every recurring chore (optionally one household). */
export async function generateAll(opts: { householdId?: number; horizonDays?: number; asOf?: { today: string; nowIso: string } } = {}) {
  const rows = await db.select({ chore: s.chore, tz: s.household.timezone }).from(s.chore).innerJoin(s.household, eq(s.household.householdId, s.chore.householdId))
    .where(and(sql`${s.chore.repeats} <> 'none'`, opts.householdId ? eq(s.chore.householdId, opts.householdId) : undefined));
  let created = 0;
  for (const r of rows) created += await db.transaction((tx) => generateForChore(tx, r.chore, r.tz, opts));
  return { chores: rows.length, created };
}

// ---- reminders --------------------------------------------------------------------------------
/** Remind assignees about chores due in the next 24 hours. last_reminded_at guarantees at most one reminder per ~20 hours per occurrence. */
export async function sendDueReminders(opts: { nowIso?: string } = {}) {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  return db.transaction(async (tx) => {
    const due = await tx.execute(sql`
      SELECT a.assignment_id, a.assigned_user_id, c.chore_name, c.household_id, h.timezone, to_char(a.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS due
      FROM chore_assignment a
      JOIN chore c ON c.chore_id = a.chore_id
      JOIN household h ON h.household_id = c.household_id
      JOIN household_member m ON m.household_id = c.household_id AND m.user_id = a.assigned_user_id AND m.left_date IS NULL
      WHERE NOT a.is_completed AND a.due_at > ${nowIso}::timestamptz AND a.due_at <= ${nowIso}::timestamptz + interval '24 hours'
        AND (a.last_reminded_at IS NULL OR a.last_reminded_at < ${nowIso}::timestamptz - ${REMIND_AUTO_GAP}::interval)
      ORDER BY a.assignment_id
      FOR UPDATE OF a SKIP LOCKED`);
    const rows = due.rows as { assignment_id: string; assigned_user_id: string; chore_name: string; household_id: string; timezone: string; due: string }[];
    for (const r of rows) {
      await tx.update(s.choreAssignment).set({ lastRemindedAt: nowIso }).where(eq(s.choreAssignment.assignmentId, Number(r.assignment_id)));
      await tx.insert(s.notification).values({ userId: Number(r.assigned_user_id), householdId: Number(r.household_id), actorUserId: null, section: 'system', sourceType: 'chore_assignment', sourceId: Number(r.assignment_id),
        message: `Reminder: ${r.chore_name} is due ${whenText(r.due, r.timezone)}.` });
    }
    return { reminded: rows.length };
  });
}

/** A roommate nudges someone about a chore. Shares the throttle with the automatic reminder. */
export async function remindAssignee(user: CurrentUser, householdId: number, assignmentId: number) {
  return db.transaction(async (tx) => {
    const a = await lockAssignment(tx, householdId, assignmentId);
    if (a.assignedUserId === user.userId) throw new HttpError(400, 'That one is yours, so there is nobody to remind');
    if (a.isCompleted) throw new HttpError(400, 'That chore is already done');
    const active = await activeIds(tx, householdId);
    if (!active.includes(a.assignedUserId)) throw new HttpError(400, 'They no longer live here');
    if (a.lastRemindedAt && Date.now() - Date.parse(iso(a.lastRemindedAt)) < REMIND_MANUAL_GAP_MS) throw new HttpError(429, 'They were reminded recently. Give it a few hours.');
    await tx.update(s.choreAssignment).set({ lastRemindedAt: new Date().toISOString() }).where(eq(s.choreAssignment.assignmentId, assignmentId));
    const tz = await householdTz(tx, householdId); const me = await firstName(tx, user.userId);
    await tx.insert(s.notification).values({ userId: a.assignedUserId, householdId, actorUserId: user.userId, section: 'chores', sourceType: 'chore_assignment', sourceId: assignmentId,
      message: `${me} reminded you: ${a.choreName} is due ${whenText(iso(a.dueAt), tz)}.` });
    return { ok: true };
  });
}

// ---- reading ----------------------------------------------------------------------------------
export async function listChores(householdId: number, viewerId: number) {
  const chores = await db.select().from(s.chore).where(eq(s.chore.householdId, householdId)).orderBy(asc(s.chore.choreId));
  const ids = chores.map((c) => c.choreId);
  const rotation = ids.length ? await db.select().from(s.choreRotation).where(inArray(s.choreRotation.choreId, ids)).orderBy(asc(s.choreRotation.turnOrder)) : [];
  const assignments = ids.length ? await db.select().from(s.choreAssignment)
    .where(and(inArray(s.choreAssignment.choreId, ids), or(eq(s.choreAssignment.isCompleted, false), gte(s.choreAssignment.dueAt, sql`now() - interval '30 days'`)))).orderBy(asc(s.choreAssignment.dueAt)).limit(600) : [];
  const now = Date.now();

  // only OPEN requests: they are the actionable ones; results reach people as notifications
  const requests = assignments.length ? await db.execute(sql`
    SELECT r.swap_id, r.type, r.requester_assignment_id, r.target_assignment_id, r.request_message, r.requested_date, ra.assigned_user_id AS requester_user_id, ta.assigned_user_id AS target_user_id
    FROM chore_swap_request r
    JOIN chore_assignment ra ON ra.assignment_id = r.requester_assignment_id
    JOIN chore rc ON rc.chore_id = ra.chore_id
    LEFT JOIN chore_assignment ta ON ta.assignment_id = r.target_assignment_id
    WHERE rc.household_id = ${householdId} AND r.status = 'pending' ORDER BY r.swap_id`) : { rows: [] };

  return {
    chores: chores.map((c) => ({
      choreId: c.choreId, choreName: c.choreName, description: c.description, repeats: c.repeats, dayOfWeek: c.dayOfWeek, dayOfMonth: c.dayOfMonth, startDate: c.startDate, dueTime: c.dueTime,
      effort: c.effort, createdByUserId: c.createdByUserId, createdAt: c.createdAt, canEdit: c.createdByUserId === viewerId,
      schedule: describeSchedule(c), rotation: rotation.filter((r) => r.choreId === c.choreId).map((r) => r.userId),
    })),
    assignments: assignments.map((a) => ({
      assignmentId: a.assignmentId, choreId: a.choreId, assignedUserId: a.assignedUserId, dueAt: iso(a.dueAt), isCompleted: a.isCompleted, completedAt: a.completedAt ? iso(a.completedAt) : null,
      lastRemindedAt: a.lastRemindedAt ? iso(a.lastRemindedAt) : null, status: a.isCompleted ? 'done' : Date.parse(iso(a.dueAt)) < now ? 'overdue' : 'upcoming',
    })),
    swapRequests: (requests.rows as Record<string, string | null>[]).map((r) => ({
      swapId: Number(r.swap_id), type: r.type, requesterAssignmentId: Number(r.requester_assignment_id), targetAssignmentId: r.target_assignment_id ? Number(r.target_assignment_id) : null,
      requestMessage: r.request_message, requestedDate: r.requested_date ? iso(r.requested_date) : null, requesterUserId: Number(r.requester_user_id), targetUserId: r.target_user_id ? Number(r.target_user_id) : null,
    })),
    horizonDays: HORIZON_DAYS,
  };
}

// ---- create / edit / delete -------------------------------------------------------------------
export async function createChore(user: CurrentUser, householdId: number, b: Record<string, unknown>) {
  const choreName = str(b.choreName, 1, 120, 'Chore name');
  const description = optStr(b.description, 500, 'Description');
  const effort = b.effort === undefined ? 'medium' : (EFFORTS as readonly string[]).includes(b.effort as string) ? (b.effort as (typeof EFFORTS)[number]) : (() => { throw new HttpError(400, 'Effort must be easy, medium or hard'); })();
  const repeats = b.repeats === 'none' || b.repeats === 'weekly' || b.repeats === 'monthly' ? b.repeats : (() => { throw new HttpError(400, 'Choose one time, weekly or monthly'); })();
  const dueTime = timeOf(b.dueTime);
  const tz = await householdTz(db, householdId);
  let dayOfWeek: number | null = null, dayOfMonth: number | null = null, startDate = todayIn(tz);
  if (repeats === 'none') startDate = ymdOf(b.date, 'Date');
  if (repeats === 'weekly') { dayOfWeek = Number(b.dayOfWeek); if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new HttpError(400, 'Pick a day of the week'); if (b.date) startDate = ymdOf(b.date, 'Start date'); }
  if (repeats === 'monthly') { dayOfMonth = Number(b.dayOfMonth); if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) throw new HttpError(400, 'Pick a day of the month (1 to 31)'); if (b.date) startDate = ymdOf(b.date, 'Start date'); }

  const a = (b.assignment ?? {}) as { mode?: string; userId?: unknown; userIds?: unknown };
  let rotationIds: number[];
  if (a.mode === 'person') rotationIds = [id(a.userId, 'roommate')];
  else if (a.mode === 'rotate') { rotationIds = Array.isArray(a.userIds) ? [...new Set(a.userIds.map((x) => id(x, 'roommate')))] : []; if (rotationIds.length < 2) throw new HttpError(400, 'Pick at least two roommates to take turns'); }
  else throw new HttpError(400, 'Pick who does it, or choose to take turns');
  if (rotationIds.length > 9) throw new HttpError(400, 'Too many roommates');
  if (repeats === 'none' && rotationIds.length !== 1) throw new HttpError(400, 'A one-time chore goes to one person');

  return db.transaction(async (tx) => {
    await assertActiveMembers(tx, householdId, rotationIds); // new chores only ever go to current roommates
    if (repeats === 'none') {
      const ok = await tx.execute(sql`SELECT ((${startDate}::date + ${dueTime}::time) AT TIME ZONE ${tz}) > now() AS ok`);
      if (!(ok.rows[0] as { ok: boolean }).ok) throw new HttpError(400, 'That date and time has already passed');
    }
    const [chore] = await tx.insert(s.chore).values({ householdId, createdByUserId: user.userId, choreName, description, repeats, startDate, dayOfWeek, dayOfMonth, dueTime, effort }).returning();
    if (repeats === 'none') {
      await tx.insert(s.choreAssignment).values({ choreId: chore!.choreId, assignedUserId: rotationIds[0]!, dueAt: sql`((${startDate}::date + ${dueTime}::time) AT TIME ZONE ${tz})` });
    } else {
      // a fixed assignee is a rotation of one
      await tx.insert(s.choreRotation).values(rotationIds.map((u, i) => ({ choreId: chore!.choreId, userId: u, turnOrder: i + 1 })));
      await generateForChore(tx, chore!, tz);
    }
    const made = await tx.select().from(s.choreAssignment).where(eq(s.choreAssignment.choreId, chore!.choreId)).orderBy(asc(s.choreAssignment.dueAt));
    const me = await firstName(tx, user.userId);
    const firstFor = new Map<number, string>();
    for (const m of made) if (!firstFor.has(m.assignedUserId)) firstFor.set(m.assignedUserId, iso(m.dueAt));
    const notes = [...firstFor].filter(([u]) => u !== user.userId).map(([u, when]) => ({ userId: u, householdId, actorUserId: user.userId, section: 'chores', sourceType: 'chore_assignment', sourceId: made.find((m) => m.assignedUserId === u)!.assignmentId,
      message: `${me} gave you ${choreName}. Next up: ${whenText(when, tz)}.` }));
    if (notes.length) await tx.insert(s.notification).values(notes);
    return { choreId: chore!.choreId, occurrences: made.length };
  });
}

export async function updateChore(user: CurrentUser, householdId: number, choreId: number, b: Record<string, unknown>) {
  const set: Partial<typeof s.chore.$inferInsert> = {};
  if (b.choreName !== undefined) set.choreName = str(b.choreName, 1, 120, 'Chore name');
  if (b.description !== undefined) set.description = optStr(b.description, 500, 'Description');
  if (b.effort !== undefined) { if (!(EFFORTS as readonly string[]).includes(b.effort as string)) throw new HttpError(400, 'Effort must be easy, medium or hard'); set.effort = b.effort as string; }
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(s.chore).where(and(eq(s.chore.choreId, choreId), eq(s.chore.householdId, householdId))).for('update');
    if (!c) throw new HttpError(404, 'Chore not found');
    assertCreator(c.createdByUserId, user.userId); // only the creator edits; schedule changes mean deleting and re-adding
    if (Object.keys(set).length) await tx.update(s.chore).set(set).where(eq(s.chore.choreId, choreId));
    return { ok: true };
  });
}

export async function deleteChore(user: CurrentUser, householdId: number, choreId: number) {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(s.chore).where(and(eq(s.chore.choreId, choreId), eq(s.chore.householdId, householdId))).for('update');
    if (!c) throw new HttpError(404, 'Chore not found');
    assertCreator(c.createdByUserId, user.userId);
    const aIds = (await tx.select({ id: s.choreAssignment.assignmentId }).from(s.choreAssignment).where(eq(s.choreAssignment.choreId, choreId))).map((r) => r.id);
    if (aIds.length) {
      const sIds = (await tx.select({ id: s.choreSwapRequest.swapId }).from(s.choreSwapRequest).where(or(inArray(s.choreSwapRequest.requesterAssignmentId, aIds), inArray(s.choreSwapRequest.targetAssignmentId, aIds)))).map((r) => r.id);
      // no dangling "Check it out" links
      await tx.delete(s.notification).where(and(eq(s.notification.householdId, householdId), or(and(eq(s.notification.sourceType, 'chore_assignment'), inArray(s.notification.sourceId, aIds)), sIds.length ? and(eq(s.notification.sourceType, 'chore_swap_request'), inArray(s.notification.sourceId, sIds)) : undefined)));
    }
    await tx.delete(s.chore).where(eq(s.chore.choreId, choreId)); // cascades rotation, assignments, swap requests
  });
}

// ---- completing -------------------------------------------------------------------------------
async function lockAssignment(tx: Tx, householdId: number, assignmentId: number) {
  const [a] = await tx.select({ assignmentId: s.choreAssignment.assignmentId, choreId: s.choreAssignment.choreId, assignedUserId: s.choreAssignment.assignedUserId, dueAt: s.choreAssignment.dueAt, isCompleted: s.choreAssignment.isCompleted, lastRemindedAt: s.choreAssignment.lastRemindedAt, choreName: s.chore.choreName, createdBy: s.chore.createdByUserId })
    .from(s.choreAssignment).innerJoin(s.chore, eq(s.chore.choreId, s.choreAssignment.choreId))
    .where(and(eq(s.choreAssignment.assignmentId, assignmentId), eq(s.chore.householdId, householdId))).for('update', { of: s.choreAssignment });
  if (!a) throw new HttpError(404, 'Chore not found');
  return a;
}

export async function completeAssignment(user: CurrentUser, householdId: number, assignmentId: number) {
  return db.transaction(async (tx) => {
    const a = await lockAssignment(tx, householdId, assignmentId);
    if (a.assignedUserId !== user.userId) throw new HttpError(403, 'Only the person it is assigned to can mark it done');
    if (a.isCompleted) throw new HttpError(400, 'That one is already done');
    const now = new Date().toISOString();
    await tx.update(s.choreAssignment).set({ isCompleted: true, completedAt: now }).where(eq(s.choreAssignment.assignmentId, assignmentId));
    // a request about a chore that is now done can no longer be answered
    await tx.update(s.choreSwapRequest).set({ status: 'declined', responseMessage: 'Done before anyone answered', respondedDate: now })
      .where(and(eq(s.choreSwapRequest.status, 'pending'), or(eq(s.choreSwapRequest.requesterAssignmentId, assignmentId), eq(s.choreSwapRequest.targetAssignmentId, assignmentId))));
    if (a.createdBy && a.createdBy !== user.userId && (await activeIds(tx, householdId)).includes(a.createdBy)) {
      const me = await firstName(tx, user.userId);
      await tx.insert(s.notification).values({ userId: a.createdBy, householdId, actorUserId: user.userId, section: 'chores', sourceType: 'chore_assignment', sourceId: assignmentId, message: `${me} finished ${a.choreName}.` });
    }
    return { assignmentId, isCompleted: true, completedAt: now };
  });
}

export async function uncompleteAssignment(user: CurrentUser, householdId: number, assignmentId: number) {
  return db.transaction(async (tx) => {
    const a = await lockAssignment(tx, householdId, assignmentId);
    if (a.assignedUserId !== user.userId) throw new HttpError(403, 'Only the person it is assigned to can change it');
    if (!a.isCompleted) throw new HttpError(400, 'That one is not marked done');
    await tx.update(s.choreAssignment).set({ isCompleted: false, completedAt: null }).where(eq(s.choreAssignment.assignmentId, assignmentId));
    return { assignmentId, isCompleted: false };
  });
}

// ---- swap and skip requests -------------------------------------------------------------------
async function pendingFor(tx: Tx, assignmentIds: number[]) {
  const r = await tx.select({ id: s.choreSwapRequest.swapId }).from(s.choreSwapRequest)
    .where(and(eq(s.choreSwapRequest.status, 'pending'), or(inArray(s.choreSwapRequest.requesterAssignmentId, assignmentIds), inArray(s.choreSwapRequest.targetAssignmentId, assignmentIds))));
  return r.length > 0;
}

export async function createSwapRequest(user: CurrentUser, householdId: number, b: Record<string, unknown>) {
  const type = b.type === 'swap' || b.type === 'skip' ? b.type : (() => { throw new HttpError(400, 'Choose swap or skip'); })();
  const requesterAid = id(b.requesterAssignmentId, 'chore');
  const targetAid = type === 'swap' ? id(b.targetAssignmentId, 'their chore') : null;
  if (type === 'skip' && b.targetAssignmentId != null) throw new HttpError(400, 'A skip request does not name a second chore');
  if (targetAid === requesterAid) throw new HttpError(400, 'Pick a different chore to swap with');
  const message = str(b.message, 1, 300, 'A reason');

  return db.transaction(async (tx) => {
    // lock in id order so two people acting at once cannot deadlock
    const order = [requesterAid, ...(targetAid ? [targetAid] : [])].sort((x, y) => x - y);
    const locked = new Map<number, Awaited<ReturnType<typeof lockAssignment>>>();
    for (const aid of order) locked.set(aid, await lockAssignment(tx, householdId, aid));
    const ra = locked.get(requesterAid)!;
    if (ra.assignedUserId !== user.userId) throw new HttpError(403, 'You can only ask about your own chores');
    if (ra.isCompleted) throw new HttpError(400, 'That chore is already done');
    if (Date.parse(iso(ra.dueAt)) < Date.now()) throw new HttpError(400, 'That chore is already past due. Mark it done instead.');
    const active = await activeIds(tx, householdId);
    let recipients: number[];
    if (type === 'swap') {
      const ta = locked.get(targetAid!)!;
      if (ta.assignedUserId === user.userId) throw new HttpError(400, 'Pick a chore that belongs to a roommate');
      if (!active.includes(ta.assignedUserId)) throw new HttpError(400, 'That roommate no longer lives here');
      if (ta.isCompleted) throw new HttpError(400, 'Their chore is already done');
      if (Date.parse(iso(ta.dueAt)) < Date.now()) throw new HttpError(400, 'Their chore is already past due');
      recipients = [ta.assignedUserId];
    } else {
      recipients = active.filter((u) => u !== user.userId);
      if (!recipients.length) throw new HttpError(400, 'There is nobody else in the house to cover it');
    }
    if (await pendingFor(tx, order)) throw new HttpError(409, 'There is already an open request on one of those chores');
    const [r] = await tx.insert(s.choreSwapRequest).values({ requesterAssignmentId: requesterAid, targetAssignmentId: targetAid, type, requestMessage: message, status: 'pending' }).returning();
    const tz = await householdTz(tx, householdId); const me = await firstName(tx, user.userId);
    const text = type === 'swap'
      ? `${me} asked to swap ${ra.choreName} (${whenText(iso(ra.dueAt), tz)}) for your ${locked.get(targetAid!)!.choreName} (${whenText(iso(locked.get(targetAid!)!.dueAt), tz)}): "${message}"`
      : `${me} asked someone to cover ${ra.choreName} (${whenText(iso(ra.dueAt), tz)}): "${message}"`;
    await tx.insert(s.notification).values(recipients.map((u) => ({ userId: u, householdId, actorUserId: user.userId, section: 'chores', sourceType: 'chore_swap_request', sourceId: r!.swapId, message: text })));
    return { swapId: r!.swapId, status: 'pending' };
  });
}

export async function respondToSwap(user: CurrentUser, householdId: number, swapId: number, b: Record<string, unknown>) {
  const action = b.action === 'accept' || b.action === 'decline' || b.action === 'withdraw' ? b.action : (() => { throw new HttpError(400, 'Choose accept, decline or withdraw'); })();
  const reply = optStr(b.message, 300, 'Reply');
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(s.choreSwapRequest).where(eq(s.choreSwapRequest.swapId, swapId)).for('update');
    if (!r) throw new HttpError(404, 'Request not found');
    const ids = [r.requesterAssignmentId, ...(r.targetAssignmentId ? [r.targetAssignmentId] : [])].sort((x, y) => x - y);
    const A = new Map<number, Awaited<ReturnType<typeof lockAssignment>>>();
    for (const aid of ids) A.set(aid, await lockAssignment(tx, householdId, aid)); // also proves the request belongs to this household
    if (r.status !== 'pending') throw new HttpError(409, 'That request was already handled');
    const ra = A.get(r.requesterAssignmentId)!, ta = r.targetAssignmentId ? A.get(r.targetAssignmentId)! : null;
    const now = new Date().toISOString();
    const finish = (status: 'accepted' | 'declined', message: string | null) => tx.update(s.choreSwapRequest).set({ status, responseMessage: message, respondedDate: now }).where(eq(s.choreSwapRequest.swapId, swapId));
    const notifyRequester = async (requester: number, text: string) => {
      if ((await activeIds(tx, householdId)).includes(requester)) await tx.insert(s.notification).values({ userId: requester, householdId, actorUserId: user.userId, section: 'chores', sourceType: 'chore_swap_request', sourceId: swapId, message: text });
    };
    const me = await firstName(tx, user.userId);
    const tail = reply ? ` "${reply}"` : '';

    if (action === 'withdraw') {
      if (ra.assignedUserId !== user.userId) throw new HttpError(403, 'Only the person who asked can withdraw it');
      await finish('declined', 'Withdrawn by the person who asked');
      return { swapId, status: 'declined' };
    }
    if (r.type === 'swap') {
      if (!ta || ta.assignedUserId !== user.userId) throw new HttpError(403, 'Only the roommate it was sent to can answer');
      const requester = ra.assignedUserId;
      if (action === 'decline') { await finish('declined', reply); await notifyRequester(requester, `${me} declined your swap for ${ra.choreName}.${tail}`); return { swapId, status: 'declined' }; }
      if (ra.isCompleted || ta.isCompleted) throw new HttpError(409, 'One of those chores was already done');
      await assertActiveMembers(tx, householdId, [requester, user.userId]);
      await tx.update(s.choreAssignment).set({ assignedUserId: user.userId }).where(eq(s.choreAssignment.assignmentId, ra.assignmentId));
      await tx.update(s.choreAssignment).set({ assignedUserId: requester }).where(eq(s.choreAssignment.assignmentId, ta.assignmentId));
      await finish('accepted', reply);
      await notifyRequester(requester, `${me} accepted your swap: you now have ${ta.choreName}, they have ${ra.choreName}.${tail}`);
      return { swapId, status: 'accepted' };
    }
    // skip: open to the whole house, the first roommate to accept covers it
    const requester = ra.assignedUserId;
    if (user.userId === requester) throw new HttpError(403, 'You cannot cover your own request');
    if (action === 'decline') { // "not me": nothing is recorded on the request, it stays open for others
      await tx.update(s.notification).set({ isRead: true }).where(and(eq(s.notification.userId, user.userId), eq(s.notification.sourceType, 'chore_swap_request'), eq(s.notification.sourceId, swapId)));
      return { swapId, status: 'pending', dismissed: true };
    }
    if (ra.isCompleted) throw new HttpError(409, 'That chore was already done');
    await assertActiveMembers(tx, householdId, [user.userId]);
    await tx.update(s.choreAssignment).set({ assignedUserId: user.userId }).where(eq(s.choreAssignment.assignmentId, ra.assignmentId));
    await finish('accepted', reply);
    await notifyRequester(requester, `${me} will cover ${ra.choreName} for you.${tail}`);
    return { swapId, status: 'accepted' };
  });
}


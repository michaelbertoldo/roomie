// Slice (b): chores. The server owns the rules (rotation, daylight saving, who may do what);
// this page shows the data and sends the user's intent. Times are always shown in the household's timezone.
import { actions, forms, inputs } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { avatar, badge, closeModal, empty, esc, fullName, ico, mhead, openModal, phead, seg, showError, toast } from '../lib/dom.js';
import { dayName } from '../../shared/chore-dates.ts';

let tab = 'schedule';
let filter = 'all';     // 'all' | 'me' | userId
let sortBy = 'added';   // chart: 'added' | 'az' | 'assignee'
let D = null;           // { members, chores, assignments, swapRequests }

const hid = () => household().householdId;
const tz = () => household().timezone;
const who = (id) => D.members.find((m) => m.userId === id);
const first = (id) => (id === S.user.userId ? 'You' : who(id)?.firstName ?? 'Someone');
const active = () => D.members.filter((m) => !m.leftDate);
const choreOf = (id) => D.chores.find((c) => c.choreId === id);
const asgOf = (id) => D.assignments.find((a) => a.assignmentId === id);
const ymdIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date(d));
const daysFromToday = (iso) => Math.round((Date.parse(`${ymdIn(iso)}T12:00:00Z`) - Date.parse(`${ymdIn(Date.now())}T12:00:00Z`)) / 86400000);
const whenFmt = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: tz(), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '').replace(/(\d) (\d)/, '$1 · $2');
const doneFmt = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz(), month: 'short', day: 'numeric' });
const effortChip = (e) => `<span class="st effort-${e}">${e}</span>`;
const openRequestOn = (aid) => D.swapRequests.find((r) => r.requesterAssignmentId === aid || r.targetAssignmentId === aid);

export async function choresView() {
  const h = hid();
  const [{ members }, data] = await Promise.all([api(`/households/${h}/members`), api(`/households/${h}/chores`)]);
  D = { members, ...data };
  const people = active();
  return `${phead('Shared responsibilities', 'Chores', 'A clear view of what needs doing, and whose turn it is.', `<button class="btn p" data-action="add-chore">${ico('plus', 16)} Add chore</button>`)}
  <div class="filters">${seg([['schedule', 'Schedule'], ['chart', 'Chore chart']], tab, 'chore-tab')}
    <select class="input" data-input="chore-filter" aria-label="Show chores for"><option value="all">Everyone</option><option value="me" ${filter === 'me' ? 'selected' : ''}>Just mine</option>${people.filter((m) => m.userId !== S.user.userId).map((m) => `<option value="${m.userId}" ${String(filter) === String(m.userId) ? 'selected' : ''}>${esc(m.firstName)}</option>`).join('')}</select>
    ${tab === 'chart' ? `<select class="input" data-input="chore-sort" aria-label="Sort by"><option value="added" ${sortBy === 'added' ? 'selected' : ''}>Sort: date added</option><option value="az" ${sortBy === 'az' ? 'selected' : ''}>Sort: A to Z</option><option value="assignee" ${sortBy === 'assignee' ? 'selected' : ''}>Sort: assignee</option></select>` : ''}</div>
  ${tab === 'schedule' ? scheduleView() : chartView()}`;
}
actions['chore-tab'] = (el) => { tab = el.dataset.value; window.dispatchEvent(new Event('roomie:render')); };
inputs['chore-filter'] = (el) => { filter = el.value; window.dispatchEvent(new Event('roomie:render')); };
inputs['chore-sort'] = (el) => { sortBy = el.value; window.dispatchEvent(new Event('roomie:render')); };
const passes = (userId) => filter === 'all' || (filter === 'me' ? userId === S.user.userId : String(userId) === String(filter));

// ---- schedule ---------------------------------------------------------------------------------
function row(a) {
  const c = choreOf(a.choreId); if (!c) return '';
  const mine = a.assignedUserId === S.user.userId, d = daysFromToday(a.dueAt);
  const chip = a.isCompleted ? `<span class="st paid">Done ${doneFmt(a.completedAt)}</span>` : a.status === 'overdue' ? '<span class="st overdue">Overdue</span>' : d === 0 ? '<span class="st today">Today</span>' : '';
  const req = openRequestOn(a.assignmentId);
  return `<div class="item cr ${a.isCompleted ? 'isdone' : ''}">
    ${mine ? `<button class="doneb ${a.isCompleted ? 'on' : ''}" data-action="${a.isCompleted ? 'undo-chore' : 'done-chore'}" data-id="${a.assignmentId}" aria-label="${a.isCompleted ? 'Mark not done' : 'Mark done'}">${ico('check', 16)}</button>` : avatar(who(a.assignedUserId), '')}
    <div class="grow" data-action="chore-detail" data-id="${a.assignmentId}" style="cursor:pointer;min-width:0"><b class="nm truncate">${esc(c.choreName)}${c.repeats !== 'none' ? ' <span class="mute" title="Repeats">↻</span>' : ''}</b>
      <div class="hint">${mine ? 'You' : esc(first(a.assignedUserId))} · ${whenFmt(a.dueAt)}</div></div>
    ${req ? '<span class="st pending">Swap asked</span>' : ''}${chip}${effortChip(c.effort)}</div>`;
}
function scheduleView() {
  const mineOnly = (a) => passes(a.assignedUserId);
  const open = D.assignments.filter((a) => !a.isCompleted && mineOnly(a)).sort((x, y) => Date.parse(x.dueAt) - Date.parse(y.dueAt));
  const groups = [['Overdue', open.filter((a) => a.status === 'overdue')], ['Today', open.filter((a) => a.status !== 'overdue' && daysFromToday(a.dueAt) === 0)],
    ['This week', open.filter((a) => a.status !== 'overdue' && daysFromToday(a.dueAt) >= 1 && daysFromToday(a.dueAt) <= 7)], ['Later', open.filter((a) => a.status !== 'overdue' && daysFromToday(a.dueAt) > 7)]];
  const recent = D.assignments.filter((a) => a.isCompleted && mineOnly(a) && Date.now() - Date.parse(a.completedAt) < 7 * 86400000).sort((x, y) => Date.parse(y.completedAt) - Date.parse(x.completedAt));
  const main = D.chores.length === 0
    ? empty('🧹', 'No chores yet', 'Add the first one and choose who does it, or let it rotate through the house.', '<button class="btn p" data-action="add-chore">Add your first chore</button>')
    : (open.length || recent.length ? `${groups.filter(([, l]) => l.length).map(([n, l]) => `<div class="grp">${n}</div>${l.map(row).join('')}`).join('')}${recent.length ? `<div class="grp">Done this week</div>${recent.map(row).join('')}` : ''}` : '<p class="mute" style="padding:10px 0">Nothing due. Enjoy it.</p>');

  // open requests that need an answer from you, plus the ones you are waiting on
  const reqs = D.swapRequests.filter((r) => r.requesterUserId === S.user.userId || r.targetUserId === S.user.userId || (r.type === 'skip' && r.requesterUserId !== S.user.userId));
  const reqCard = reqs.length ? `<section class="card"><div class="row sp"><h2>Swap requests</h2>${badge(`${reqs.length}`, 'warn')}</div>${reqs.map((r) => {
    const ra = asgOf(r.requesterAssignmentId), ta = r.targetAssignmentId ? asgOf(r.targetAssignmentId) : null, mineReq = r.requesterUserId === S.user.userId;
    const text = r.type === 'swap' ? `<b>${esc(first(r.requesterUserId))}</b> ${mineReq ? 'asked' : 'asks'} <b>${esc(first(r.targetUserId))}</b> to swap <b>${esc(choreOf(ra?.choreId)?.choreName ?? 'a chore')}</b> for <b>${esc(choreOf(ta?.choreId)?.choreName ?? 'a chore')}</b>` : `<b>${esc(first(r.requesterUserId))}</b> ${mineReq ? 'asked' : 'asks'} someone to cover <b>${esc(choreOf(ra?.choreId)?.choreName ?? 'a chore')}</b>`;
    return `<div class="item"><div style="font-size:14px">${text}</div><div class="hint">“${esc(r.requestMessage ?? '')}”</div><div class="acts" style="justify-content:flex-start;margin-top:8px"><button class="btn ${mineReq ? '' : 'p'} s" data-action="open-request" data-id="${r.swapId}">${mineReq ? 'Withdraw' : 'Respond'}</button></div></div>`;
  }).join('')}</section>` : '';

  const people = active(); const openCounts = people.map((m) => [m, D.assignments.filter((a) => !a.isCompleted && a.assignedUserId === m.userId).length]); const mx = Math.max(1, ...openCounts.map((x) => x[1]));
  const load = D.chores.length ? `<section class="card"><div class="row sp"><h2>Household workload</h2><span class="eyebrow">open chores</span></div>${openCounts.map(([m, n]) => `<div class="row" style="padding:7px 0">${avatar(m, 'sm')}<span class="truncate" style="width:74px">${esc(first(m.userId))}</span><div class="bar grow" style="--w:${Math.round((n / mx) * 100)}%"><i></i></div><b class="mute" style="width:22px;text-align:right">${n}</b></div>`).join('')}</section>` : '';

  return `<div class="split"><section class="card">${main}</section><aside class="stack">${reqCard}${load}</aside></div>`;
}

// ---- chore chart (the rules) ------------------------------------------------------------------
function chartView() {
  let list = D.chores.filter((c) => { const next = nextAsg(c); return filter === 'all' || c.rotation.some((u) => passes(u)) || (next && passes(next.assignedUserId)); });
  const nm = (c) => (nextAsg(c) ? first(nextAsg(c).assignedUserId) : 'zzz');
  list = [...list].sort(sortBy === 'az' ? (a, b) => a.choreName.localeCompare(b.choreName) : sortBy === 'assignee' ? (a, b) => nm(a).localeCompare(nm(b)) || a.choreName.localeCompare(b.choreName) : (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (!list.length) return `<section class="card">${empty('🧹', D.chores.length ? 'Nothing matches' : 'No chores yet', D.chores.length ? 'Try a different person.' : 'Add the first one and choose who does it, or let it rotate through the house.', D.chores.length ? '' : '<button class="btn p" data-action="add-chore">Add your first chore</button>')}</section>`;
  return `<section class="card"><div class="row sp"><h2>All chores</h2>${badge(`${list.length}`, 'gray')}</div>${list.map((c) => {
    const next = nextAsg(c); const rot = c.rotation.filter((u) => who(u) && !who(u).leftDate);
    return `<div class="item cr" data-action="chore-rule" data-id="${c.choreId}" style="cursor:pointer"><div class="grow" style="min-width:0"><b class="truncate">${esc(c.choreName)}</b>
      <div class="hint">${esc(c.schedule)}${c.repeats !== 'none' && rot.length > 1 ? ` · takes turns: ${rot.map((u) => esc(first(u))).join(', ')}` : ''}</div>
      <div class="hint">${next ? `Next: ${esc(first(next.assignedUserId))}, ${whenFmt(next.dueAt)}` : c.repeats === 'none' ? 'Done' : 'Nobody to assign (everyone moved out)'}</div></div>${effortChip(c.effort)}</div>`;
  }).join('')}</section>`;
}
const nextAsg = (c) => D.assignments.filter((a) => a.choreId === c.choreId && !a.isCompleted).sort((x, y) => Date.parse(x.dueAt) - Date.parse(y.dueAt))[0] ?? null;

// ---- done / undo ------------------------------------------------------------------------------
const refresh = () => window.dispatchEvent(new Event('roomie:render'));
actions['done-chore'] = async (el) => { await api(`/households/${hid()}/assignments/${el.dataset.id}/complete`, { method: 'POST' }); closeModal(); toast('Nice. Marked done.'); refresh(); };
actions['undo-chore'] = async (el) => { await api(`/households/${hid()}/assignments/${el.dataset.id}/uncomplete`, { method: 'POST' }); closeModal(); toast('Marked not done'); refresh(); };
actions['remind-chore'] = async (el) => { await api(`/households/${hid()}/assignments/${el.dataset.id}/remind`, { method: 'POST' }); closeModal(); toast('Reminder sent'); refresh(); };

// ---- detail -----------------------------------------------------------------------------------
actions['chore-detail'] = (el) => {
  const a = asgOf(Number(el.dataset.id)); if (!a) return; const c = choreOf(a.choreId);
  const mine = a.assignedUserId === S.user.userId, req = openRequestOn(a.assignmentId), upcoming = !a.isCompleted && Date.parse(a.dueAt) > Date.now();
  const status = a.isCompleted ? `<span class="st paid">Done ${doneFmt(a.completedAt)}</span>` : a.status === 'overdue' ? '<span class="st overdue">Overdue</span>' : '<span class="st later">Upcoming</span>';
  openModal(`${mhead(esc(c.choreName))}
    <div class="row" style="gap:8px;flex-wrap:wrap">${status}${effortChip(c.effort)}<span class="mute">${esc(c.schedule)}</span></div>
    ${c.description ? `<p>${esc(c.description)}</p>` : ''}
    <div class="item row">${avatar(who(a.assignedUserId))}<div class="grow"><b>${mine ? 'You' : esc(fullName(who(a.assignedUserId)))}</b><div class="hint">${whenFmt(a.dueAt)}${who(a.assignedUserId)?.leftDate ? ' · moved out' : ''}</div></div></div>
    ${c.repeats !== 'none' && c.rotation.length > 1 ? `<p class="hint">Takes turns: ${c.rotation.map((u) => esc(first(u))).join(', ')}</p>` : ''}
    ${req ? `<p class="hint">There is an open ${req.type === 'swap' ? 'swap' : 'cover'} request on this chore.</p>` : ''}
    <div class="acts" style="justify-content:flex-start;flex-wrap:wrap">
      ${mine && !a.isCompleted ? `<button class="btn p" data-action="done-chore" data-id="${a.assignmentId}">Mark done</button>` : ''}
      ${mine && a.isCompleted ? `<button class="btn" data-action="undo-chore" data-id="${a.assignmentId}">Undo</button>` : ''}
      ${!mine && !a.isCompleted ? `<button class="btn" data-action="remind-chore" data-id="${a.assignmentId}">Send a reminder</button>` : ''}
      ${mine && upcoming && !req ? `<button class="btn" data-action="ask" data-type="swap" data-id="${a.assignmentId}">Ask to swap</button><button class="btn" data-action="ask" data-type="skip" data-id="${a.assignmentId}">Ask someone to cover</button>` : ''}
      ${c.canEdit ? `<button class="btn" data-action="edit-chore" data-id="${c.choreId}">Edit</button><button class="btn d" data-action="delete-chore" data-id="${c.choreId}">Delete chore</button>` : ''}</div>`);
};
actions['chore-rule'] = (el) => { const c = choreOf(Number(el.dataset.id)); const a = nextAsg(c) ?? D.assignments.filter((x) => x.choreId === c.choreId).sort((x, y) => Date.parse(y.dueAt) - Date.parse(x.dueAt))[0]; if (a) actions['chore-detail']({ dataset: { id: a.assignmentId } }); else actions['edit-chore'](el); };

// ---- add / edit / delete a chore --------------------------------------------------------------
actions['add-chore'] = () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date());
  const people = active();
  openModal(`${mhead('Add a chore')}
    <form class="stack" data-form="chore-add" autocomplete="off">
      <label class="fld"><span>What needs doing?</span><input class="input" name="choreName" required maxlength="120" placeholder="Take out the trash"></label>
      <label class="fld"><span>Details (optional)</span><textarea class="input" name="description" rows="2" maxlength="500" placeholder="Kitchen and bathroom bins to the curb"></textarea></label>
      <div class="inline-grid"><label class="fld"><span>How hard?</span><select class="input" name="effort"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></label>
        <label class="fld"><span>Time</span><input class="input" name="dueTime" type="time" value="19:00" required></label></div>
      <div class="fld"><span>How often?</span><div class="methods" style="grid-template-columns:repeat(3,1fr)">
        <label><input type="radio" name="repeats" value="none" data-input="chore-type">One time</label>
        <label><input type="radio" name="repeats" value="weekly" checked data-input="chore-type">Every week</label>
        <label><input type="radio" name="repeats" value="monthly" data-input="chore-type">Every month</label></div></div>
      <label class="fld" id="f-date"><span id="l-date">Starting</span><input class="input" name="date" type="date" value="${today}"></label>
      <label class="fld" id="f-dow"><span>Day of the week</span><select class="input" name="dow">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}">${dayName(d)}</option>`).join('')}</select></label>
      <label class="fld hidden" id="f-dom"><span>Day of the month (31 means the last day)</span><input class="input" name="dom" type="number" min="1" max="31" value="1"></label>
      <div class="fld"><span>Who does it?</span><div class="methods" style="grid-template-columns:repeat(2,1fr)">
        <label><input type="radio" name="mode" value="person" checked data-input="chore-who">One person</label>
        <label id="mode-rotate"><input type="radio" name="mode" value="rotate" data-input="chore-who">Take turns</label></div></div>
      <label class="fld" id="f-person"><span>Person</span><select class="input" name="person">${people.map((m) => `<option value="${m.userId}" ${m.userId === S.user.userId ? 'selected' : ''}>${esc(fullName(m))}${m.userId === S.user.userId ? ' (you)' : ''}</option>`).join('')}</select></label>
      <div class="fld hidden" id="f-rot"><span>Turn order (top goes first)</span><div class="opt-list">${people.map((m) => `<label class="chk"><input type="checkbox" name="rot" value="${m.userId}" checked> ${avatar(m, 'sm')} ${esc(fullName(m))}</label>`).join('')}</div></div>
      <div class="err" role="alert"></div>
      <div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">Add chore</button></div>
    </form>`);
  inputs['chore-type'](); inputs['chore-who']();
};
inputs['chore-type'] = () => {
  const f = document.querySelector('form[data-form=chore-add]'); if (!f) return;
  const r = f.repeats.value;
  document.getElementById('f-dow').classList.toggle('hidden', r !== 'weekly');
  document.getElementById('f-dom').classList.toggle('hidden', r !== 'monthly');
  document.getElementById('l-date').textContent = r === 'none' ? 'Date' : 'Starting';
  // taking turns only makes sense for something that repeats
  const rotate = document.getElementById('mode-rotate'); rotate.classList.toggle('hidden', r === 'none');
  if (r === 'none' && f.mode.value === 'rotate') { f.mode.value = 'person'; inputs['chore-who'](); }
};
inputs['chore-who'] = () => {
  const f = document.querySelector('form[data-form=chore-add]'); if (!f) return;
  const rot = f.mode.value === 'rotate';
  document.getElementById('f-person').classList.toggle('hidden', rot);
  document.getElementById('f-rot').classList.toggle('hidden', !rot);
};
forms['chore-add'] = async (form) => {
  const f = new FormData(form), repeats = f.get('repeats');
  const body = { choreName: f.get('choreName'), description: String(f.get('description')).trim() || null, effort: f.get('effort'), repeats, dueTime: f.get('dueTime'),
    assignment: f.get('mode') === 'rotate' ? { mode: 'rotate', userIds: f.getAll('rot').map(Number) } : { mode: 'person', userId: Number(f.get('person')) } };
  if (repeats === 'none') body.date = f.get('date');
  if (repeats === 'weekly') { body.dayOfWeek = Number(f.get('dow')); body.date = f.get('date'); }
  if (repeats === 'monthly') { body.dayOfMonth = Number(f.get('dom')); body.date = f.get('date'); }
  let r; try { r = await api(`/households/${hid()}/chores`, { method: 'POST', body }); } catch (e) { return showError(form, e.message); }
  closeModal(); toast(r.occurrences ? `Added. ${r.occurrences} upcoming ${r.occurrences === 1 ? 'turn is' : 'turns are'} on the schedule.` : 'Added.'); refresh();
};
actions['edit-chore'] = (el) => {
  const c = choreOf(Number(el.dataset.id));
  openModal(`${mhead('Edit chore')}<form class="stack" data-form="chore-edit" data-id="${c.choreId}">
    <label class="fld"><span>Name</span><input class="input" name="choreName" required maxlength="120" value="${esc(c.choreName)}"></label>
    <label class="fld"><span>Details</span><textarea class="input" name="description" rows="2" maxlength="500">${esc(c.description ?? '')}</textarea></label>
    <label class="fld"><span>How hard?</span><select class="input" name="effort">${['easy', 'medium', 'hard'].map((e) => `<option value="${e}" ${c.effort === e ? 'selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}</select></label>
    <p class="hint">To change when it happens or who does it, delete it and add it again.</p>
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">Save</button></div></form>`);
};
forms['chore-edit'] = async (form) => {
  const f = new FormData(form);
  try { await api(`/households/${hid()}/chores/${form.dataset.id}`, { method: 'PATCH', body: { choreName: f.get('choreName'), description: String(f.get('description')).trim() || null, effort: f.get('effort') } }); } catch (e) { return showError(form, e.message); }
  closeModal(); toast('Saved'); refresh();
};
actions['delete-chore'] = async (el) => {
  if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'Really delete? Tap again'; return; }
  await api(`/households/${hid()}/chores/${el.dataset.id}`, { method: 'DELETE' });
  closeModal(); toast('Chore deleted'); refresh();
};

// ---- swap and skip ----------------------------------------------------------------------------
actions.ask = (el) => {
  const a = asgOf(Number(el.dataset.id)), c = choreOf(a.choreId), type = el.dataset.type;
  const others = type === 'swap' ? D.assignments.filter((x) => !x.isCompleted && x.assignedUserId !== S.user.userId && Date.parse(x.dueAt) > Date.now() && who(x.assignedUserId) && !who(x.assignedUserId).leftDate && !openRequestOn(x.assignmentId)).sort((x, y) => Date.parse(x.dueAt) - Date.parse(y.dueAt)) : [];
  openModal(`${mhead(type === 'swap' ? `Swap ${esc(c.choreName)}` : `Ask someone to cover ${esc(c.choreName)}`)}
    <form class="stack" data-form="ask" data-type="${type}" data-id="${a.assignmentId}">
      <p class="mute">${type === 'swap' ? `Pick one of a roommate's chores to trade for your ${esc(c.choreName)} on ${whenFmt(a.dueAt)}.` : 'Everyone else in the house is asked. The first person to say yes takes it.'}</p>
      ${type === 'swap' ? (others.length ? `<div class="fld"><span>Trade for</span><div class="opt-list">${others.map((x, i) => `<label class="radio-row"><input type="radio" name="target" value="${x.assignmentId}" ${i === 0 ? 'checked' : ''}>${avatar(who(x.assignedUserId), 'sm')}<span class="grow"><b>${esc(choreOf(x.choreId).choreName)}</b><div class="hint">${esc(first(x.assignedUserId))} · ${whenFmt(x.dueAt)}</div></span></label>`).join('')}</div></div>` : '<div class="note">There are no roommate chores to trade for right now.</div>') : ''}
      <label class="fld"><span>Why? (they will see this)</span><textarea class="input" name="message" rows="2" required maxlength="300" placeholder="Visiting family this weekend"></textarea></label>
      <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit" ${type === 'swap' && !others.length ? 'disabled' : ''}>Send request</button></div></form>`);
};
forms.ask = async (form) => {
  const f = new FormData(form), type = form.dataset.type;
  const body = { type, requesterAssignmentId: Number(form.dataset.id), message: f.get('message') };
  if (type === 'swap') body.targetAssignmentId = Number(f.get('target'));
  try { await api(`/households/${hid()}/swap-requests`, { method: 'POST', body }); } catch (e) { return showError(form, e.message); }
  closeModal(); toast('Request sent. They were notified.'); refresh();
};
actions['open-request'] = (el) => {
  const r = D.swapRequests.find((x) => x.swapId === Number(el.dataset.id)); if (!r) return;
  const ra = asgOf(r.requesterAssignmentId), ta = r.targetAssignmentId ? asgOf(r.targetAssignmentId) : null, mineReq = r.requesterUserId === S.user.userId;
  const rc = choreOf(ra?.choreId), tc = choreOf(ta?.choreId);
  if (mineReq) {
    openModal(`${mhead('Your request')}<p>${r.type === 'swap' ? `You asked ${esc(first(r.targetUserId))} to swap <b>${esc(rc?.choreName)}</b> (${ra ? whenFmt(ra.dueAt) : ''}) for <b>${esc(tc?.choreName)}</b> (${ta ? whenFmt(ta.dueAt) : ''}).` : `You asked the house to cover <b>${esc(rc?.choreName)}</b> (${ra ? whenFmt(ra.dueAt) : ''}).`}</p><p class="hint">“${esc(r.requestMessage ?? '')}”</p>
      <div class="acts"><button class="btn" data-action="close-modal">Keep it</button><button class="btn d" data-action="answer" data-answer="withdraw" data-id="${r.swapId}">Withdraw</button></div>`);
    return;
  }
  openModal(`${mhead(r.type === 'swap' ? 'Swap request' : 'Can you cover?')}
    <form class="stack" data-form="respond" data-id="${r.swapId}" data-type="${r.type}">
      <div class="item row t">${avatar(who(r.requesterUserId))}<div class="grow"><b>${esc(first(r.requesterUserId))}</b> ${r.type === 'swap' ? `wants to swap their <b>${esc(rc?.choreName)}</b> (${ra ? whenFmt(ra.dueAt) : ''}) for your <b>${esc(tc?.choreName)}</b> (${ta ? whenFmt(ta.dueAt) : ''}).` : `asked someone to cover <b>${esc(rc?.choreName)}</b> (${ra ? whenFmt(ra.dueAt) : ''}).`}<div class="hint">“${esc(r.requestMessage ?? '')}”</div></div></div>
      <label class="fld"><span>Reply (optional)</span><textarea class="input" name="message" rows="2" maxlength="300"></textarea></label>
      <div class="err" role="alert"></div>
      <div class="acts"><button type="button" class="btn" data-action="answer" data-answer="decline" data-id="${r.swapId}">${r.type === 'swap' ? 'Decline' : 'Not me'}</button><button class="btn p" type="submit">${r.type === 'swap' ? 'Accept swap' : "I'll cover it"}</button></div></form>`);
};
const sendAnswer = async (swapId, action, message, form) => {
  try { await api(`/households/${hid()}/swap-requests/${swapId}`, { method: 'PATCH', body: { action, message: message || undefined } }); } catch (e) { if (form) return showError(form, e.message); throw e; }
  closeModal(); toast(action === 'accept' ? 'Done. The schedule is updated.' : action === 'withdraw' ? 'Request withdrawn' : 'Answered'); refresh();
};
forms.respond = (form) => sendAnswer(Number(form.dataset.id), 'accept', String(new FormData(form).get('message')).trim(), form);
actions.answer = (el) => sendAnswer(Number(el.dataset.id), el.dataset.answer, String(document.querySelector('form[data-form=respond] [name=message]')?.value ?? '').trim(), document.querySelector('form[data-form=respond]'));


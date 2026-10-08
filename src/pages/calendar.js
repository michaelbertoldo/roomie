// Slice (c): shared calendar + sticky-note board. The server owns the rules (who may edit, who was
// asked about hosting, who gets notified); this page shows data and sends intent.
// Times are always shown in the household's timezone. The board and calendar poll every 15 seconds,
// so a roommate's note or answer shows up without a refresh.
import { actions, forms, inputs } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { avatar, closeModal, empty, esc, fullName, ico, mhead, openModal, phead, seg, showError, toast } from '../lib/dom.js';

const COLORS = ['#4338ca', '#db2777', '#0d9488', '#d97706', '#7c3aed', '#0284c7', '#475569'];
const CATS = [['meeting', 'Meeting'], ['hosting', 'Hosting guests'], ['other', 'Other']];
const CHORE_COLOR = '#94a3b8';

let view = 'list';        // 'list' | 'month'
let sortBy = 'date';      // 'date' | 'color'
let show = 'all';         // 'all' | 'events' | 'chores'
let monthStart = null;    // 'YYYY-MM-01' being shown in the month view
let D = null;             // { members, events, notes, chores, assignments }
let seen = '';            // what the last poll saw, to repaint only on change

const hid = () => household().householdId;
const tz = () => household().timezone;
const who = (id) => D.members.find((m) => m.userId === id);
const first = (id) => (id === S.user.userId ? 'You' : who(id)?.firstName ?? 'Someone');
const active = () => D.members.filter((m) => !m.leftDate);
const eventOf = (id) => D.events.find((e) => e.eventId === id);
const ymdIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date(d));
const hmIn = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const timeFmt = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' });
const dayLabel = (ymd) => {
  const today = ymdIn(Date.now());
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
};
const whenFull = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: tz(), weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function addDays(ymd, n) { const t = new Date(`${ymd}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; if (m < 1440) return `${Math.round(m / 60)}h ago`; if (m < 10080) return `${Math.round(m / 1440)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { timeZone: tz(), month: 'short', day: 'numeric' });
};
const refresh = () => window.dispatchEvent(new Event('roomie:render'));
const path = (p) => `/households/${hid()}${p}`;

// ---- data -------------------------------------------------------------------------------------
async function load() {
  const [{ members }, { events }, { notes }, chores] = await Promise.all([api(path('/members')), api(path('/events')), api(path('/board')), api(path('/chores'))]);
  D = { members, events, notes, chores: chores.chores, assignments: chores.assignments };
  seen = JSON.stringify([events, notes, chores.assignments]);
}

// everything that can sit on the calendar, as one list
function items() {
  const out = [];
  if (show !== 'chores') for (const e of D.events) out.push({ kind: 'event', at: e.eventDate, ymd: ymdIn(e.eventDate), color: e.color || COLORS[0], e });
  if (show !== 'events') for (const a of D.assignments) {
    const c = D.chores.find((x) => x.choreId === a.choreId); if (!c) continue;
    out.push({ kind: 'chore', at: a.dueAt, ymd: ymdIn(a.dueAt), color: CHORE_COLOR, a, c });
  }
  return out.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

// ---- rows -------------------------------------------------------------------------------------
function tagAvatars(e) { return e.tags.length ? `<span class="row" style="gap:3px">${e.tags.slice(0, 4).map((t) => avatar(who(t.userId), 'sm')).join('')}</span>` : ''; }
function hostChip(e) {
  if (e.category !== 'hosting') return '';
  const asked = e.tags.filter((t) => t.response);
  if (!asked.length) return '<span class="st later">Hosting</span>';
  if (asked.some((t) => t.response === 'declined')) return '<span class="st disputed">Someone said no</span>';
  if (asked.some((t) => t.response === 'pending')) return '<span class="st unpaid">Waiting for answers</span>';
  return '<span class="st paid">Everyone is okay</span>';
}
function row(it) {
  if (it.kind === 'event') {
    const e = it.e;
    return `<div class="item click row ev" data-action="event-detail" data-id="${e.eventId}" tabindex="0" style="--ev:${esc(it.color)}">
      <span class="evbar"></span><div class="grow"><b>${esc(e.eventName)}</b>
      <div class="hint">${timeFmt(e.eventDate)}${e.location ? ` · ${esc(e.location)}` : ''}${e.createdByUserId ? ` · ${esc(first(e.createdByUserId))}` : ''}</div></div>${hostChip(e)}${tagAvatars(e)}</div>`;
  }
  const { a, c } = it, mine = a.assignedUserId === S.user.userId;
  const st = a.isCompleted ? '<span class="st paid">Done</span>' : a.status === 'overdue' ? '<span class="st overdue">Overdue</span>' : '';
  return `<a class="item click row ev" href="#/chores" style="--ev:${CHORE_COLOR}"><span class="evbar"></span>
    <div class="grow"><b>${ico('check', 14)} ${esc(c.choreName)}</b><div class="hint">${timeFmt(a.dueAt)} · ${mine ? 'You' : esc(first(a.assignedUserId))}</div></div>${st}${avatar(who(a.assignedUserId), 'sm')}</a>`;
}

// ---- list view --------------------------------------------------------------------------------
function listView() {
  const today = ymdIn(Date.now()), end = addDays(today, 90);
  let list = items().filter((i) => i.ymd >= today && i.ymd <= end);
  if (!list.length) return empty('📅', 'Nothing coming up', 'Add an event, or add a chore on the Chores page, and it shows up here.', '<button class="btn p" data-action="add-event">Add event</button>');
  if (sortBy === 'color') {
    list = [...list].sort((x, y) => (x.color === y.color ? Date.parse(x.at) - Date.parse(y.at) : x.color < y.color ? -1 : 1));
    return list.map((i) => `${row(i)}`).join('');
  }
  const days = [...new Set(list.map((i) => i.ymd))];
  return days.map((d) => `<div class="dayh">${dayLabel(d)}</div>${list.filter((i) => i.ymd === d).map(row).join('')}`).join('');
}

// ---- month view -------------------------------------------------------------------------------
function monthView() {
  const today = ymdIn(Date.now());
  monthStart ??= `${today.slice(0, 7)}-01`;
  const lead = new Date(`${monthStart}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(monthStart, -lead);
  const title = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const all = items();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    if (i >= 35 && d.slice(0, 7) !== monthStart.slice(0, 7)) break;
    const todays = all.filter((x) => x.ymd === d);
    cells.push(`<button class="day2 ${d.slice(0, 7) !== monthStart.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''}" data-action="day-detail" data-day="${d}" aria-label="${esc(dayLabel(d))}, ${todays.length} items">
      <span class="dn">${Number(d.slice(8))}</span>${todays.slice(0, 3).map((x) => `<i class="dpill" style="background:${esc(x.color)}">${esc(x.kind === 'event' ? x.e.eventName : x.c.choreName)}</i>`).join('')}${todays.length > 3 ? `<small>+${todays.length - 3} more</small>` : ''}</button>`);
  }
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><button class="btn s" data-action="month-nav" data-n="-1" aria-label="Previous month">‹</button><b>${title}</b><button class="btn s" data-action="month-nav" data-n="1" aria-label="Next month">›</button></div>
    <div class="mgrid mhead">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span>${d}</span>`).join('')}</div><div class="mgrid">${cells.join('')}</div>`;
}
actions['month-nav'] = (el) => { const t = new Date(`${monthStart}T12:00:00Z`); t.setUTCMonth(t.getUTCMonth() + Number(el.dataset.n)); monthStart = t.toISOString().slice(0, 7) + '-01'; refresh(); };
actions['day-detail'] = (el) => {
  const d = el.dataset.day, todays = items().filter((x) => x.ymd === d);
  openModal(`${mhead(esc(dayLabel(d)))}<div class="stack">${todays.length ? todays.map(row).join('') : '<p class="mute">Nothing on this day.</p>'}</div>
    <div class="acts"><button class="btn p" data-action="add-event" data-day="${d}">Add event</button></div>`);
};

// ---- the page ---------------------------------------------------------------------------------
export async function calendarView() {
  await load();
  const head = phead('Shared schedule', 'Calendar', 'Events, chores and notes for your house.', `<button class="btn p" data-action="add-event">${ico('plus', 16)} Add event</button>`);
  const filters = `<div class="filters">${seg([['list', 'List'], ['month', 'Month']], view, 'cal-view')}
    <select class="input" data-input="cal-show" aria-label="Show"><option value="all">Events and chores</option><option value="events" ${show === 'events' ? 'selected' : ''}>Events only</option><option value="chores" ${show === 'chores' ? 'selected' : ''}>Chores only</option></select>
    ${view === 'list' ? `<select class="input" data-input="cal-sort" aria-label="Sort by"><option value="date">Sort: date</option><option value="color" ${sortBy === 'color' ? 'selected' : ''}>Sort: color</option></select>` : ''}</div>`;
  return `${head}<div class="split cal">
    <section class="card" id="cal-main"><div class="stack">${filters}<div>${view === 'list' ? listView() : monthView()}</div></div></section>
    <section class="card board" data-board>${boardInner(false)}</section></div>`;
}
actions['cal-view'] = (el) => { view = el.dataset.value; refresh(); };
inputs['cal-show'] = (el) => { show = el.value; refresh(); };
inputs['cal-sort'] = (el) => { sortBy = el.value; refresh(); };

// ---- event detail -----------------------------------------------------------------------------
actions['event-detail'] = (el) => {
  const e = eventOf(Number(el.dataset.id)); if (!e) return;
  const mine = e.tags.find((t) => t.userId === S.user.userId);
  const answer = (t) => (t.response === 'accepted' ? '<span class="st paid">Okay</span>' : t.response === 'declined' ? '<span class="st disputed">Not okay</span>' : t.response === 'pending' ? '<span class="st unpaid">Waiting</span>' : '');
  openModal(`${mhead(esc(e.eventName))}
    <div class="row" style="gap:8px;flex-wrap:wrap"><span class="evdot" style="background:${esc(e.color || COLORS[0])}"></span><b>${whenFull(e.eventDate)}${e.endDate ? ` to ${timeFmt(e.endDate)}` : ''}</b></div>
    <div class="hint">${CATS.find(([k]) => k === e.category)?.[1] ?? ''}${e.location ? ` · ${esc(e.location)}` : ''}${e.reminderMinutesBefore != null ? ` · reminder ${e.reminderMinutesBefore >= 60 && e.reminderMinutesBefore % 60 === 0 ? `${e.reminderMinutesBefore / 60}h` : `${e.reminderMinutesBefore}m`} before` : ''}</div>
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    <div class="hint">Added by ${esc(first(e.createdByUserId))}</div>
    ${e.tags.length ? `<div class="stack">${e.tags.map((t) => `<div class="item row">${avatar(who(t.userId))}<div class="grow"><b>${esc(first(t.userId))}</b></div>${answer(t)}</div>`).join('')}</div>` : ''}
    ${mine?.response ? `<p class="hint">${esc(first(e.createdByUserId))} is asking if hosting is okay with you.</p><div class="acts" style="justify-content:flex-start">
      ${mine.response !== 'accepted' ? `<button class="btn p" data-action="event-answer" data-id="${e.eventId}" data-response="accepted">That is okay</button>` : ''}
      ${mine.response !== 'declined' ? `<button class="btn" data-action="event-answer" data-id="${e.eventId}" data-response="declined">Not okay</button>` : ''}</div>` : ''}
    ${e.canEdit ? `<div class="acts" style="justify-content:flex-start"><button class="btn" data-action="edit-event" data-id="${e.eventId}">Edit</button><button class="btn d" data-action="delete-event" data-id="${e.eventId}">Delete</button></div>` : ''}`);
};
actions['event-answer'] = async (el) => { await api(path(`/events/${el.dataset.id}/respond`), { method: 'POST', body: { response: el.dataset.response } }); closeModal(); toast('Answer sent'); refresh(); };
actions['delete-event'] = async (el) => { if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'Really delete? Tap again'; return; }
  await api(path(`/events/${el.dataset.id}`), { method: 'DELETE' }); closeModal(); toast('Event deleted'); refresh(); };

// ---- add / edit ---------------------------------------------------------------------------------
function eventForm(e, day) {
  const others = active().filter((m) => m.userId !== S.user.userId);
  const date = e ? ymdIn(e.eventDate) : day || ymdIn(Date.now());
  const endSame = e?.endDate && ymdIn(e.endDate) === date;
  const tagged = new Set(e?.tags.map((t) => t.userId) ?? []);
  const color = e?.color || COLORS[0];
  return `${mhead(e ? 'Edit event' : 'Add an event')}
  <form class="stack" data-form="event-save" ${e ? `data-id="${e.eventId}"` : ''} autocomplete="off">
    <label class="fld"><span>What is happening?</span><input class="input" name="eventName" required maxlength="120" value="${esc(e?.eventName ?? '')}" placeholder="House meeting"></label>
    <div class="inline-grid"><label class="fld"><span>Date</span><input class="input" name="date" type="date" required value="${date}"></label>
      <label class="fld"><span>Starts</span><input class="input" name="time" type="time" required value="${e ? hmIn(e.eventDate) : '18:00'}"></label>
      <label class="fld"><span>Ends (optional)</span><input class="input" name="endTime" type="time" value="${endSame ? hmIn(e.endDate) : ''}"></label></div>
    <label class="fld"><span>Where (optional)</span><input class="input" name="location" maxlength="120" value="${esc(e?.location ?? '')}" placeholder="Living room"></label>
    <div class="fld"><span>What kind?</span><div class="methods">${CATS.map(([k, l]) => `<label><input type="radio" name="category" value="${k}" ${(e?.category ?? 'meeting') === k ? 'checked' : ''} data-input="event-cat">${l}</label>`).join('')}</div></div>
    <div class="fld"><span>Color</span><div class="row" style="gap:10px;flex-wrap:wrap">${COLORS.map((c) => `<label class="swr"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}</div></div>
    <label class="fld"><span>Reminder</span><select class="input" name="reminder">${[['', 'No reminder'], ['0', 'At the start'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']].map(([v, l]) => `<option value="${v}" ${String(e?.reminderMinutesBefore ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="fld"><span id="tag-label">Tag roommates</span><div class="opt-list">${others.length ? others.map((m) => `<label class="chk"><input type="checkbox" name="tag" value="${m.userId}" ${tagged.has(m.userId) ? 'checked' : ''}> ${avatar(m, 'sm')} ${esc(fullName(m))}</label>`).join('') : '<span class="hint">No other roommates yet.</span>'}</div>
      <span class="hint" id="tag-hint"></span></div>
    <label class="fld"><span>Details (optional)</span><textarea class="input" name="description" rows="2" maxlength="500">${esc(e?.description ?? '')}</textarea></label>
    <div class="err" role="alert"></div>
    <div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">${e ? 'Save' : 'Add event'}</button></div>
  </form>`;
}
inputs['event-cat'] = () => {
  const f = document.querySelector('form[data-form=event-save]'); if (!f) return;
  const hint = document.getElementById('tag-hint'); if (hint) hint.textContent = f.category.value === 'hosting' ? 'Tagged roommates are asked if hosting is okay with them.' : 'Tagged roommates are notified.';
};
actions['add-event'] = (el) => { openModal(eventForm(null, el?.dataset?.day)); inputs['event-cat'](); };
actions['edit-event'] = (el) => { const e = eventOf(Number(el.dataset.id)); if (!e) return; openModal(eventForm(e)); inputs['event-cat'](); };
forms['event-save'] = async (form) => {
  const f = new FormData(form), id = form.dataset.id;
  const body = { eventName: f.get('eventName'), date: f.get('date'), time: f.get('time'), endTime: f.get('endTime') || null, location: f.get('location'), category: f.get('category'),
    color: f.get('color'), reminderMinutesBefore: f.get('reminder') === '' ? null : Number(f.get('reminder')), description: f.get('description'), taggedUserIds: f.getAll('tag').map(Number) };
  try { await api(path(id ? `/events/${id}` : '/events'), { method: id ? 'PATCH' : 'POST', body }); } catch (err) { return showError(form, err.message); }
  closeModal(); toast(id ? 'Event saved' : 'Event added'); refresh();
};

// ---- the board ----------------------------------------------------------------------------------
function noteHtml(n) {
  const ev = n.eventId ? eventOf(n.eventId) : null;
  return `<article class="sticky ${n.isPinned ? 'pinned' : ''}">
    <div class="row t" style="gap:8px">${avatar(who(n.senderUserId), 'sm')}<div class="grow"><b>${esc(first(n.senderUserId))}</b> <span class="hint">${ago(n.postedDate)}</span></div>
      ${n.canEdit ? `<button class="x" data-action="note-pin" data-id="${n.messageId}" data-pinned="${n.isPinned ? '' : '1'}" aria-label="${n.isPinned ? 'Unpin' : 'Pin'}" title="${n.isPinned ? 'Unpin' : 'Pin'}">📌</button><button class="x" data-action="note-delete" data-id="${n.messageId}" aria-label="Delete note">✕</button>` : (n.isPinned ? '<span title="Pinned">📌</span>' : '')}</div>
    <p>${esc(n.messageText)}</p>
    ${ev ? `<button class="chip" data-action="event-detail" data-id="${ev.eventId}">${ico('calendar', 13)} ${esc(ev.eventName)}</button>` : ''}
    ${n.replies.map((r) => `<div class="reply row t" style="gap:8px">${avatar(who(r.senderUserId), 'sm')}<div class="grow"><b>${esc(first(r.senderUserId))}</b> <span class="hint">${ago(r.postedDate)}</span><div>${esc(r.messageText)}</div></div>
      ${r.canEdit ? `<button class="x" data-action="note-delete" data-id="${r.messageId}" aria-label="Delete reply">✕</button>` : ''}</div>`).join('')}
    <form class="row replyf" data-form="note-reply" data-id="${n.messageId}"><input class="input" name="messageText" maxlength="500" placeholder="Reply" aria-label="Reply" required><button class="btn s" type="submit">Send</button></form></article>`;
}
function boardInner(big) {
  const upcoming = D.events.filter((e) => Date.parse(e.eventDate) > Date.now() - 86400000);
  return `<div class="row" style="justify-content:space-between"><h2>Board</h2>${big ? '' : '<button class="btn s" data-action="board-expand">Expand</button>'}</div>
    <form class="stack" data-form="note-new"><textarea class="input" name="messageText" rows="2" maxlength="500" placeholder="Share a plan or check with everyone before hosting" aria-label="New note" required></textarea>
      <div class="row" style="gap:8px;flex-wrap:wrap"><select class="input" name="eventId" aria-label="Link to an event" style="flex:1;min-width:0"><option value="">No linked event</option>${upcoming.map((e) => `<option value="${e.eventId}">${esc(e.eventName)}</option>`).join('')}</select>
      <button class="btn p" type="submit">Post</button></div><div class="err" role="alert"></div></form>
    <div class="notes ${big ? 'big' : ''}">${D.notes.length ? D.notes.map(noteHtml).join('') : '<p class="mute" style="text-align:center;padding:14px">No notes yet. Post the first one.</p>'}</div>`;
}
const paintBoard = () => document.querySelectorAll('[data-board]').forEach((el) => { el.innerHTML = boardInner(el.dataset.board === 'big'); });
async function reloadBoard() { const [{ notes }, { events }] = await Promise.all([api(path('/board')), api(path('/events'))]); D.notes = notes; D.events = events; paintBoard(); }
actions['board-expand'] = () => { openModal(`${mhead('Board')}<section data-board="big">${boardInner(true)}</section>`); document.querySelector('#modal .sheet')?.classList.add('wide'); };
forms['note-new'] = async (form) => {
  const f = new FormData(form), body = { messageText: f.get('messageText') }; if (f.get('eventId')) body.eventId = Number(f.get('eventId'));
  try { await api(path('/board'), { method: 'POST', body }); } catch (err) { return showError(form, err.message); }
  await reloadBoard();
};
forms['note-reply'] = async (form) => {
  try { await api(path('/board'), { method: 'POST', body: { messageText: new FormData(form).get('messageText'), parentMessageId: Number(form.dataset.id) } }); } catch (err) { toast(err.message); return; }
  await reloadBoard();
};
actions['note-pin'] = async (el) => { await api(path(`/board/${el.dataset.id}`), { method: 'PATCH', body: { isPinned: el.dataset.pinned === '1' } }); await reloadBoard(); };
actions['note-delete'] = async (el) => { if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.title = 'Tap again to delete'; el.textContent = '?'; return; }
  await api(path(`/board/${el.dataset.id}`), { method: 'DELETE' }); await reloadBoard(); };

// ---- near-real-time: poll while the calendar is on screen and nobody is typing -------------------
setInterval(async () => {
  try {
    if (document.hidden || document.getElementById('root')?.dataset.page !== 'calendar' || document.getElementById('modal') || !D) return;
    if (document.activeElement?.closest?.('form,textarea,input,select')) return;
    const [{ events }, { notes }, chores] = await Promise.all([api(path('/events')), api(path('/board')), api(path('/chores'))]);
    if (JSON.stringify([events, notes, chores.assignments]) !== seen) refresh();
  } catch { /* offline or signed out: try again next tick */ }
}, 15000);

// Slice (e): the Home page. A one-glance snapshot: what is waiting on you, this week's calendar, the latest
// notifications and recent board notes. Every row opens the full feature. The optional AI line is OFF unless
// the server says so ({ enabled: true }); when off, nothing about it is shown. It is read once per sign-in.
import { actions } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { ago, avatar, empty, esc, ico, phead } from '../lib/dom.js';
import { loadAlerts } from './notifications.js';
import { greeting, pickWeek } from '../../shared/home.ts';

const hid = () => household().householdId;
const tz = () => household().timezone;
const ymdIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date(d));
const hourIn = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', hour12: false }).format(new Date())) % 24;
const timeFmt = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' });
const dayLabel = (ymd) => {
  const today = ymdIn(Date.now());
  const t = (n) => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  return ymd === today ? 'Today' : ymd === t(1) ? 'Tomorrow' : new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
};
const TARGET = { chore_assignment: 'chores', chore_swap_request: 'chores', expense: 'finances', expense_share: 'finances', payment: 'finances', wishlist_item: 'finances', event: 'calendar', bulletin_message: 'calendar' };
const aiKey = () => `roomie.ai.${S.user.userId}.${hid()}`;
export const clearAi = () => { try { Object.keys(sessionStorage).filter((k) => k.startsWith('roomie.ai.')).forEach((k) => sessionStorage.removeItem(k)); } catch { /* storage blocked: nothing to clear */ } };

function weekRows(events, chores, members) {
  const name = (id) => (id === S.user.userId ? 'You' : members.find((m) => m.userId === id)?.firstName ?? 'Someone');
  const all = [
    ...events.map((e) => ({ kind: 'event', at: e.eventDate, ymd: ymdIn(e.eventDate), e })),
    ...chores.assignments.filter((a) => !a.isCompleted).map((a) => ({ kind: 'chore', at: a.dueAt, ymd: ymdIn(a.dueAt), a, c: chores.chores.find((c) => c.choreId === a.choreId) })).filter((x) => x.c),
  ].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const week = pickWeek(all, ymdIn(Date.now()), 7);
  const overdue = all.filter((x) => x.kind === 'chore' && x.a.status === 'overdue' && x.a.assignedUserId === S.user.userId);
  const row = (x) => x.kind === 'event'
    ? `<a class="item click row ev" href="#/calendar" data-action="home-event" data-id="${x.e.eventId}" style="--ev:${esc(x.e.color || '#4338ca')}"><span class="evbar"></span><div class="grow"><b>${esc(x.e.eventName)}</b><div class="hint">${timeFmt(x.e.eventDate)}${x.e.location ? ` · ${esc(x.e.location)}` : ''}</div></div></a>`
    : `<a class="item click row ev" href="#/chores" style="--ev:#94a3b8"><span class="evbar"></span><div class="grow"><b>${ico('check', 14)} ${esc(x.c.choreName)}</b><div class="hint">${timeFmt(x.a.dueAt)} · ${esc(name(x.a.assignedUserId))}</div></div>${avatar(members.find((m) => m.userId === x.a.assignedUserId), 'sm')}</a>`;
  const days = [...new Set(week.map((x) => x.ymd))];
  return { overdue, html: days.length ? days.map((d) => `<div class="dayh">${dayLabel(d)}</div>${week.filter((x) => x.ymd === d).map(row).join('')}`).join('') : '' };
}

export async function homeView() {
  const [{ members }, { events }, { notes }, chores, inbox] = await Promise.all([
    api(`/households/${hid()}/members`), api(`/households/${hid()}/events`), api(`/households/${hid()}/board`), api(`/households/${hid()}/chores`), loadAlerts(),
  ]);
  const who = (id) => members.find((m) => m.userId === id);
  const mine = inbox.notifications.filter((n) => n.householdId === hid());
  const waiting = mine.filter((n) => n.canRespond && !n.isRead);
  const week = weekRows(events, chores, members);
  const recent = [...notes.flatMap((n) => [n, ...n.replies])].sort((a, b) => Date.parse(b.postedDate) - Date.parse(a.postedDate)).slice(0, 3);
  const first = S.user.firstName || 'there';
  const dateLine = new Date().toLocaleDateString('en-US', { timeZone: tz(), weekday: 'long', month: 'long', day: 'numeric' });

  queueMicrotask(() => setTimeout(fillAi, 0));
  return `${phead(esc(household().householdName), `${greeting(hourIn())}, ${esc(first)}`, dateLine)}
    <div id="ai-line" class="ai hidden" role="status" aria-live="polite"></div>
    ${waiting.length || week.overdue.length ? `<section class="card stack"><h2>Waiting on you</h2><div class="stack" style="gap:8px">
      ${waiting.map((n) => `<a class="item click row" href="#/notifications"><span class="evdot" style="background:#dc2626"></span><div class="grow">${esc(n.message)}</div><span class="badge">Answer</span></a>`).join('')}
      ${week.overdue.slice(0, 3).map((x) => `<a class="item click row" href="#/chores"><span class="evdot" style="background:#d97706"></span><div class="grow"><b>${esc(x.c.choreName)}</b> is overdue</div><span class="badge warn">Overdue</span></a>`).join('')}</div></section>` : ''}
    <div class="split cal">
      <section class="card stack"><div class="row" style="justify-content:space-between"><h2>This week</h2><a class="btn s" href="#/calendar">Calendar</a></div>
        ${week.html || empty('📅', 'A quiet week', 'Nothing is scheduled for the next 7 days.', '<a class="btn p" href="#/calendar">Add an event</a>')}</section>
      <div class="stack" style="gap:18px">
        <section class="card stack"><div class="row" style="justify-content:space-between"><h2>Latest notifications</h2><a class="btn s" href="#/notifications">${inbox.unread ? `${inbox.unread} unread` : 'See all'}</a></div>
          ${mine.length ? mine.slice(0, 4).map((n) => `<a class="item click row" href="#/notifications"><span class="evdot" style="background:${n.isRead ? 'transparent' : 'var(--accent)'}"></span><div class="grow">${esc(n.message)}<div class="hint">${ago(n.createdAt, tz())}</div></div></a>`).join('') : '<p class="mute">You are all caught up.</p>'}</section>
        <section class="card stack"><div class="row" style="justify-content:space-between"><h2>On the board</h2><a class="btn s" href="#/calendar">Open board</a></div>
          ${recent.length ? recent.map((n) => `<a class="item click row t" href="#/calendar" style="gap:8px">${avatar(who(n.senderUserId), 'sm')}<div class="grow"><b>${esc(n.senderUserId === S.user.userId ? 'You' : who(n.senderUserId)?.firstName ?? 'Someone')}</b> <span class="hint">${ago(n.postedDate, tz())}${n.parentMessageId ? ' · reply' : ''}</span><div>${esc(n.messageText.length > 110 ? `${n.messageText.slice(0, 107)}...` : n.messageText)}</div></div></a>`).join('') : '<p class="mute">No notes yet.</p>'}</section>
      </div></div>`;
}

// An event row opens the event's detail on the Calendar page, the same way "Check it out" does.
actions['home-event'] = (el) => { try { sessionStorage.setItem('roomie.open', JSON.stringify({ type: 'event', id: Number(el.dataset.id) })); } catch { /* storage blocked: the page still opens */ } location.hash = '#/calendar'; };

/** Ask once per sign-in (cached in sessionStorage). Anything but { enabled: true, text } leaves the line hidden. */
async function fillAi() {
  const el = document.getElementById('ai-line'); if (!el) return;
  const show = (text) => { el.textContent = text; el.classList.remove('hidden'); };
  try {
    const cached = sessionStorage.getItem(aiKey());
    if (cached) return show(cached);
  } catch { /* storage blocked: just ask */ }
  try {
    const r = await api(`/households/${hid()}/home-summary`);
    if (r.enabled && r.text && document.getElementById('ai-line') === el) {
      show(r.text);
      try { sessionStorage.setItem(aiKey(), r.text); } catch { /* fine */ }
    }
  } catch { /* the line is a bonus: never show an error for it */ }
}

// Slice (d): the notification dashboard and the bell in the top bar. Every notification lands in one of
// five sections, has a "Check it out" button that opens the related part of the app, and where it makes
// sense can be answered right on the card (swap, payment, hosting check). Pending swap requests
// show a red alert on the bell. The server owns who sees what; this page only displays and sends intent.
import { actions } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { ago, closeModal, empty, esc, ico, phead, seg, toast } from '../lib/dom.js';

const SECTIONS = [['all', 'All'], ['chores', 'Chores'], ['money', 'Money'], ['expense_tracker', 'Expenses'], ['system', 'System'], ['calendar_board', 'Calendar']];
const TARGET = { chore_assignment: 'chores', chore_swap_request: 'chores', expense: 'finances', expense_share: 'finances', payment: 'finances', wishlist_item: 'finances', event: 'calendar', bulletin_message: 'calendar' };
let tab = 'all';
let D = { notifications: [], unread: 0, swapPending: 0 };
let seen = '';
const refresh = () => window.dispatchEvent(new Event('roomie:render'));
const houseName = (id) => S.households.find((h) => h.householdId === id)?.householdName ?? 'Household';

// ---- the bell ---------------------------------------------------------------------------------
export function bellHtml() {
  const { unread, swapPending } = S.alerts;
  const badge = swapPending > 0 ? `<b class="bdot red" aria-hidden="true">${swapPending}</b>` : unread > 0 ? `<b class="bdot" aria-hidden="true">${unread > 9 ? '9+' : unread}</b>` : '';
  const label = swapPending > 0 ? `Notifications: ${swapPending} swap ${swapPending === 1 ? 'request needs' : 'requests need'} your answer` : unread > 0 ? `Notifications: ${unread} unread` : 'Notifications';
  return `<a href="#/notifications" class="iconbtn" data-bell aria-label="${label}">${ico('bell', 19)}${badge}</a>`;
}
export const paintBell = () => { const b = document.querySelector('[data-bell]'); if (b) b.outerHTML = bellHtml(); };
export async function loadAlerts() {
  const r = await api('/notifications');
  D = r; S.alerts = { unread: r.unread, swapPending: r.swapPending };
  seen = JSON.stringify(r.notifications);
  return r;
}

// ---- the page ---------------------------------------------------------------------------------
function card(n) {
  const gone = n.sourceGone, multi = S.households.length > 1;
  const status = n.sourceType === 'chore_swap_request' && n.sourceStatus && n.sourceStatus !== 'pending' ? `<span class="st ${n.sourceStatus === 'accepted' ? 'paid' : 'disputed'}">${n.sourceStatus === 'accepted' ? 'Accepted' : 'Declined'}</span>`
    : n.sourceType === 'payment' && n.sourceStatus === 'confirmed' ? '<span class="st paid">Confirmed</span>' : n.sourceType === 'payment' && n.sourceStatus === 'disputed' ? '<span class="st disputed">Disputed</span>'
    : n.sourceType === 'event' && n.sourceStatus === 'accepted' ? '<span class="st paid">You said okay</span>' : n.sourceType === 'event' && n.sourceStatus === 'declined' ? '<span class="st disputed">You said no</span>' : '';
  const d = `data-id="${n.notificationId}" data-house="${n.householdId}" data-source="${n.sourceId ?? ''}"`;
  let buttons = '';
  if (n.canRespond && n.sourceType === 'chore_swap_request') buttons = `<button class="btn p s" data-action="nt-swap" data-answer="accept" ${d}>Accept</button><button class="btn s" data-action="nt-swap" data-answer="decline" ${d}>Decline</button>`;
  if (n.canRespond && n.sourceType === 'payment') buttons = `<button class="btn p s" data-action="nt-pay" data-answer="confirmed" ${d}>I got it</button>${n.sourceStatus === 'sent' ? `<button class="btn s" data-action="nt-pay" data-answer="disputed" ${d}>I did not</button>` : ''}`;
  if (n.canRespond && n.sourceType === 'event') buttons = `${n.sourceStatus !== 'accepted' ? `<button class="btn p s" data-action="nt-event" data-answer="accepted" ${d}>That is okay</button>` : ''}${n.sourceStatus !== 'declined' ? `<button class="btn s" data-action="nt-event" data-answer="declined" ${d}>Not okay</button>` : ''}`;
  return `<article class="nt ${n.isRead ? '' : 'unread'} ${n.swapPending ? 'alert' : ''}">
    <span class="ntdot" aria-label="${n.isRead ? 'Read' : 'Unread'}"></span>
    <div class="grow stack" style="gap:6px"><div>${esc(n.message)}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><span class="hint">${ago(n.createdAt, household()?.timezone)}</span>${multi ? `<span class="badge gray">${esc(houseName(n.householdId))}</span>` : ''}${status}${gone ? '<span class="hint">No longer available</span>' : ''}</div>
      <div class="acts" style="justify-content:flex-start">${buttons}${n.sourceType && !gone ? `<button class="btn s" data-action="nt-open" ${d} data-type="${n.sourceType}">Check it out</button>` : ''}
        <button class="btn s ghost" data-action="nt-read" ${d} data-read="${n.isRead ? '' : '1'}">${n.isRead ? 'Mark unread' : 'Mark read'}</button></div></div></article>`;
}
export async function notificationsView() {
  await loadAlerts();
  const unreadIn = (k) => D.notifications.filter((n) => !n.isRead && (k === 'all' || n.section === k)).length;
  const tabs = seg(SECTIONS.map(([k, l]) => [k, unreadIn(k) ? `${l} (${unreadIn(k)})` : l]), tab, 'nt-tab');
  const list = D.notifications.filter((n) => tab === 'all' || n.section === tab);
  const head = phead('Everything that needs you', 'Notifications', 'What your roommates did, and what is waiting on you.',
    D.unread ? `<button class="btn" data-action="nt-readall">Mark ${tab === 'all' ? 'all' : 'these'} read</button>` : '');
  return `${head}<section class="card stack"><div class="filters" style="overflow-x:auto">${tabs}</div>
    ${list.length ? `<div class="stack" style="gap:10px">${list.map(card).join('')}</div>` : empty('🔔', tab === 'all' ? 'You are all caught up' : 'Nothing here', 'New activity from your roommates shows up here.')}</section>`;
}
actions['nt-tab'] = (el) => { tab = el.dataset.value; refresh(); };

// ---- actions ------------------------------------------------------------------------------------
const markRead = (id, isRead) => api(`/notifications/${id}`, { method: 'PATCH', body: { isRead } });
actions['nt-read'] = async (el) => { await markRead(el.dataset.id, el.dataset.read === '1'); refresh(); };
actions['nt-readall'] = async () => { await api('/notifications/read-all', { method: 'POST', body: tab === 'all' ? {} : { section: tab } }); toast('Marked read'); refresh(); };
actions['nt-open'] = async (el) => {
  const hid = Number(el.dataset.house), type = el.dataset.type;
  await markRead(el.dataset.id, true).catch(() => {});
  if (hid !== S.hid && S.households.some((h) => h.householdId === hid)) { S.hid = hid; localStorage.setItem('roomie.hid', String(hid)); }
  if (type === 'event') sessionStorage.setItem('roomie.open', JSON.stringify({ type: 'event', id: Number(el.dataset.source) }));
  location.hash = `#/${TARGET[type] ?? 'home'}`;
};
const answer = async (el, path, init, msg) => { await api(`/households/${el.dataset.house}${path}`, init); await markRead(el.dataset.id, true).catch(() => {}); closeModal(); toast(msg); refresh(); };
actions['nt-swap'] = (el) => answer(el, `/swap-requests/${el.dataset.source}`, { method: 'PATCH', body: { action: el.dataset.answer } }, el.dataset.answer === 'accept' ? 'Swap accepted' : 'Declined');
actions['nt-pay'] = (el) => answer(el, `/payments/${el.dataset.source}`, { method: 'PATCH', body: { status: el.dataset.answer } }, el.dataset.answer === 'confirmed' ? 'Payment confirmed' : 'Marked as not received');
actions['nt-event'] = (el) => answer(el, `/events/${el.dataset.source}/respond`, { method: 'POST', body: { response: el.dataset.answer } }, 'Answer sent');

// ---- keep the bell fresh (and this page, when nobody is mid-click) --------------------------------
setInterval(async () => {
  try {
    if (document.hidden || !S.user) return;
    const prev = seen, r = await loadAlerts();
    paintBell();
    if (document.getElementById('root')?.dataset.page === 'notifications' && !document.getElementById('modal') && seen !== prev && r) refresh();
  } catch { /* offline or signed out: try again next tick */ }
}, 30000);

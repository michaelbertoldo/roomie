// The bell is a personal activity inbox. Shared requests and responses live on their feature pages.
import { actions } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { ago, closeModal, esc, ico, mhead, openModal, toast } from '../lib/dom.js';

import { prepareFinanceActivity } from './finances.js';

const TARGET = { chore_assignment: 'chores', chore_swap_request: 'chores', expense: 'finances', expense_share: 'finances', payment: 'finances', wishlist_item: 'finances', event: 'calendar', bulletin_message: 'calendar' };
const GROUPS = [
  { id: 'chores', label: 'Chores' },
  { id: 'money', label: 'Money' },
  { id: 'events', label: 'Events & Hosting' },
  { id: 'board', label: 'Board' },
  { id: 'other', label: 'Other' },
];
const LABEL = { chores: 'Chores', money: 'Payments', expense_tracker: 'Expenses', system: 'Reminder', calendar_board: 'Events & Hosting / Board' };
let statusFilter = 'unread';
let D = { notifications: [], unread: 0, swapPending: 0 };
let viewer = null, loadSequence = 0, pendingTarget = null;
let alertPoll = null, alertPollGeneration = 0, alertPollViewer = null;
const isOpen = () => Boolean(document.querySelector('#modal.activity-overlay'));

export function bellHtml() {
  const unread = S.alerts.unread;
  const label = unread ? `Personal activity: ${unread} unread updates` : 'Personal activity';
  return `<button type="button" class="iconbtn" data-bell data-action="activity-toggle" aria-label="${label}" aria-haspopup="dialog" aria-expanded="${isOpen()}" aria-controls="activity-panel">${ico('bell', 19)}${unread ? `<b class="bdot" aria-hidden="true">${unread > 9 ? '9+' : unread}</b>` : ''}</button>`;
}
export function paintBell() {
  const bell = document.querySelector('[data-bell]'); if (!bell) return;
  // Preserve the focused bell element so closing the panel restores focus reliably.
  const template = document.createElement('template'); template.innerHTML = bellHtml();
  const next = template.content.firstElementChild;
  bell.innerHTML = next.innerHTML;
  bell.setAttribute('aria-label', next.getAttribute('aria-label'));
  bell.setAttribute('aria-expanded', String(isOpen()));
}
export async function loadAlerts() {
  const userId = S.user?.userId, sequence = ++loadSequence;
  const response = await api('/notifications');
  if (S.user?.userId === userId && sequence === loadSequence) {
    D = response; viewer = userId;
    S.alerts = { unread: response.unread, swapPending: response.swapPending };
  }
  return response;
}
export function startAlertPolling() {
  const userId = S.user?.userId;
  if (!userId || (alertPoll && alertPollViewer === userId)) return;
  stopAlertPolling();
  alertPollViewer = userId;
  const generation = alertPollGeneration;
  let inFlight = false;
  alertPoll = setInterval(async () => {
    if (inFlight || document.hidden || S.user?.userId !== userId) return;
    inFlight = true;
    const previous = JSON.stringify([D.notifications, D.unread, D.swapPending]);
    try {
      await loadAlerts();
      if (generation !== alertPollGeneration || S.user?.userId !== userId) return;
      if (JSON.stringify([D.notifications, D.unread, D.swapPending]) !== previous) {
        if (isOpen()) paintPanel({ preserveFocus: true });
        else paintBell();
      }
    } catch (error) {
      if (error.status === 401) stopAlertPolling();
      /* Keep the last count while offline and retry on the next poll. */
    }
    finally { inFlight = false; }
  }, 5000);
}
export function stopAlertPolling() {
  alertPollGeneration++;
  if (alertPoll) clearInterval(alertPoll);
  alertPoll = null;
  alertPollViewer = null;
}
function activityRow(n) {
  const available = !n.sourceGone && TARGET[n.sourceType] && n.sourceId != null;
  const house = S.households.find((h) => h.householdId === n.householdId);
  const content = `<span class="activity-dot ${n.isRead ? '' : 'unread'}" aria-label="${n.isRead ? 'Read' : 'Unread'}"></span><span class="grow"><span class="activity-message">${esc(n.message)}</span><span class="activity-meta">${esc(LABEL[n.section] ?? 'Update')} · ${ago(n.createdAt, house?.timezone ?? household()?.timezone)}${S.households.length > 1 ? ` · ${esc(house?.householdName ?? 'Household')}` : ''}${n.sourceGone ? ' · No longer available' : ''}</span></span>${available ? ico('chevron', 14) : ''}`;
  return available ? `<button type="button" class="activity-item ${n.isRead ? '' : 'unread'}" data-action="activity-open" data-id="${n.notificationId}">${content}</button>`
    : `<div class="activity-item ${n.isRead ? '' : 'unread'}">${content}</div>`;
}
function activityGroup(n) {
  if (n.sourceType === 'chore_assignment' || n.sourceType === 'chore_swap_request' || n.section === 'chores') return 'chores';
  if (['expense', 'expense_share', 'payment', 'wishlist_item'].includes(n.sourceType) || ['money', 'expense_tracker'].includes(n.section)) return 'money';
  if (n.sourceType === 'event') return 'events';
  if (n.sourceType === 'bulletin_message') return 'board';
  return 'other';
}
function panelContent() {
  const notifications = D.notifications.filter((n) => statusFilter === 'all' || (statusFilter === 'unread' ? !n.isRead : n.isRead));
  const sorted = [...notifications].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const groups = GROUPS.map((group) => {
    const items = sorted.filter((n) => activityGroup(n) === group.id);
    return items.length ? `<section class="activity-group" aria-labelledby="activity-group-${group.id}"><h4 id="activity-group-${group.id}" class="activity-group-title">${group.label}<span>${items.length}</span></h4>${items.map(activityRow).join('')}</section>` : '';
  }).join('');
  const filter = (id, label) => `<button type="button" class="activity-filter ${statusFilter === id ? 'selected' : ''}" data-action="activity-filter" data-id="${id}" aria-pressed="${statusFilter === id}">${label}</button>`;
  const readAll = statusFilter !== 'read' && D.unread ? '<button class="activity-read-all" data-action="activity-read-all">Mark all read</button>' : '';
  const empty = statusFilter === 'read' ? 'No read updates.' : statusFilter === 'all' ? 'No updates yet.' : 'No unread updates.';
  return `${mhead('Activity')}<div class="row sp activity-heading"><p class="hint">Updates for you</p>${readAll}</div>
    <div class="activity-filters" role="group" aria-label="Filter updates by read status">${filter('all', 'All')}${filter('unread', 'Unread')}${filter('read', 'Read')}</div>
    <div id="activity-error" class="err" role="alert"></div><div class="activity-list">${groups || `<p class="activity-empty">${empty}</p>`}</div>`;
}
function paintPanel({ preserveFocus = false } = {}) {
  const sheet = document.getElementById('activity-panel');
  const focused = preserveFocus && sheet?.contains(document.activeElement) ? document.activeElement : null;
  const action = focused?.dataset.action, id = focused?.dataset.id;
  if (sheet) sheet.innerHTML = panelContent();
  if (action && sheet) {
    const selector = id ? `[data-action="${action}"][data-id="${id}"]` : `[data-action="${action}"]`;
    (sheet.querySelector(selector) ?? sheet.querySelector('.x'))?.focus({ preventScroll: true });
  }
  paintBell();
}
export async function openActivityPanel() {
  openModal(`${mhead('Activity')}<p class="hint" role="status">Loading updates…</p>`);
  const overlay = document.getElementById('modal'); overlay.classList.add('activity-overlay');
  const sheet = overlay.querySelector('.sheet'); sheet.id = 'activity-panel';
  paintBell();
  try {
    await loadAlerts();
    if (!overlay.isConnected) return;
    paintPanel(); sheet.querySelector('button')?.focus();
  } catch {
    if (!overlay.isConnected) return;
    sheet.innerHTML = `${mhead('Activity')}<p class="hint" role="alert">Couldn’t load your updates.</p><button class="btn s" data-action="activity-retry">Try again</button>`;
    sheet.querySelector('button')?.focus();
  }
}
actions['activity-toggle'] = () => { if (isOpen()) { closeModal(); paintBell(); } else return openActivityPanel(); };
actions['activity-retry'] = openActivityPanel;
actions['activity-filter'] = (button) => {
  if (!['all', 'unread', 'read'].includes(button.dataset.id)) return;
  statusFilter = button.dataset.id;
  paintPanel({ preserveFocus: true });
};
actions['activity-read-all'] = async (button) => {
  button.disabled = true;
  try {
    await api('/notifications/read-all', { method: 'POST', body: {} });
    await loadAlerts(); paintPanel(); document.querySelector('#activity-panel .x')?.focus();
  } catch {
    const error = document.getElementById('activity-error'); if (error) error.textContent = 'Couldn’t mark updates as read. Try again.';
  } finally { button.disabled = false; }
};
actions['activity-open'] = async (button) => {
  if (viewer !== S.user?.userId) return;
  const n = D.notifications.find((item) => item.notificationId === Number(button.dataset.id));
  const page = n && TARGET[n.sourceType];
  if (!n || !page || n.sourceGone) return;
  if (!S.households.some((h) => h.householdId === n.householdId)) { toast('That household is no longer available.'); return; }
  button.disabled = true;
  try {
    await api(`/notifications/${n.notificationId}`, { method: 'PATCH', body: { isRead: true } });
    n.isRead = true; S.alerts.unread = D.notifications.filter((item) => !item.isRead).length;
  } catch { /* The item can still be opened; unread state is retried by the normal refresh. */ }
  finally { button.disabled = false; }
  if (viewer !== S.user?.userId) return;
  closeModal();
  S.hid = n.householdId;
  try { localStorage.setItem('roomie.hid', String(S.hid)); } catch { /* Selection remains active in memory. */ }
  if (page === 'finances') prepareFinanceActivity(n.sourceType);
  pendingTarget = { page, type: n.sourceType, id: Number(n.sourceId), householdId: n.householdId };
  if (location.hash === `#/${page}`) window.dispatchEvent(new Event('roomie:render'));
  else location.hash = `#/${page}`;
  paintBell();
};
// Called after the destination page has loaded its data and rendered. Only open read-only details.
export function openPendingActivity(page) {
  const target = pendingTarget;
  if (!target || target.page !== page || target.householdId !== S.hid) return;
  pendingTarget = null;
  const el = { dataset: { id: String(target.id) } };
  if (target.type === 'event') actions['event-detail']?.(el);
  else if (target.type === 'chore_assignment') actions['chore-detail']?.(el);
  else if (target.type === 'chore_swap_request') actions['open-request']?.(el);
  else if (target.type === 'expense') {
    const row = document.querySelector(`[data-action=expense][data-id="${target.id}"]`);
    if (row) actions.expense?.(row);
  } else if (target.type === 'wishlist_item') {
    const row = document.querySelector(`[data-action=wish][data-id="${target.id}"]`);
    if (row) actions.wish?.(row);
  } else {
    const section = target.type === 'bulletin_message'
      ? document.querySelector(`[data-board-message-ids~="${target.id}"]`) ?? document.querySelector('[data-board]')
      : target.type === 'payment' ? document.querySelector(`[data-activity-payment="${target.id}"]`) ?? document.querySelector('#page') : document.querySelector('#page');
    if (section) {
      section.classList.add('activity-source-target'); section.setAttribute('tabindex', '-1');
      section.focus({ preventScroll: true }); section.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  }
}
window.addEventListener('roomie:modal-close', paintBell);

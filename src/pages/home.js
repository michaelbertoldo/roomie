import { scheduleToolbar } from '../components/schedule-toolbar.js';
// Home shows one household schedule in two formats; feature pages own editing and responses.
import { actions, forms, inputs } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { avatar, closeModal, esc, mhead, money, openModal, personColor, phead, showError, toast } from '../lib/dom.js';
import { addDays } from '../../shared/chore-dates.ts';
import { monthDays, scheduleItems } from '../../shared/home-schedule.ts';
import { householdBoard, announcementForm } from '../components/household-board.js';
import { openChoreDetails } from './chores.js';
import { fitHomeWidgets, widgetDropSlot } from '../components/home-layout.js';
import { queueCalendarCreate } from '../lib/calendar-create.js';
import { toCents } from '../../shared/money.ts';

const hid = () => household().householdId;
const tz = () => household().timezone;
const ymdIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date(d));
const timeFmt = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' });
const dayLabel = (day) => day === ymdIn(Date.now()) ? 'Today' : day === addDays(ymdIn(Date.now()), 1) ? 'Tomorrow'
  : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
// Display preferences are local to each user and household; shared data is unchanged.
const viewKey = () => `roomie.home.view.${S.user.userId}.${hid()}`;
const getView = () => { try { return localStorage.getItem(viewKey()) === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } };
const layoutKey = () => `roomie.home.layout.${S.user.userId}.${hid()}`;
const widgetNames = { schedule: 'Schedule', board: 'Household board', finances: 'Finances' };
const defaultLayout = () => [{ id: 'schedule', size: 'expanded' }, { id: 'board', size: 'compact' }, { id: 'finances', size: 'compact' }];
function getLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey()));
    if (Array.isArray(saved) && saved.length === 3 && new Set(saved.map((w) => w.id)).size === 3 && saved.every((w) => Object.hasOwn(widgetNames, w.id) && ['compact', 'expanded'].includes(w.size) && (w.column === undefined || Number.isInteger(w.column) && w.column >= 1 && w.column <= 3))) return saved;
  } catch { /* Use the default when storage is unavailable or invalid. */ }
  return defaultLayout();
}
let layout = defaultLayout(), editing = false, editingKey = null;
const widgetSize = (id) => layout.find((w) => w.id === id)?.size;
let monthHousehold = null, D = null, homeBoardArchive = false;

function row(item) {
  const member = D.members.find((m) => m.userId === item.userId);
  const name = item.userId === S.user.userId ? 'You' : member?.firstName || 'Someone';
  const overdue = item.kind === 'chore' && !item.completed && Date.parse(item.at) < Date.now();
  return `<a class="item click row ev home-schedule-row ${item.completed ? 'completed' : ''} ${item.approval?.status ?? ''}" href="#/${item.kind === 'event' ? 'calendar' : 'chores'}" data-action="home-open" data-kind="${item.kind}" data-id="${item.eventId ?? ''}" style="--ev:${personColor(item.userId)}">
    <span class="evbar"></span><div class="grow"><div class="home-item-heading"><span class="home-kind">${esc(item.label)}</span>${item.approval?.total ? `<span class="st ${item.approval.status === 'confirmed' ? 'paid' : item.approval.status === 'changes_requested' ? 'disputed' : 'unpaid'}">${item.approval.label} · ${item.approval.approved} of ${item.approval.total} approved</span>` : ''}${item.completed ? '<span class="st paid">Completed</span>' : overdue ? '<span class="st overdue">Overdue</span>' : ''}</div><b>${esc(item.name)}</b>
    <div class="hint">${timeFmt(item.at)} · ${item.kind === 'event' ? 'Added by ' : ''}${esc(name)}${item.location ? ` · ${esc(item.location)}` : ''}</div></div>${avatar(member, 'sm')}</a>`;
}

// Home always shows today plus the next 13 days in the household's timezone: no month navigation.
const homeRange = () => {
  const start = new Date(`${ymdIn(Date.now())}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 13);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
};
const rangeLabel = () => {
  const fmt = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const [start, end] = homeRange();
  return `${fmt(start)} – ${fmt(end)}`;
};
function monthNav(view) {
  return scheduleToolbar({ title: rangeLabel(), monthAction: 'home-month', viewInput: 'home-view', view, showMonthNav: false });
}
const upcomingMonthItems = () => {
  const [start, end] = homeRange();
  return D.items.filter((item) => item.ymd >= start && item.ymd <= end);
};
function monthList(items) {
  return items.length ? [...new Set(items.map((item) => item.ymd))].map((day) => `<section class="stack home-day"><h3>${esc(dayLabel(day))}</h3>${items.filter((item) => item.ymd === day).map(row).join('')}</section>`).join('') : '<p class="home-empty">Nothing scheduled in the next two weeks.</p>';
}
function listView() {
  const items = upcomingMonthItems();
  const compact = widgetSize('schedule') === 'compact';
  return `${monthNav('list')}${monthList(compact ? items.slice(0, 5) : items)}${compact && items.length > 5 ? `<button class="btn s" data-action="home-month-list">View all ${items.length} items</button>` : ''}`;
}
actions['home-month-list'] = () => {
  openModal(`${mhead(esc(rangeLabel()))}<div class="stack">${monthList(upcomingMonthItems())}</div>`);
};

function calendarView() {
  const compact = widgetSize('schedule') === 'compact';
  const today = ymdIn(Date.now());
  return `${monthNav('calendar')}
    <div class="mgrid mhead">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="mgrid home-month">${Array.from({ length: new Date(`${today}T12:00:00Z`).getUTCDay() }, () => '<span class="day2 blank" aria-hidden="true"></span>').join('')}${Array.from({ length: 14 }, (_, i) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + i); return date.toISOString().slice(0, 10); }).map((day) => {
      const items = D.items.filter((item) => item.ymd === day);
      return `<button class="day2 ${day === today ? 'today' : ''}" data-action="home-day" data-day="${day}" aria-label="${esc(dayLabel(day))}, ${items.length} items" ${day === today ? 'aria-current="date"' : ''}>
        <span class="dn">${Number(day.slice(8))}</span>${compact ? `<span class="home-day-dots" aria-hidden="true">${items.slice(0, 3).map((item) => `<i style="background:${personColor(item.userId)}"></i>`).join('')}</span>` : `${items.slice(0, 3).map((item) => `<span class="home-calendar-item ${item.completed ? 'completed' : ''}" style="--ev:${personColor(item.userId)}"><span>${timeFmt(item.at)} · ${esc(item.label)}</span><b>${esc(item.name)}</b>${item.approval?.total ? `<span class="home-calendar-approval">${item.approval.label} · ${item.approval.approved}/${item.approval.total}</span>` : ''}</span>`).join('')}
        ${items.length > 3 ? `<span class="home-more">+${items.length - 3} more</span>` : ''}<span class="home-mobile-count" aria-hidden="true">${items.length || ''}</span>` }</button>`;
    }).join('')}</div>${compact ? compactUpcoming() : ''}`;
}

function compactUpcoming() {
  const upcoming = upcomingMonthItems().filter((item) => !item.completed && Date.parse(item.at) >= Date.now());
  return `<div class="home-compact-upcoming"><h3>Coming up</h3>${upcoming.slice(0, 3).map((item) => `<div><span class="hint">${esc(dayLabel(item.ymd))}</span>${row(item)}</div>`).join('') || '<p class="hint">Nothing else coming up in the next two weeks.</p>'}</div>`;
}

export async function homeView() {
  const [{ members }, { events }, chores, balances, { notes }] = await Promise.all([
    api(`/households/${hid()}/members`), api(`/households/${hid()}/events`), api(`/households/${hid()}/chores`), api(`/households/${hid()}/balances`), api(`/households/${hid()}/board`),
  ]);
  D = { householdId: hid(), members, events, chores, notes, user: S.user, timezone: tz(), items: scheduleItems(events, chores, tz()) };
  if (monthHousehold !== hid()) { monthHousehold = hid(); homeBoardArchive = false; }
  if (editingKey !== layoutKey()) { editing = false; editingKey = layoutKey(); }
  layout = getLayout();
  const view = getView();
  const owed = balances.mine.reduce((sum, b) => sum + Math.max(0, -toCents(b.signedAmount)), 0);
  const owingMe = balances.mine.reduce((sum, b) => sum + Math.max(0, toCents(b.signedAmount)), 0);
  const widgets = {
    board: `<section class="card stack home-board" id="home-board">${householdBoard({ ...D, compact: widgetSize('board') === 'compact' })}</section>`,
    schedule: `<section class="card stack home-schedule" aria-label="Shared household schedule"><div class="${view === 'list' ? 'stack' : ''}" id="home-schedule-content" data-view="${view}">${view === 'calendar' ? calendarView() : listView()}</div></section>`,
    finances: `<section class="card home-finances"><div><h2>Finances</h2><p class="hint">Your shared expense overview</p></div><div class="home-balance"><span>You owe <b>${money(owed)}</b></span><span>Owed to you <b>${money(owingMe)}</b></span></div><a class="btn s" href="#/finances">Open finances</a></section>`,
  };
  return `${phead('Shared household schedule', 'Here you can see an overview of what’s happening in your household', `<button class="btn s" data-action="home-edit-layout">${editing ? 'Done' : 'Edit dashboard'}</button>`)}
    <div class="home-layout-status sr-only" role="status"></div><div class="page-content home-dashboard">${layout.map(({ id, size }) => `<div class="home-widget ${size}" data-widget="${id}" data-column="${layout.find((w) => w.id === id).column ?? ''}" data-editing="${editing}">${widgets[id]}</div>`).join('')}</div>`;

}

inputs['home-view'] = (el) => {
  const view = el.value;
  if (!['calendar', 'list'].includes(view)) return;
  try { localStorage.setItem(viewKey(), view); } catch { /* Display still changes when storage is unavailable. */ }
  // Use the same loaded items and keep keyboard focus on the view dropdown.
  const content = document.getElementById('home-schedule-content');
  content.dataset.view = view;
  content.className = view === 'list' ? 'stack' : '';
  const keepFocus = document.activeElement === el;
  content.innerHTML = view === 'calendar' ? calendarView() : listView();
  fitHomeWidgets(document.querySelector('.home-dashboard'));
  if (keepFocus) content.querySelector('[data-input=home-view]')?.focus();
};
actions['home-day'] = (el) => {
  const items = D.items.filter((item) => item.ymd === el.dataset.day);
  openModal(`${mhead(esc(dayLabel(el.dataset.day)))}<div class="stack">${items.length ? items.map(row).join('') : '<p class="mute">No events or chores on this day.</p>'}</div><div class="acts"><button class="btn p" data-action="home-create" data-kind="event" data-day="${esc(el.dataset.day)}">Add event</button><button class="btn" data-action="home-create" data-kind="chore" data-day="${esc(el.dataset.day)}">Add chore</button></div>`);
};
actions['home-create'] = (button) => {
  if (!D || D.householdId !== hid() || !queueCalendarCreate(button.dataset.kind, button.dataset.day)) return;
  closeModal();
  location.hash = button.dataset.kind === 'event' ? '#/calendar' : '#/chores';
};
actions['home-open'] = (el) => {
  closeModal();
  if (el.dataset.kind === 'event') {
    try { sessionStorage.setItem('roomie.open', JSON.stringify({ type: 'event', id: Number(el.dataset.id) })); } catch { /* The Events page still opens. */ }
  }
  location.hash = el.getAttribute('href');
};

async function refreshHomeBoard(onlyChanged = false) {
  const householdId = D.householdId;
  const [{ events }, chores, { notes }] = await Promise.all([api(`/households/${householdId}/events`), api(`/households/${householdId}/chores`), api(`/households/${householdId}/board`)]);
  if (hid() !== householdId || !document.getElementById('home-board')) return;
  if (onlyChanged && JSON.stringify([events, chores, notes]) === JSON.stringify([D.events, D.chores, D.notes])) return;
  const expandedEntries = [...document.querySelectorAll('#home-board details[open]')].map((el) => el.dataset.boardEntry);
  const drafts = [...document.querySelectorAll('#home-board form')].map((form) => ({ kind: form.dataset.form, id: form.dataset.id, message: form.elements.namedItem('messageText')?.value ?? '', eventId: form.elements.namedItem('eventId')?.value ?? '' }));
  D = { ...D, events, chores, notes, items: scheduleItems(events, chores, tz()) };
  document.getElementById('home-board').innerHTML = householdBoard({ ...D, compact: widgetSize('board') === 'compact', archive: homeBoardArchive });
  document.querySelectorAll('#home-board details').forEach((el) => { el.open = expandedEntries.includes(el.dataset.boardEntry); });
  for (const form of document.querySelectorAll('#home-board form')) {
    const draft = drafts.find((d) => d.kind === form.dataset.form && d.id === form.dataset.id);
    if (!draft) continue;
    form.elements.namedItem('messageText').value = draft.message;
    const eventField = form.elements.namedItem('eventId'); if (eventField) eventField.value = draft.eventId;
  }
  const content = document.getElementById('home-schedule-content');
  if (content) content.innerHTML = content.dataset.view === 'calendar' ? calendarView() : listView();
  fitHomeWidgets(document.querySelector('.home-dashboard'));
}
actions['home-board-response'] = async (button) => {
  const card = button.closest('article');
  card.setAttribute('aria-busy', 'true');
  const buttons = [...card.querySelectorAll('button')];
  buttons.forEach((el) => { el.disabled = true; });
  showError(card, '');
  const kind = button.dataset.kind, id = Number(button.dataset.id), answer = button.dataset.response;
  try {
    if (kind === 'event') await api(`/households/${D.householdId}/events/${id}/respond`, { method: 'POST', body: { response: answer } });
    else await api(`/households/${D.householdId}/swap-requests/${id}`, { method: 'PATCH', body: { action: answer } });
  } catch (error) { showError(card, error.message); return; }
  finally { card.removeAttribute('aria-busy'); buttons.forEach((el) => { el.disabled = false; }); }
  toast(answer === 'withdraw' ? 'Request cancelled' : 'Response saved');
  try { await refreshHomeBoard(); } catch { card.innerHTML = '<p class="hint" role="status">Response saved. Refresh Home to see the latest requests.</p>'; }
};
actions['home-board-filter'] = (button) => {
  homeBoardArchive = button.dataset.archive === 'true';
  renderWidgetSize('board');
};
actions['home-board-resolve'] = async (button) => {
  const article = button.closest('article');
  const buttons = [...article.querySelectorAll('button')];
  article.setAttribute('aria-busy', 'true');
  buttons.forEach((el) => { el.disabled = true; });
  showError(article, '');
  try {
    await api(`/households/${D.householdId}/board/${button.dataset.id}`, { method: 'PATCH', body: { isResolved: button.dataset.resolved === 'true' } });
  } catch (error) {
    showError(article, error.status === 500
      ? 'Could not update this announcement. The board database may need migration 0003 applied.'
      : error.message);
    article.removeAttribute('aria-busy');
    buttons.forEach((el) => { el.disabled = false; });
    return;
  }
  article.removeAttribute('aria-busy');
  buttons.forEach((el) => { el.disabled = false; });
  toast(button.dataset.resolved === 'true' ? 'Announcement moved to the resolved archive' : 'Announcement reopened');
  try { await refreshHomeBoard(); } catch { toast('Saved. Refresh Home to see the updated board.'); }
};
actions['home-make-announcement'] = () => openModal(`${mhead('Make announcement')}${announcementForm(D.events)}`);
const postHomeNote = async (form, reply) => {
  const data = new FormData(form), body = { messageText: data.get('messageText') };
  if (reply) body.parentMessageId = Number(form.dataset.id);
  else if (data.get('eventId')) body.eventId = Number(data.get('eventId'));
  try { await api(`/households/${D.householdId}/board`, { method: 'POST', body }); }
  catch (error) { showError(form, error.message); return; }
  form.reset(); if (!reply) closeModal(); toast(reply ? 'Reply posted' : 'Announcement posted');
  try { await refreshHomeBoard(); } catch { if (form.isConnected) showError(form, 'Posted successfully. Refresh Home to see the latest announcements.'); else toast('Posted successfully. Refresh Home to see the latest announcements.'); }
};
forms['home-note-new'] = (form) => postHomeNote(form, false);
forms['home-note-reply'] = (form) => postHomeNote(form, true);

// Like the Events board, refresh while idle; never interrupt editing or an in-flight response.
setInterval(async () => {
  if (widgetDrag || document.hidden || document.getElementById('root')?.dataset.page !== 'home' || !D || document.getElementById('modal')) return;
  if (document.activeElement?.closest?.('form,input,textarea,select,button') || document.querySelector('#home-board [aria-busy=true]')) return;
  try { await refreshHomeBoard(true); } catch { /* Keep the last snapshot while offline. */ }
}, 15000);

actions['home-chore-detail'] = (button) => openChoreDetails(D.householdId, Number(button.dataset.id));

function saveLayout() {
  try { localStorage.setItem(layoutKey(), JSON.stringify(layout)); }
  catch { toast('Layout changed for this visit. Your browser could not save it.'); }
}
function applyLayout(focusWidget, focusSelector) {
  const grid = document.querySelector('.home-dashboard');
  if (!grid) return;
  for (const { id, size } of layout) {
    const widget = grid.querySelector(`.home-widget[data-widget="${id}"]`);
    widget.className = `home-widget ${size}`;
    widget.dataset.column = layout.find((w) => w.id === id).column ?? '';
    widget.dataset.editing = String(editing);
    grid.appendChild(widget);
  }
  fitHomeWidgets(grid);
  if (focusWidget) grid.querySelector(`.home-widget[data-widget="${focusWidget}"] ${focusSelector}`)?.focus();
}
actions['home-edit-layout'] = (button) => {
  editing = !editing;
  button.textContent = editing ? 'Done' : 'Edit dashboard';
  document.querySelector('.home-layout-status').textContent = '';
  applyLayout();
};
function renderWidgetSize(id) {
  if (id === 'schedule') {
    const content = document.getElementById('home-schedule-content');
    content.innerHTML = content.dataset.view === 'calendar' ? calendarView() : listView();
  }
  if (id === 'board') {
    const board = document.getElementById('home-board');
    const drafts = [...board.querySelectorAll('form')].map((form) => ({ id: form.dataset.id, value: form.elements.namedItem('messageText')?.value }));
    const opened = [...board.querySelectorAll('details[open]')].map((el) => el.dataset.boardEntry);
    board.innerHTML = householdBoard({ ...D, compact: widgetSize(id) === 'compact', archive: homeBoardArchive });
    board.querySelectorAll('details').forEach((el) => { el.open = opened.includes(el.dataset.boardEntry); });
    for (const form of board.querySelectorAll('form')) {
      const draft = drafts.find((d) => d.id === form.dataset.id);
      if (draft) form.elements.namedItem('messageText').value = draft.value;
    }
  }
}
actions['home-widget-move'] = (button) => {
  const index = layout.findIndex((w) => w.id === button.dataset.widget), target = index + Number(button.dataset.step);
  if (index < 0 || target < 0 || target >= layout.length) return;
  const destination = layout[target];
  const [widget] = layout.splice(index, 1);
  const changedSize = widget.size !== destination.size;
  widget.size = destination.size; widget.column = destination.column;
  layout.splice(target, 0, widget);
  if (changedSize) renderWidgetSize(widget.id);
  saveLayout(); applyLayout(widget.id, '[data-widget-drag]');
};
// Pointer events provide one live preview for mouse, pen, and touch.
let widgetDrag = null;
function arrangeWidgets() {
  const grid = document.querySelector('.home-dashboard');
  if (!grid) return;
  for (const { id } of layout) {
    const widget = grid.querySelector(`.home-widget[data-widget="${id}"]`);
    if (widget) {
      widget.classList.toggle('compact', widgetSize(id) === 'compact');
      widget.classList.toggle('expanded', widgetSize(id) === 'expanded');
      widget.dataset.column = layout.find((w) => w.id === id).column ?? '';
      grid.appendChild(widget);
    }
  }
  fitHomeWidgets(grid);
}
function finishWidgetDrag(cancel = false) {
  const drag = widgetDrag;
  if (!drag) return;
  widgetDrag = null;
  cancelAnimationFrame(drag.frame);
  if (cancel) { const changedSize = widgetSize(drag.id) !== drag.original.find((w) => w.id === drag.id).size; layout = drag.original; if (changedSize) renderWidgetSize(drag.id); arrangeWidgets(); }
  else if (drag.active) saveLayout();
  drag.ghost?.remove(); drag.widget.classList.remove('home-widget-dragging');
  document.body.classList.remove('home-is-dragging');
  drag.grip = drag.widget.querySelector('[data-widget-drag]') ?? drag.grip;
  if (drag.grip.hasPointerCapture?.(drag.pointerId)) drag.grip.releasePointerCapture(drag.pointerId);
  drag.grip.focus({ preventScroll: true });
  const status = document.querySelector('.home-layout-status');
  if (status && drag.active) status.textContent = cancel ? 'Move cancelled.' : `${widgetNames[drag.id]} moved. Layout saved.`;
}
function previewWidgetMove(x, y) {
  const drag = widgetDrag;
  if (!drag?.active || !drag.widget.isConnected) return;
  drag.ghost.style.transform = `translate(${x - drag.offsetX}px, ${y - drag.offsetY}px)`;
  const grid = drag.widget.parentElement;
  const styles = getComputedStyle(grid);
  const columns = styles.gridTemplateColumns.split(' ').filter(Boolean).length;
  const bounds = grid.getBoundingClientRect();
  const snapshot = [...grid.children].filter((el) => el.classList.contains('home-widget')).map((el) => {
    const rect = el.getBoundingClientRect();
    const column = bounds.width ? Math.round((rect.left - bounds.left) / bounds.width * columns) + 1 : 1;
    return { id: el.dataset.widget, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, column, span: Math.min(columns, widgetSize(el.dataset.widget) === 'expanded' ? 2 : 1) };
  });
  const target = document.elementFromPoint(x, y)?.closest('.home-widget');
  const slot = widgetDropSlot(bounds, snapshot, drag.id, x, y, columns);
  const moving = layout.find((w) => w.id === drag.id);
  if (slot) {
    const size = slot.span > 1 ? 'expanded' : 'compact';
    if (size !== moving.size) {
      moving.size = size; renderWidgetSize(moving.id);
      fitHomeWidgets(grid);
      drag.grip = drag.widget.querySelector('[data-widget-drag]') ?? drag.grip;
      drag.ghost.innerHTML = drag.widget.innerHTML;
      drag.ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    }
    moving.column = slot.column;
    drag.ghost.classList.toggle('compact', size === 'compact'); drag.ghost.classList.toggle('expanded', size === 'expanded');
    const gap = Number.parseFloat(styles.columnGap) || 18;
    drag.ghost.style.width = `${(bounds.width - gap * (columns - 1)) / columns * slot.span + gap * (slot.span - 1)}px`;
  }
  const targetId = slot?.targetId ?? (target?.parentElement === grid && target !== drag.widget ? target.dataset.widget : null);
  if (targetId) {
    const from = layout.findIndex((w) => w.id === drag.id), to = layout.findIndex((w) => w.id === targetId);
    if (from >= 0 && to >= 0 && from !== to) {
      const targetBounds = snapshot.find((w) => w.id === targetId);
      const [widget] = layout.splice(from, 1);
      const targetIndex = layout.findIndex((w) => w.id === targetId);
      const insertion = slot ? targetIndex + (targetBounds && y >= targetBounds.top && y > (targetBounds.top + targetBounds.bottom) / 2 ? 1 : 0) : to;
      layout.splice(insertion, 0, widget);
    }
  }
  arrangeWidgets();
  drag.grip.setPointerCapture?.(drag.pointerId);
}
document.addEventListener('pointerdown', (event) => {
  const grip = event.target.closest?.('[data-widget-drag]');
  if (!editing || !grip || event.button !== 0 || widgetDrag || document.querySelector('#home-board [aria-busy=true]')) return;
  const widget = grip.closest('.home-widget'), rect = widget.getBoundingClientRect();
  widgetDrag = { id: grip.dataset.widgetDrag, grip, widget, pointerId: event.pointerId, original: layout.map((w) => ({ ...w })), startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, active: false };
  grip.setPointerCapture?.(event.pointerId);
});
document.addEventListener('pointermove', (event) => {
  const drag = widgetDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
  if (!drag.active) {
    drag.active = true;
    const rect = drag.widget.getBoundingClientRect();
    drag.ghost = drag.widget.cloneNode(true);
    drag.ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    drag.ghost.className = `home-widget ${widgetSize(drag.id)} home-widget-ghost`;
    drag.ghost.setAttribute('aria-hidden', 'true'); drag.ghost.inert = true;
    drag.ghost.style.width = `${rect.width}px`;
    document.body.appendChild(drag.ghost);
    drag.widget.classList.add('home-widget-dragging');
    document.body.classList.add('home-is-dragging');
    const scroll = () => {
      if (widgetDrag !== drag || !drag.widget.isConnected) { if (widgetDrag === drag) finishWidgetDrag(true); return; }
      const speed = drag.y < 70 ? -12 : drag.y > window.innerHeight - 70 ? 12 : 0;
      if (speed) { window.scrollBy(0, speed); previewWidgetMove(drag.x, drag.y); }
      drag.frame = requestAnimationFrame(scroll);
    };
    drag.frame = requestAnimationFrame(scroll);
  }
  event.preventDefault(); previewWidgetMove(drag.x, drag.y);
}, { passive: false });
document.addEventListener('pointerup', (event) => { if (event.pointerId === widgetDrag?.pointerId) finishWidgetDrag(); });
document.addEventListener('pointercancel', () => finishWidgetDrag(true));
window.addEventListener('blur', () => finishWidgetDrag(true));
window.addEventListener('hashchange', () => finishWidgetDrag(true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && widgetDrag) { event.preventDefault(); finishWidgetDrag(true); return; }
  const grip = event.target.closest?.('[data-widget-drag]');
  if (widgetDrag || !editing || !grip || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  actions['home-widget-move']({ dataset: { widget: grip.dataset.widgetDrag, step: ['ArrowUp', 'ArrowLeft'].includes(event.key) ? '-1' : '1' } });
  document.querySelector(`.home-widget[data-widget="${grip.dataset.widgetDrag}"] [data-widget-drag]`)?.focus();
  document.querySelector('.home-layout-status').textContent = `${widgetNames[grip.dataset.widgetDrag]} moved. Layout saved.`;
});

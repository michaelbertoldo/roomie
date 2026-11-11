import { esc } from '../lib/dom.js';

// All schedules use the same two rows, regardless of card width or page.
export function scheduleToolbar({ title, monthAction, viewInput, view, calendarValue = 'calendar', filters = '', showMonthNav = true }) {
  // Home shows a fixed two-week window, so it passes showMonthNav: false and gets a heading only.
  const nav = showMonthNav
    ? `<button class="btn s" data-action="${monthAction}" data-n="-1" aria-label="Previous month">‹</button><div class="row"><h2>${esc(title)}</h2></div><button class="btn s" data-action="${monthAction}" data-n="1" aria-label="Next month">›</button>`
    : `<div class="row"><h2>${esc(title)}</h2></div>`;
  return `<div class="home-schedule-toolbar"><div class="month-nav">${nav}</div><div class="schedule-display-controls"><select class="input home-view-select" data-input="${viewInput}" aria-label="Schedule view"><option value="${calendarValue}" ${view === calendarValue ? 'selected' : ''}>Calendar view</option><option value="list" ${view === 'list' ? 'selected' : ''}>List view</option></select>${filters ? `<details class="schedule-filter-menu"><summary class="btn s">Filtering options</summary><div class="schedule-filter-panel">${filters}</div></details>` : ''}</div></div>`;
}


// Native disclosure controls support touch and keyboard without a second settings page.
document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll('.schedule-filter-menu[open]')) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('.schedule-filter-menu[open]');
  if (!menu) return;
  event.preventDefault(); menu.open = false; menu.querySelector('summary').focus();
});

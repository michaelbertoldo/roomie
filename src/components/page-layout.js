// Keep every page's panels inside one rectangle. Content never determines a slot's height.
let observer;
const supported = new Set(['home', 'calendar', 'chores', 'finances', 'household', 'appearance', 'settings']);
export function sizePageFrame(frame) {
  if (!frame?.isConnected) return;
  const top = frame.getBoundingClientRect().top + window.scrollY;
  const height = Math.max(360, Math.floor(window.innerHeight - top - 24));
  const value = `${height}px`;
  if (frame.style.getPropertyValue('--panel-height') !== value) frame.style.setProperty('--panel-height', value);
}
export function connectPageLayout(page) {
  observer?.disconnect();
  const root = document.getElementById('page');
  if (!root || !supported.has(page)) return;
  let frame = root.querySelector(':scope > .boxed-frame, :scope > .home-dashboard, :scope > .page-content, :scope > .stack');
  if (!frame) {
    const cards = [...root.children].filter(el => el.matches('.card'));
    if (!cards.length) return;
    frame = document.createElement('div');
    cards[0].before(frame); frame.append(...cards);
  }
  frame.classList.add('boxed-frame');
  frame.dataset.framePage = page;
  // Keep standalone actions (e.g. Sign out) outside the content rectangle.
  for (const actions of [...frame.children].filter(el => el.matches('.acts'))) frame.after(actions);
  const prepare = () => {
    // These wrappers group related panels, without adding another scrolling layer.
    for (const wrapper of frame.querySelectorAll(':scope > .finance-summary, :scope > .grid2')) wrapper.classList.add('panel-contents');
    for (const column of frame.querySelectorAll(':scope > .chore-schedule-column, :scope > .chore-attention-board, :scope > .event-board-column')) {
      column.classList.add('panel-column');
      column.style.setProperty('--panel-count', String(column.querySelectorAll(':scope > .card').length));
    }
    const cards = [...frame.querySelectorAll('.card')].filter(card => !card.parentElement.closest('.card'));
    if (!['home', 'calendar', 'chores'].includes(page)) {
      const columns = cards.length === 4 ? 2 : Math.min(3, cards.length);
      frame.style.setProperty('--panel-columns', String(Math.max(1, columns)));
      for (const card of cards) card.style.removeProperty('grid-column');
      if (cards.length && page !== 'appearance') cards.at(-1).style.gridColumn = `span ${columns - ((cards.length - 1) % columns)}`;
    }
    for (const card of cards) {
      card.classList.add('scroll-panel');
      card.tabIndex = 0;
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', card.querySelector('h2, h3')?.textContent.trim() || 'Page section');
    }
    sizePageFrame(frame);
  };
  prepare();
  observer = new MutationObserver(prepare);
  observer.observe(root, { childList: true, subtree: true });
}
window.addEventListener('resize', () => document.querySelectorAll('.boxed-frame').forEach(sizePageFrame));

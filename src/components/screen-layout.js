// Size the desktop dashboard to the space below the page header.
let observer;
let pending;
function sizeDashboard() {
  const frame = document.querySelector('#page > .home-dashboard, #page > .split.cal');
  if (!frame) return;
  const top = frame.getBoundingClientRect().top + window.scrollY;
  const height = Math.max(0, Math.floor(window.innerHeight - top - 64));
  frame.style.setProperty('--dashboard-height', `${height}px`);
}
function scheduleSize() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(sizeDashboard);
}
export function connectScreenLayout(page) {
  observer?.disconnect();
  if (!['home', 'calendar', 'chores'].includes(page)) return;
  const root = document.getElementById('page');
  if (!root) return;
  sizeDashboard();
  observer = new MutationObserver(scheduleSize);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}
window.addEventListener('resize', scheduleSize);

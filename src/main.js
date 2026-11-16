import { connectPageLayout } from './components/page-layout.js';
import { applyAppearance } from './lib/appearance.js';
import './styles.css';
import { api, getToken, signOut } from './auth-client.js';
import { actions, forms, inputs } from './lib/events.js';
import { $, ico, mark, closeModal, esc, showError, toast } from './lib/dom.js';
import { S, needsOnboarding, resetState } from './lib/state.js';
import { authView, isPasswordReset } from './pages/auth.js';
import { onboardingView } from './pages/onboarding.js';
import { settingsView } from './pages/settings.js';
import { appearanceView } from './pages/appearance.js';
import { householdView } from './pages/household.js';
import { financesView } from './pages/finances.js';
import { choresView } from './pages/chores.js';
import { calendarView } from './pages/calendar.js';
import { bellHtml, loadAlerts, openActivityPanel, openPendingActivity, paintBell } from './pages/notifications.js';
import { homeView } from './pages/home.js';
import { openPendingCalendarCreate } from './lib/calendar-create.js';
import { connectHomeLayout } from './components/home-layout.js';
import { soonView } from './pages/soon.js';
import { householdSwitcherHtml } from './components/household-switcher.js';

const NAV = [
  ['home', 'home', 'Home'],
  ['calendar', 'calendar', 'Events'],
  ['chores', 'check', 'Chores'],
  ['finances', 'money', 'Finances'],
  ['household', 'users', 'Household'],
  ['appearance', 'settings', 'Appearance']
];
// Real pages register here as each slice lands; everything else shows the "coming next" card.
export const pages = { appearance: appearanceView, settings: settingsView, household: householdView, finances: financesView, chores: choresView, calendar: calendarView, home: homeView };

const root = $('#root');
const route = () => { const r = location.hash.replace(/^#\/?/, '').split('/')[0]; return r === 'settings' || NAV.some(([k]) => k === r) ? r : 'home'; };
const loading = `<div class="page-skeleton" aria-label="Loading page" aria-busy="true"><div class="sk sk-title"></div><div class="sk sk-sub"></div>
  <div class="sk-grid"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div></div>`;

async function loadMe() {
  const me = await api('/me');
  S.user = me.user; S.households = me.households;
  const saved = Number(localStorage.getItem('roomie.hid'));
  if (!S.households.some((h) => h.householdId === S.hid)) S.hid = S.households.find((h) => h.householdId === saved)?.householdId ?? S.households[0]?.householdId ?? null;
  if (S.hid) localStorage.setItem('roomie.hid', String(S.hid));
}

function shell(page, body) {
  const items = NAV.map(([k, i, l]) => `<a href="#/${k}" class="nav-i ${k === page ? 'on' : ''}" ${k === page ? 'aria-current="page"' : ''}>${ico(i, 19)}<span>${l}</span></a>`).join('');
  applyAppearance();
  const account = S.user.profilePhoto ? `<img class="acct-photo" src="${esc(S.user.profilePhoto)}" alt="" referrerpolicy="no-referrer">` : esc(((S.user.firstName || '?')[0]).toUpperCase());
  return `<div class="shell"><div class="main">
    <header class="top"><div class="brand"><a class="brand-home" href="/#/home" aria-label="Roomie home">${mark()}</a>${householdSwitcherHtml()}</div>
      <div class="row" style="gap:10px">${bellHtml()}
      <button class="iconbtn acct" data-action="account" aria-label="Your profile and household">${account}</button></div></header>
    <nav class="pillnav" aria-label="Main">${items}</nav>
    <main class="page" id="page">${body}</main></div>
    <nav class="tabbar" aria-label="Main">${items}</nav></div>`;
}

let seq = 0;
export async function render() {
  const mine = ++seq;
  try {
    if (isPasswordReset()) { root.innerHTML = authView(); return; }
    if (!(await getToken())) { resetState(); applyAppearance(); root.innerHTML = authView(); return; }
    if (!S.user) { root.innerHTML = loading; await loadMe(); }
    if (mine !== seq) return;
    applyAppearance();
    if (needsOnboarding()) { root.removeAttribute('data-page'); root.innerHTML = await onboardingView(); return; }
    const legacyActivity = location.hash.replace(/^#\/?/, '').split('/')[0] === 'notifications';
    if (legacyActivity) history.replaceState(null, '', '#/home');
    const page = route();
    await loadAlerts().catch(() => {});
    const keep = $('#page') && root.dataset.page === page && root.dataset.hid === String(S.hid); // soft refresh keeps the shell
    if (!keep) root.innerHTML = shell(page, loading);
    const body = pages[page] ? await pages[page]() : soonView(page);
    if (mine !== seq) return;
    root.dataset.page = page; root.dataset.hid = String(S.hid);
    if (keep) { $('#page').innerHTML = body; paintBell(); } else root.innerHTML = shell(page, body);
    connectHomeLayout();
    connectPageLayout(page);
    openPendingCalendarCreate(page);
    openPendingActivity(page);
    if (legacyActivity) await openActivityPanel();
  } catch (e) {
    if (mine !== seq) return;
    if (e.status === 401) { resetState(); root.innerHTML = authView(); return; }
    root.innerHTML = `<div class="onb"><div class="box"><section class="card stack"><h2>Something went wrong</h2><p class="mute">${esc(e.message)}</p><button class="btn p" data-action="retry">Try again</button></section></div></div>`;
  }
}

// ---- events: one delegated listener for clicks and one for forms ---------------------------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  const fn = el && actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (err) { toast(err.message || 'Something went wrong'); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest?.('[data-action][tabindex="0"]');
  if (!row || e.target.closest('button,a,input,select,textarea')) return;
  e.preventDefault(); row.click();
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  const fn = form && forms[form.dataset.form];
  if (!fn) return;
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  form.setAttribute('aria-busy', 'true'); if (btn) btn.disabled = true;
  showError(form, '');
  try { await fn(form, e); } catch (err) { showError(form, err.message || 'Something went wrong'); }
  finally { form.removeAttribute('aria-busy'); if (btn) btn.disabled = form.dataset.saved === '1'; delete form.dataset.saved; }
});

for (const type of ['input', 'change']) document.addEventListener(type, (e) => {
  const el = e.target.closest?.('[data-input]');
  const fn = el && inputs[el.dataset.input];
  if (fn) try { fn(el, e); } catch (err) { console.error(err); }
});

actions['close-modal'] = () => closeModal();
actions.retry = () => render();
actions.signout = async () => { closeModal(); await signOut(); resetState(); localStorage.removeItem('roomie.hid'); location.hash = ''; render(); };
actions.account = () => {
  closeModal();

  if (location.hash === '#/settings') {
    render();
  } else {
    location.hash = '#/settings';
  }
};

window.addEventListener('hashchange', render);
window.addEventListener('roomie:render', render);
window.addEventListener('roomie:profile-saved', () => {
  const account = document.querySelector('.acct');
  if (account) account.innerHTML = S.user.profilePhoto
    ? `<img class="acct-photo" src="${esc(S.user.profilePhoto)}" alt="" referrerpolicy="no-referrer">`
    : esc(((S.user.firstName || '?')[0]).toUpperCase());
});
window.addEventListener('roomie:signedin', () => { resetState(); render(); });
window.addEventListener('roomie:reload', async () => { S.user = null; await render(); });

render();

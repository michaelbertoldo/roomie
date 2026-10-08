import './styles.css';
import { api, getToken, signOut } from './auth-client.js';
import { actions, forms, inputs } from './lib/events.js';
import { $, ico, mark, avatar, closeModal, esc, fullName, mhead, openModal, showError, toast } from './lib/dom.js';
import { S, household, resetState } from './lib/state.js';
import { authView } from './pages/auth.js';
import { onboardingView } from './pages/onboarding.js';
import { settingsView } from './pages/settings.js';
import { financesView } from './pages/finances.js';
import { choresView } from './pages/chores.js';
import { soonView } from './pages/soon.js';

const NAV = [['home', 'home', 'Home'], ['calendar', 'calendar', 'Calendar'], ['finances', 'money', 'Finances'], ['chores', 'check', 'Chores'], ['settings', 'settings', 'Settings']];
// Real pages register here as each slice lands; everything else shows the "coming next" card.
export const pages = { settings: settingsView, finances: financesView, chores: choresView };

const root = $('#root');
const route = () => { const r = location.hash.replace(/^#\/?/, '').split('/')[0]; return NAV.some(([k]) => k === r) ? r : 'finances'; };
const loading = '<div class="loading"><div class="spin" aria-label="Loading"></div></div>';

async function loadMe() {
  const me = await api('/me');
  S.user = me.user; S.households = me.households;
  const saved = Number(localStorage.getItem('roomie.hid'));
  if (!S.households.some((h) => h.householdId === S.hid)) S.hid = S.households.find((h) => h.householdId === saved)?.householdId ?? S.households[0]?.householdId ?? null;
  if (S.hid) localStorage.setItem('roomie.hid', String(S.hid));
}

function shell(page, body) {
  const h = household();
  const items = NAV.map(([k, i, l]) => `<a href="#/${k}" class="nav-i ${k === page ? 'on' : ''}" ${k === page ? 'aria-current="page"' : ''}>${ico(i, 19)}<span>${l}</span></a>`).join('');
  document.documentElement.style.setProperty('--accent', h.themeColor || '#4338ca');
  return `<div class="shell"><div class="main">
    <header class="top"><div class="brand">${mark()}<div class="grow"><b>Roomie</b><small class="truncate">${esc(h.householdName)}</small></div></div>
      <div class="row" style="gap:10px"><a href="#/notifications" class="iconbtn" aria-label="Notifications">${ico('bell', 19)}</a>
      <button class="iconbtn" data-action="account" aria-label="Your account">${avatar(S.user)}</button></div></header>
    <nav class="pillnav" aria-label="Main">${items}</nav>
    <main class="page" id="page">${body}</main></div>
    <nav class="tabbar" aria-label="Main">${items}</nav></div>`;
}

let seq = 0;
export async function render() {
  const mine = ++seq;
  try {
    if (!(await getToken())) { resetState(); root.innerHTML = authView(); return; }
    if (!S.user) { root.innerHTML = loading; await loadMe(); }
    if (mine !== seq) return;
    if (!S.households.length) { root.innerHTML = onboardingView(); return; }
    const page = route();
    const keep = $('#page') && root.dataset.page === page; // soft refresh keeps the shell
    if (!keep) root.innerHTML = shell(page, loading);
    const body = pages[page] ? await pages[page]() : soonView(page);
    if (mine !== seq) return;
    root.dataset.page = page;
    if (keep) $('#page').innerHTML = body; else root.innerHTML = shell(page, body);
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
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  const fn = form && forms[form.dataset.form];
  if (!fn) return;
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  showError(form, '');
  try { await fn(form, e); } catch (err) { showError(form, err.message || 'Something went wrong'); }
  finally { if (btn) btn.disabled = false; }
});

for (const type of ['input', 'change']) document.addEventListener(type, (e) => {
  const el = e.target.closest?.('[data-input]');
  const fn = el && inputs[el.dataset.input];
  if (fn) try { fn(el, e); } catch (err) { console.error(err); }
});

actions['close-modal'] = () => closeModal();
actions.retry = () => render();
actions.signout = async () => { closeModal(); await signOut(); resetState(); localStorage.removeItem('roomie.hid'); location.hash = ''; render(); };
actions.account = () => openModal(`${mhead('Your account')}
  <div class="item row">${avatar(S.user)}<div class="grow"><b>${esc(fullName(S.user))}</b><div class="mute" style="font-size:13px">${esc(S.user.email)}</div></div></div>
  <div class="acts"><button class="btn d" data-action="signout">Sign out</button></div>`);

window.addEventListener('hashchange', render);
window.addEventListener('roomie:render', render);
window.addEventListener('roomie:signedin', () => { resetState(); render(); });
window.addEventListener('roomie:reload', async () => { S.user = null; await render(); });

render();

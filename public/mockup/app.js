/* Roomie mockup: core, onboarding, home, notifications, profile, calendar */
const PAGES = {}, MODALS = {}, A = {};
const ONB = ['signin', 'welcome', 'profile-setup', 'choose', 'new-house', 'invite', 'join'];
const COLORS = { indigo: '#4338ca', teal: '#0d9488', rose: '#e11d48', amber: '#d97706', violet: '#7c3aed', sky: '#0284c7' };
let S = seed();
const UI = { fin: 'settle', cv: 'my', cf: 'all', cs: 'due', calV: 'week', calP: 'all', calC: 'all', anchor: TODAY, older: false, exportTries: 0, up: false, invite: null, dark: false, modal: null, joinedCode: null, email: '' };

/* ---------- utils ---------- */
const v = id => { const e = document.getElementById(id); return e ? e.value : ''; };
const chk = id => { const e = document.getElementById(id); return !!(e && e.checked); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const U = id => S.users[id];
const C = id => S.chores.find(c => c.id === id);
const P = id => S.purchases.find(p => p.id === id);
const E = id => S.events.find(e => e.id === id);
const name = id => (id === S.me ? 'You' : U(id).first);
const pd = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = pd(iso); d.setDate(d.getDate() + n); return fmt(d); };
const lbl = iso => pd(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const short = iso => pd(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const tm = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const others = () => S.order.filter(i => i !== S.me);
const isOwner = () => U(S.me).role === 'owner';
const canManage = () => isOwner() || U(S.me).manage;

const av = (id, sz = '') => { const u = U(id); if (!u) return ''; return u.photo ? `<img class="av ${sz}" src="${u.photo}" alt="">` : `<span class="av ${sz}" style="background:${u.color}">${esc((u.first || '?')[0])}</span>`; };
const phead = (eb, t, sub, act = '') => `<div class="ph"><div><div class="eyebrow">${eb}</div><h1>${t}</h1>${sub ? `<p class="mute">${sub}</p>` : ''}</div>${act ? `<div class="row" style="flex-wrap:wrap">${act}</div>` : ''}</div>`;
const badge = (t, k = '') => `<span class="badge ${k}">${t}</span>`;
const empty = (ic, t, s, btn = '') => `<div class="empty"><div style="font-size:34px">${ic}</div><b>${t}</b><p class="mute" style="font-size:14px">${s}</p>${btn}</div>`;
const seg = (opts, cur, fn, full = '') => `<div class="seg ${full}" role="tablist">${opts.map(([k, l]) => `<button role="tab" class="${k === cur ? 'on' : ''}" onclick="${fn}('${k}')">${l}</button>`).join('')}</div>`;
const field = (id, label, attrs = '', val = '') => `<label class="fld"><span>${label}</span><input id="${id}" class="input" value="${esc(val)}" ${attrs}></label>`;
const mhead = t => `<div class="mh"><h3>${t}</h3><button class="x" onclick="A.close()" aria-label="Close">✕</button></div>`;
const errBox = '<div id="err" class="err" role="alert"></div>';

function fail(errs) {
  document.querySelectorAll('.input.bad').forEach(e => e.classList.remove('bad'));
  errs.forEach(e => { const el = document.getElementById(e.id); if (el) el.classList.add('bad'); });
  const b = document.getElementById('err');
  if (b) b.innerHTML = errs.map(e => '• ' + e.msg).join('<br>');
  return false;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'tst'; t.textContent = msg;
  document.getElementById('toast').appendChild(t); setTimeout(() => t.remove(), 2800);
}

/* ---------- icons, ring, motion helpers ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.3c-.5-.8-1.4-1.3-2.6-1.3-1.4 0-2.6.7-2.6 1.9 0 2.6 5.2 1.3 5.2 4 0 1.2-1.2 2-2.6 2-1.2 0-2.2-.5-2.8-1.4M12 6.5V8m0 8v1.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.4 2.6 2.6 5-5.4"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16v4M17 18h4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
};
const ico = (n, s = 22) => `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const mark = (cls = '') => `<span class="mark ${cls}">${ico('home', cls ? 30 : 18)}</span>`;
const ring = (pct, txt, sub) => `<div class="ringw"><svg viewBox="0 0 80 80" class="ring"><circle cx="40" cy="40" r="34" class="rt"/><circle cx="40" cy="40" r="34" class="rf" style="--p:${pct}"/></svg><div class="rc"><b>${txt}</b><span>${sub}</span></div></div>`;
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateCounts() {
  if (reduced()) return;
  document.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, t0 = performance.now(), d = 900;
    const step = t => { const k = Math.min((t - t0) / d, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = money(Math.round(to * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function confetti(x, y) {
  if (reduced()) return;
  const cols = [COLORS[S.house.color] || '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#38bdf8'];
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('div'); el.className = 'cf'; el.style.cssText = `left:${x}px;top:${y}px;background:${cols[i % 5]}`;
    document.body.appendChild(el);
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 110;
    el.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r + 70}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }], { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => el.remove();
  }
}

/* ---------- money helpers ---------- */
function outstanding() {
  const r = [];
  S.purchases.forEach(p => Object.entries(p.shares).forEach(([uid, s]) => { if (uid !== p.buyer && s.status !== 'paid') r.push({ p, uid, amt: s.amt, status: s.status }); }));
  return r;
}
const net = (a, b) => outstanding().reduce((t, o) => (o.p.buyer === a && o.uid === b ? t + o.amt : o.p.buyer === b && o.uid === a ? t - o.amt : t), 0);
const youOwe = () => outstanding().filter(o => o.uid === S.me).reduce((t, o) => t + o.amt, 0);
const owedToMe = () => outstanding().filter(o => o.p.buyer === S.me).reduce((t, o) => t + o.amt, 0);
const rentShare = () => (S.order.length ? Math.round(S.rent.amount / S.order.length) : 0);

/* ---------- router / render ---------- */
const route = () => { const h = (location.hash.slice(2) || 'signin').split('/'); return { p: h[0], a: h.slice(1) }; };
function render() {
  const y = window.scrollY, r = route(), fn = PAGES[r.p] || PAGES.home, enter = UI.enter;
  const body = fn(r), root = document.getElementById('root');
  root.innerHTML = (ONB.includes(r.p) ? `<div class="onb"><div class="box">${body}</div></div>` : shell(r.p, body)) + modalHTML();
  root.classList.toggle('enter', !!enter); UI.enter = false;
  applyTheme(); window.scrollTo(0, y);
  if (enter) animateCounts();
}
function shell(p, body) {
  const sec = { ledger: 'finances', chore: 'chores', members: 'settings' }[p] || p;
  const nav = [['home', 'home', 'Home'], ['calendar', 'calendar', 'Calendar'], ['finances', 'money', 'Finances'], ['chores', 'check', 'Chores'], ['settings', 'settings', 'Settings']];
  const unread = S.notifs.filter(n => n.unread && !n.dismissed).length;
  const items = nav.map(([k, i, l]) => `<a href="#/${k}" class="nav-i ${sec === k ? 'on' : ''}" ${sec === k ? 'aria-current="page"' : ''}>${ico(i, 21)}<span>${l}</span></a>`).join('');
  return `<div class="shell">
  <div class="main"><header class="top"><div class="brand">${mark()}<div class="grow"><b>Roomie</b><small class="truncate">${esc(S.house.name)}</small></div></div><div class="row" style="gap:10px">
  <a href="#/notifications" class="iconbtn" aria-label="Notifications, ${unread} unread">${ico('bell', 19)}${unread ? `<i class="dot">${unread}</i>` : ''}</a>
  <a href="#/profile" aria-label="My profile">${av(S.me)}</a></div></header>
  <nav class="pillnav" aria-label="Main">${items}</nav>
  <main class="page">${body}</main></div><nav class="tabbar" aria-label="Main">${items}</nav></div>`;
}
function modalHTML() {
  const m = UI.modal; if (!m) { UI.shown = false; return ''; }
  const fresh = !UI.shown; UI.shown = true;
  return `<div class="ovl ${fresh ? 'pop' : ''}" onclick="if(event.target===this)A.close()"><div class="sheet" role="dialog" aria-modal="true">${MODALS[m.t](m.d || {})}</div></div>`;
}
function applyTheme() {
  document.documentElement.classList.toggle('dark', UI.dark);
  document.documentElement.style.setProperty('--accent', COLORS[S.house.color] || COLORS.indigo);
}
function boot() {
  try { UI.dark = localStorage.getItem('roomie-dark') === '1'; } catch (e) { }
  if (!location.hash) location.hash = '#/signin';
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); UI.enter = true; render(); });
  UI.enter = true; render();
  setTimeout(() => { // simulated live update on the board
    if (S.posts.length && S.order.includes('u3') && !S.livePosted) {
      S.livePosted = true;
      S.posts.unshift({ id: 'b' + Date.now(), by: 'u3', when: 'Just now', text: 'Friends are bringing snacks Friday, no need to buy any.', ev: null, replies: [] });
      toast('New post from Jake'); if (route().p === 'home') render();
    }
  }, 14000);
}
A.modal = (t, d) => { UI.modal = { t, d }; render(); };
A.close = () => { UI.modal = null; render(); };
A.go = h => { UI.modal = null; location.hash = h; if (route().p && location.hash === h) render(); };
A.theme = d => { UI.dark = d; try { localStorage.setItem('roomie-dark', d ? '1' : '0'); } catch (e) { } render(); };
A.accent = k => { S.house.color = k; render(); };
A.copy = t => { try { navigator.clipboard.writeText(t); } catch (e) { } toast('Link copied to clipboard'); };
MODALS.confirm = d => `${mhead(d.title)}<p>${d.body}</p>${d.warn ? `<div class="note">${d.warn}</div>` : ''}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p ${d.danger ? 'd' : ''}" onclick="${d.on}">${d.ok || 'Confirm'}</button></div>`;
MODALS.info = d => `${mhead(d.title)}<p>${d.body}</p><div class="acts"><button class="btn p" onclick="A.close()">OK</button></div>`;

/* ---------- 1. sign in / up ---------- */
PAGES.signin = () => `${mark("lg")}<div style="text-align:center"><h1 style="font-size:30px;font-weight:700;letter-spacing:-.03em">Roomie</h1><p class="mute">Chores, costs, and plans for your house.</p></div>
${UI.invite ? `<div class="ok">You’re joining a household via invite. Sign in or create an account to continue.</div>` : ''}
<div class="card stack">${seg([['in', 'Sign in'], ['up', 'Create account']], UI.up ? 'up' : 'in', 'A.mode', 'full')}
${field('em', 'Email', 'type="email" autocomplete="username" placeholder="you@school.edu"', UI.email)}
${field('pw', 'Password', 'type="password" autocomplete="' + (UI.up ? 'new-password' : 'current-password') + '" placeholder="At least 6 characters"')}
${errBox}
<button class="btn p" onclick="A.auth()">${UI.up ? 'Create account' : 'Sign in'}</button>
<div class="row sp"><button class="btn link" onclick="A.modal('forgot')">Forgot password?</button><span class="mute" style="font-size:12px">Your device can save this password</span></div>
<div class="row"><hr class="hr grow"><span class="mute" style="font-size:12px">or</span><hr class="hr grow"></div>
<button class="btn" onclick="A.sso('Google')">Continue with Google</button><button class="btn" onclick="A.sso('Apple')">Continue with Apple</button></div>
<p class="mute" style="font-size:12px;text-align:center">Demo: password “wrong” fails sign in; email “taken@example.com” is already in use.<br>
<a class="btn link" href="#/join/MAPLE-4821" onclick="UI.invite=null">Open invite link (signed in)</a>
<button class="btn link" onclick="UI.invite='MAPLE-4821';UI.up=true;render()">Open invite link (no account)</button></p>`;
A.mode = k => { UI.up = k === 'up'; UI.email = v('em'); render(); };
A.sso = p => { toast('Signed in with ' + p); A.afterAuth(); };
A.auth = () => {
  const em = v('em').trim(), pw = v('pw'), errs = [];
  UI.email = em;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) errs.push({ id: 'em', msg: 'Enter a valid email address.' });
  else if (UI.up && em.toLowerCase() === 'taken@example.com') errs.push({ id: 'em', msg: 'That email is already in use. Try signing in.' });
  if (pw.length < 6) errs.push({ id: 'pw', msg: 'Password must be at least 6 characters.' });
  else if (!UI.up && pw === 'wrong') errs.push({ id: 'pw', msg: 'Wrong password. Try again or reset it.' });
  if (errs.length) return fail(errs);
  A.afterAuth();
};
A.afterAuth = () => {
  if (UI.up || UI.newAcct) {
    S = emptySeed(['u1']); Object.assign(S.users.u1, { first: '', last: '', nick: '', phone: '', email: UI.email, venmo: '', location: '', allergies: '', photo: null });
    UI.newAcct = true; location.hash = '#/welcome';
  } else { S = seed(); UI.invite ? (location.hash = '#/join/' + UI.invite) : (location.hash = '#/home'); }
};
MODALS.forgot = () => `${mhead('Reset password')}<p class="mute">We’ll email you a reset link.</p>${field('fe', 'Email', 'type="email"', UI.email)}${errBox}<div class="acts"><button class="btn p" onclick="/@/.test(v('fe'))?(A.close(),toast('Reset link sent')):fail([{id:'fe',msg:'Enter a valid email.'}])">Send link</button></div>`;

/* ---------- 2. welcome ---------- */
PAGES.welcome = () => `<div class="orbit"><div class="core">${mark('lg')}</div>
<div class="o"><i>${ico('check', 22)}</i></div><div class="o"><i>${ico('money', 22)}</i></div><div class="o"><i>${ico('chat', 22)}</i></div></div>
<div style="text-align:center"><h1 style="font-size:28px;font-weight:700;letter-spacing:-.03em">Welcome to your shared space</h1><p class="mute" style="margin-top:6px">Shared chores, split costs, and one place to talk. No more buried group texts.</p></div>
<button class="btn p" onclick="location.hash='#/profile-setup'">Continue</button><button class="btn link" onclick="location.hash='#/profile-setup'">Skip</button>`;

/* ---------- 3. create profile ---------- */
PAGES['profile-setup'] = () => {
  const u = U(S.me);
  return `<div><p class="mute" style="font-size:13px">Step 1 of 2</p><h1 style="font-size:26px;font-weight:800">Create your profile</h1><p class="mute">This is how roommates will recognize you.</p></div>
<div class="card stack"><div class="row"><div id="photoPrev">${av(S.me, 'xl')}</div><div class="stack" style="gap:6px"><label class="btn s" style="display:inline-block">Add photo<input type="file" accept="image/*" hidden onchange="A.photo(this)"></label><span class="mute" style="font-size:12px">JPG or PNG, up to 5 MB</span></div></div>
<div id="perr" class="err"></div>
${field('fn', 'First name (required)', 'autocomplete="given-name"', u.first)}${field('ln', 'Last name (optional)', '', u.last)}${field('lo', 'Location (optional)', 'placeholder="City, State"', u.location)}${errBox}
<button class="btn p" onclick="A.saveProfileSetup()">Continue</button><p class="mute" style="font-size:12px">You can edit all of this later in your profile.</p></div>`;
};
A.photo = inp => {
  const f = inp.files[0], pe = document.getElementById('perr'); if (!f) return;
  if (!/^image\/(jpeg|png)$/.test(f.type)) { pe.innerHTML = 'Wrong format. Please choose a JPG or PNG and try again.'; return; }
  if (f.size > 5 * 1024 * 1024) { pe.innerHTML = 'That photo is too large (max 5 MB). Pick a smaller one to retry.'; return; }
  pe.innerHTML = ''; const r = new FileReader();
  r.onload = () => { U(S.me).photo = r.result; document.getElementById('photoPrev').innerHTML = av(S.me, 'xl'); };
  r.readAsDataURL(f);
};
A.saveProfileSetup = () => {
  if (!v('fn').trim()) return fail([{ id: 'fn', msg: 'First name is required.' }]);
  Object.assign(U(S.me), { first: v('fn').trim(), last: v('ln').trim(), location: v('lo').trim() });
  location.hash = UI.invite ? '#/join/' + UI.invite : '#/choose';
};

/* ---------- 4. create or join ---------- */
PAGES.choose = () => `<div><p class="mute" style="font-size:13px">Step 2 of 2</p><h1 style="font-size:26px;font-weight:800">Set up your household</h1></div>
<button class="opt" onclick="location.hash='#/new-house'"><span style="font-size:30px">🏠</span><b style="font-size:18px">Create a new household</b><span class="mute">Start a space and invite your roommates.</span></button>
<button class="opt" onclick="location.hash='#/join'"><span style="font-size:30px">🔑</span><b style="font-size:18px">Join an existing household</b><span class="mute">Use an invite link or code from a roommate.</span></button>`;

/* ---------- 5. new household ---------- */
PAGES['new-house'] = () => `<div><button class="btn link" onclick="history.back()">← Back</button><h1 style="font-size:26px;font-weight:800">Name your household</h1></div>
<div class="card stack">${field('hn', 'Household name (required)', 'placeholder="e.g. 412 Maple St"', UI.newName || '')}
<div class="fld"><span>Theme color</span><div class="row" style="flex-wrap:wrap">${Object.entries(COLORS).map(([k, c]) => `<button class="sw ${S.house.color === k ? 'on' : ''}" style="background:${c}" aria-label="${k}" onclick="UI.newName=v('hn');A.accent('${k}')"></button>`).join('')}</div></div>
<details><summary class="btn s" style="display:inline-block">Optional details</summary><div class="stack" style="margin-top:12px">
<label class="btn s" style="display:inline-block;width:fit-content">House photo<input type="file" accept="image/*" hidden onchange="toast('Photo added')"></label>
${field('ad1', 'Street')}<div class="grid2">${field('ad2', 'City')}${field('ad3', 'Postcode')}</div>${field('ad4', 'Country')}${field('ll', 'Owner / landlord contact')}</div></details>
${errBox}<button class="btn p" onclick="A.createHouse()">Create household</button><p class="mute" style="font-size:12px">You’ll be the household owner. Skip details now and add them in Settings.</p></div>`;
A.createHouse = () => {
  const n = v('hn').trim(); if (!n) return fail([{ id: 'hn', msg: 'Household name is required.' }]);
  const addr = [v('ad1'), v('ad2'), v('ad3'), v('ad4')].filter(Boolean).join(', ');
  Object.assign(S.house, { name: n, address: addr, landlord: v('ll'), code: 'HOME-' + Math.floor(1000 + Math.random() * 9000) });
  S.users.u1.role = 'owner'; UI.newName = ''; location.hash = '#/invite';
};

/* ---------- 6. invite roommates ---------- */
const inviteLink = () => `https://roomie.app/join/${S.house.code}`;
PAGES.invite = () => {
  const full = S.order.length >= 9;
  return `<div><h1 style="font-size:26px;font-weight:800">Invite your roommates</h1><p class="mute">Send the link or code. They’ll join ${esc(S.house.name)} after signing in.</p></div>
<div class="card stack"><div class="fld"><span>Invite link</span><div class="row"><input class="input grow" readonly value="${inviteLink()}"><button class="btn" ${full ? 'disabled' : ''} onclick="A.copy('${inviteLink()}')">Copy</button></div></div>
<div class="fld"><span>Join code</span><div class="row"><b style="font-size:22px;letter-spacing:2px" class="grow">${S.house.code}</b><button class="btn" ${full ? 'disabled' : ''} onclick="A.copy('${S.house.code}')">Copy</button></div></div>
${full ? '<div class="note">Your household is full (owner + 8 roommates). Remove someone to invite more.</div>' : ''}
<button class="btn p" ${full ? 'disabled' : ''} onclick="A.modal('share')">Share invite</button></div>
<div class="card"><div class="row sp"><h2>Members (${S.order.length} of 9)</h2>${full ? '' : '<button class="btn s" onclick="A.simJoin()">Demo: a roommate joins</button>'}</div>
${S.order.map(i => `<div class="item row">${av(i)}<div class="grow"><b>${esc(U(i).first || 'You')} ${esc(U(i).last)}</b></div>${badge(U(i).role === 'owner' ? 'Owner' : 'Joined', U(i).role === 'owner' ? '' : 'good')}</div>`).join('')}</div>
<button class="btn ${S.order.length > 1 ? 'p' : ''}" onclick="location.hash='#/home'">${S.order.length > 1 ? 'Go to Home' : 'Skip for now'}</button>`;
};
A.simJoin = () => {
  const n = S.order.length; if (n >= 9) return;
  let id = ['u2', 'u3', 'u4'].find(x => !S.order.includes(x));
  if (!id) { id = 'u' + (n + 1); S.users[id] = { id, first: EXTRA[n - 4], last: '', color: '#64748b', role: 'member', venmo: '', zelle: '', apple: '', phone: '', email: '', location: '', allergies: '', nick: '', manage: false }; }
  S.order.push(id); toast(U(id).first + ' joined'); render();
};
MODALS.share = () => `${mhead('Share invite')}<textarea class="input" rows="4" readonly>Hey! I set up ${esc(S.house.name)} on Roomie so we can sort chores, split costs, and plan the house in one place. Join here: ${inviteLink()} (code ${S.house.code})</textarea>
<div class="acts"><button class="btn" onclick="A.close();toast('Opening Messages…')">Messages</button><button class="btn" onclick="A.close();toast('Opening WhatsApp…')">WhatsApp</button><button class="btn p" onclick="A.close();toast('Opening share sheet…')">More…</button></div>`;

/* ---------- 7. join ---------- */
const checkCode = c => { c = c.trim().toUpperCase(); return c === 'MAPLE-4821' ? 'ok' : c === 'FULL-9999' ? 'full' : c === 'USED-0001' ? 'dup' : 'bad'; };
const JOIN_MSG = { bad: 'That code is invalid or has expired.', full: 'That household is full (9 of 9).', dup: 'You’re already a member of that household.' };
A.joinHouse = () => {
  const prof = U(S.me); const keep = { first: prof.first, last: prof.last, location: prof.location, photo: prof.photo, email: prof.email };
  S = seed(); Object.assign(S.users.u1, keep.first ? keep : { email: keep.email || S.users.u1.email }); S.users.u1.role = 'member';
};
PAGES.join = r => {
  const c = r.a[0];
  if (c) {
    const res = checkCode(c);
    if (res === 'ok') {
      if (UI.joinedCode !== c) { A.joinHouse(); UI.joinedCode = c; UI.invite = null; }
      return `<div class="hero">🎉</div><div class="card stack" style="text-align:center"><h1 style="font-size:24px;font-weight:800">You joined ${esc(S.house.name)}</h1>
      <div class="row" style="justify-content:center">${av('u2', 'lg')}</div><p class="mute">Invited by Priya Shah · ${S.order.length} members</p><button class="btn p" onclick="location.hash='#/home'">Go to Home</button></div>`;
    }
    return `<div class="hero">⚠️</div><div class="card stack" style="text-align:center"><h1 style="font-size:22px;font-weight:800">${c === 'bad' || res === 'bad' ? 'Invalid invite link' : 'Can’t join'}</h1><p>${JOIN_MSG[res]}</p><p class="mute" style="font-size:13px">You haven’t been added to any household.</p><button class="btn p" onclick="location.hash='#/join'">Enter a code instead</button></div>`;
  }
  return `<div><button class="btn link" onclick="history.back()">← Back</button><h1 style="font-size:26px;font-weight:800">Join a household</h1><p class="mute">Enter the code from your roommate.</p></div>
<div class="card stack">${field('jc', 'Household code', 'placeholder="e.g. MAPLE-4821" autocapitalize="characters"')}${errBox}<button class="btn p" onclick="A.tryJoin()">Join</button>
<p class="mute" style="font-size:12px">Demo codes: MAPLE-4821 (valid), FULL-9999 (full), USED-0001 (already member), anything else (invalid). <a class="btn link" href="#/join/bad">Open a bad invite link</a></p></div>`;
};
A.tryJoin = () => {
  const c = v('jc').trim(); if (!c) return fail([{ id: 'jc', msg: 'Enter a household code.' }]);
  const res = checkCode(c); if (res !== 'ok') return fail([{ id: 'jc', msg: JOIN_MSG[res] }]);
  location.hash = '#/join/' + c.toUpperCase();
};

/* ---------- 8. home ---------- */
const pendingForMe = () => ({
  swaps: S.chores.filter(c => c.swap && c.swap.status === 'pending' && C(c.swap.toChore) && C(c.swap.toChore).assignee === S.me),
  hosts: S.events.filter(e => e.host && e.by !== S.me && e.host.responses[S.me] == null),
});
const weekDays = () => { const a = UI.anchor, dow = (pd(a).getDay() + 6) % 7, s = addDays(a, -dow); return [...Array(7)].map((_, i) => addDays(s, i)); };
const W = {
  events: { t: 'This week’s events', l: '#/calendar', b: () => { const wk = weekDays(), ev = S.events.filter(e => wk.includes(e.date)); return ev.length ? ev.map(e => `<div class="item click" onclick="A.openEvent('${e.id}')"><b>${esc(e.name)}</b><div class="mute" style="font-size:13px">${lbl(e.date)} ${tm(e.time)}</div></div>`).join('') : '<p class="mute">Nothing planned this week.</p>'; } },
  chores: { t: 'My upcoming chores', l: '#/chores', b: () => { const m = S.chores.filter(c => c.assignee === S.me && c.status !== 'done').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3); return m.length ? m.map(c => `<div class="item click row sp" onclick="location.hash='#/chore/${c.id}'"><b>${esc(c.name)}</b><span class="mute" style="font-size:13px">${short(c.date)}</span></div>`).join('') : '<p class="mute">No chores yet. Add your first one.</p>'; } },
  owe: { t: 'You owe / are owed', l: '#/finances', b: () => `<div class="row sp"><div><div class="mute" style="font-size:12px">You owe</div><b class="bad" style="font-size:22px">${money(youOwe())}</b></div><div style="text-align:right"><div class="mute" style="font-size:12px">You’re owed</div><b class="good" style="font-size:22px">${money(owedToMe())}</b></div></div>` },
  rent: { t: 'Rent', l: '#/finances', b: () => S.rent.amount ? `<b style="font-size:22px">${money(rentShare())}</b> <span class="mute">your share</span><div class="mute" style="font-size:13px">Due ${lbl(S.rent.due)} · ${S.rent.paid[S.me] ? badge('Paid', 'good') : badge('Unpaid', 'warn')}</div>` : '<p class="mute">No rent set up yet.</p>' },
  buy: { t: 'Buy requests', l: '#/finances', b: () => { const n = S.wish.needs.slice(0, 3); return n.length ? n.map(w => `<div class="item row sp"><span>${esc(w.name)}</span><span class="mute">est. ${money(w.est)}</span></div>`).join('') : '<p class="mute">Nothing needed right now.</p>'; } },
  featured: { t: 'Featured event', l: '#/calendar', b: () => { const e = S.events.find(x => x.featured); return e ? `<div class="feat">🎂</div><b style="display:block;margin-top:8px">${esc(e.name)}</b><span class="mute" style="font-size:13px">${lbl(e.date)} ${tm(e.time)}</span>` : '<p class="mute">No featured event.</p>'; } },
  upcomingpay: { t: 'Upcoming payments', l: '#/finances', b: () => `<div class="item row sp"><span>Rent share</span><b>${money(rentShare())}</b></div>${S.subs.map(s => `<div class="item row sp"><span>${esc(s.name)} · ${short(s.due)}</span><b>${money(Math.round(s.amount / Math.max(S.order.length, 1)))}</b></div>`).join('')}` },
  important: { t: 'Important reminders', l: '#/calendar', b: () => { const n = S.notes.filter(x => x.urgent); return n.length ? n.map(x => `<div class="item">⚠️ ${esc(x.text)} <span class="mute">(${short(x.date)})</span></div>`).join('') : '<p class="mute">No urgent notes.</p>'; } },
};
PAGES.home = () => {
  const me = U(S.me), pend = pendingForMe(), feed = S.notifs.filter(n => !n.dismissed && !n.homeCleared && n.kind === 'info').slice(0, 4);
  const acts = pend.swaps.map(c => `<div class="item row t">${av(c.swap.from)}<div class="grow"><b>${name(c.swap.from)}</b> asked to swap <b>${esc(c.name)}</b> for your <b>${esc(C(c.swap.toChore).name)}</b><div class="mute" style="font-size:13px">“${esc(c.swap.reason || 'No reason given')}”</div><div class="acts" style="justify-content:flex-start;margin-top:6px"><button class="btn p s" onclick="A.swapAnswer('${c.id}',true)">Accept</button><button class="btn s" onclick="A.swapAnswer('${c.id}',false)">Decline</button></div></div></div>`).join('')
    + pend.hosts.map(e => `<div class="item row t">${av(e.by)}<div class="grow"><b>${name(e.by)}</b> wants to host <b>${e.host.guests} guests</b> ${lbl(e.date)}, ${tm(e.host.from)} to ${tm(e.host.to)}. Okay with you?<div class="acts" style="justify-content:flex-start;margin-top:6px"><button class="btn p s" onclick="A.hostRespond('${e.id}','agree')">Yes</button><button class="btn s" onclick="A.hostRespond('${e.id}','no')">No</button></div></div></div>`).join('');
  const wk = weekDays(), nEv = S.events.filter(e => wk.includes(e.date)).length, od = S.chores.filter(c => c.status === 'overdue').length;
  const widgets = S.widgets.filter(w => w.on).map(w => `<section class="card"><div class="row sp" style="margin-bottom:6px"><h2>${W[w.id].t}</h2><a class="btn link" href="${W[w.id].l}">Open</a></div>${W[w.id].b()}</section>`).join('');
  return `${phead(esc(S.house.name) + ' · ' + lbl(TODAY), 'Hey, ' + esc(me.first || 'there'), '', '<button class="btn" onclick="A.modal(\'widgets\')">Customize widgets</button>')}
<div class="split"><div class="stack">${heroCard()}${S.chores.length + S.purchases.length + S.events.length === 0 ? `<section class="card">${empty('🌱', 'Your house is ready', 'No chores yet. Add your first one.', '<a class="btn p" href="#/chores">Add a chore</a>')}</section>` : `
<section class="card ai"><h2 class="row" style="gap:8px">${ico('sparkle', 18)}This week in the house <span class="badge gray">AI summary</span></h2><p class="mute" style="margin-top:6px">${nEv} event${nEv === 1 ? '' : 's'} this week, ${od} overdue chore${od === 1 ? '' : 's'}, and ${S.purchases.filter(p => Object.values(p.shares).some(s => s.status !== 'paid')).length} shared purchases still being settled. You owe ${money(youOwe())} and are owed ${money(owedToMe())}.</p></section>`}
${acts ? `<section class="card"><h2>Needs your answer</h2>${acts}</section>` : ''}
<div class="grid2"><section class="card"><div class="row sp"><h2>Recent activity</h2>${feed.length ? '<button class="btn link" onclick="A.clearHome()">Clear</button>' : ''}</div>
${feed.length ? feed.map(n => `<div class="item row t click" onclick="A.openNotif('${n.id}')">${n.who ? av(n.who, 'sm') : '<span class="av sm" style="background:#64748b">!</span>'}<div class="grow"><span>${n.who ? '<b>' + name(n.who) + '</b> ' : ''}${n.text}</span><div class="mute" style="font-size:12px">${n.when}</div></div></div>`).join('') : '<p class="mute" style="padding:8px 0">All caught up. Cleared items stay in your <a class="btn link" href="#/notifications">notification history</a>.</p>'}</section>
${board()}</div>
<div class="grid2">${widgets || empty('🧩', 'No widgets', 'Add some with Customize widgets.')}</div></div>
<aside class="stack">${sideBalances()}${comingUp()}</aside></div>`;
};
function sideBalances() {
  const o = others(); if (!o.length) return '';
  return `<section class="card"><div class="row sp"><h2>Balances</h2>${badge(o.length + (o.length === 1 ? ' roommate' : ' roommates'))}</div>${o.map(i => { const n = net(S.me, i); return `<div class="item row click" onclick="location.hash='#/ledger/${i}'">${av(i)}<b class="grow">${name(i)}</b><b class="${n > 0 ? 'good' : n < 0 ? 'bad' : 'mute'}">${n > 0 ? '+' : ''}${money(n)}</b></div>`; }).join('')}<a class="btn wide" href="#/finances" style="margin-top:14px">Settle up ›</a></section>`;
}
function comingUp(title = 'Coming up', n = 4) {
  const up = S.events.filter(e => e.date >= TODAY).sort((x, y) => x.date.localeCompare(y.date) || (x.time || '').localeCompare(y.time || '')).slice(0, n);
  return `<section class="card"><div class="row sp"><h2>${title}</h2>${title === 'Coming up' ? '<a class="btn link" href="#/calendar">Calendar ›</a>' : badge(up.length + ' item' + (up.length === 1 ? '' : 's'))}</div>${up.length ? up.map(e => `<div class="item row click" onclick="A.openEvent('${e.id}')"><span class="tile">${short(e.date)}</span><div class="grow"><b>${esc(e.name)}</b><div class="mute" style="font-size:13px">${tm(e.time)}</div></div></div>`).join('') : '<p class="mute" style="padding:8px 0">Nothing scheduled.</p>'}</section>`;
}
function heroCard() {
  if (!S.chores.length && !S.purchases.length) return '';
  const bal = owedToMe() - youOwe(), mine = S.chores.filter(c => c.assignee === S.me), done = mine.filter(c => c.status === 'done').length, pct = mine.length ? Math.round(done / mine.length * 100) : 0;
  return `<section class="card hero-card"><div class="row sp"><div><div class="eyebrow">Net balance</div><div class="big ${bal >= 0 ? 'good' : 'bad'}" data-count="${bal}">${money(bal)}</div>
<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><span class="pillstat">You owe <b data-count="${youOwe()}">${money(youOwe())}</b></span><span class="pillstat">Owed <b data-count="${owedToMe()}">${money(owedToMe())}</b></span></div></div>
${mine.length ? ring(pct, done + '/' + mine.length, 'my chores') : ''}</div></section>`;
}
function board() {
  return `<section class="card stack"><div class="row sp"><h2>House bulletin board</h2><button class="btn p s" onclick="A.modal('newPost',{type:'text'})">New post</button></div>
${S.posts.length ? S.posts.map(p => `<div class="item"><div class="row t">${av(p.by, 'sm')}<div class="grow"><b>${name(p.by)}</b> <span class="mute" style="font-size:12px">${p.when}</span><div>${esc(p.text)}</div>
${p.ev && E(p.ev) ? `<button class="chip" style="margin-top:4px" onclick="A.openEvent('${p.ev}')">📅 ${esc(E(p.ev).name)}</button>` : ''}
${p.replies.map(r => `<div class="bubble" style="margin-top:6px"><b>${name(r.by)}</b> ${esc(r.text)}</div>`).join('')}
<div class="row" style="margin-top:6px"><input id="rp-${p.id}" class="input" placeholder="Reply…" style="min-height:36px"><button class="btn s" onclick="A.reply('${p.id}')">Send</button></div></div>
${p.by === S.me ? `<div class="row" style="gap:2px"><button class="btn link" onclick="A.modal('newPost',{edit:'${p.id}',type:'text'})">Edit</button><button class="btn link bad" onclick="A.modal('confirm',{title:'Remove post?',body:'This removes your post for everyone.',on:&quot;A.delPost('${p.id}')&quot;,danger:1,ok:'Remove'})">Remove</button></div>` : ''}</div></div>`).join('') : empty('💬', 'No posts yet', 'Say hi or announce a plan.')}</section>`;
}
A.clearHome = () => { S.notifs.forEach(n => { if (n.kind === 'info') n.homeCleared = true; }); render(); };
A.reply = id => { const t = v('rp-' + id).trim(); if (!t) return; const p = S.posts.find(x => x.id === id); p.replies.push({ by: S.me, when: 'Just now', text: t }); toast(p.by === S.me ? 'Reply posted' : name(p.by) + ' was notified'); render(); };
A.delPost = id => { S.posts = S.posts.filter(p => p.id !== id); A.close(); toast('Post removed'); };
MODALS.newPost = d => {
  const ed = d.edit && S.posts.find(p => p.id === d.edit), t = d.type;
  return `${mhead(ed ? 'Edit post' : 'New post')}
${ed ? '' : `<div class="row" style="flex-wrap:wrap">${[['text', 'Simple text'], ['hosting', 'I’m hosting guests'], ['heads', 'Heads up']].map(([k, l]) => `<button class="chip ${t === k ? 'on' : ''}" onclick="A.modal('newPost',{type:'${k}'})">${l}</button>`).join('')}</div>`}
${t === 'hosting' && !ed ? `<div class="grid2">${field('hg', 'Number of guests', 'type="number" min="1"')}${field('hd', 'Date', 'type="date"', TODAY)}${field('hf', 'From', 'type="time" value="19:00"')}${field('ht', 'To', 'type="time" value="22:00"')}</div>` : ''}
<label class="fld"><span>${t === 'hosting' && !ed ? 'Note (optional)' : 'Message'}</span><textarea id="pt" class="input" rows="3" placeholder="What’s the plan?">${ed ? esc(ed.text) : ''}</textarea></label>
${ed || t === 'hosting' ? '' : `<label class="fld"><span>Link to a calendar event (optional)</span><select id="pe" class="input"><option value="">None</option>${S.events.map(e => `<option value="${e.id}">${esc(e.name)} · ${short(e.date)}</option>`).join('')}</select></label>`}
${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.post(${d.edit ? `'${d.edit}'` : 'null'},'${t}')">${ed ? 'Save' : t === 'hosting' ? 'Ask roommates' : 'Post'}</button></div>`;
};
A.post = (edit, t) => {
  const txt = v('pt').trim();
  if (edit) { if (!txt) return fail([{ id: 'pt', msg: 'Message can’t be empty.' }]); S.posts.find(p => p.id === edit).text = txt; A.close(); return toast('Post updated'); }
  if (t === 'hosting') {
    const errs = [];
    if (!(+v('hg') >= 1)) errs.push({ id: 'hg', msg: 'Enter the number of guests.' });
    if (!v('hd')) errs.push({ id: 'hd', msg: 'Pick a date.' });
    if (!v('hf') || !v('ht')) errs.push({ id: 'hf', msg: 'Pick a hosting time period.' });
    if (errs.length) return fail(errs);
    const responses = {}; S.order.forEach(i => responses[i] = i === S.me ? 'agree' : null);
    const e = { id: 'e' + Date.now(), name: `${U(S.me).first} hosting (${v('hg')} guests)`, date: v('hd'), time: v('hf'), cat: 'hosting', desc: txt, link: '', by: S.me, host: { guests: +v('hg'), from: v('hf'), to: v('ht'), responses } };
    S.events.push(e); S.posts.unshift({ id: 'b' + Date.now(), by: S.me, when: 'Just now', text: `Hosting ${v('hg')} guests ${lbl(e.date)}, ${tm(e.host.from)} to ${tm(e.host.to)}. ${txt}`, ev: e.id, replies: [] });
    A.close(); return toast('Roommates notified and asked to agree or disagree');
  }
  if (!txt) return fail([{ id: 'pt', msg: 'Message can’t be empty.' }]);
  S.posts.unshift({ id: 'b' + Date.now(), by: S.me, when: 'Just now', text: txt, ev: v('pe') || null, replies: [] }); A.close(); toast('Posted. Roommates see it right away.');
};
A.hostRespond = (eid, a) => {
  if (a === 'no') return A.modal('disagree', { eid });
  E(eid).host.responses[S.me] = 'agree'; UI.modal = null; toast('You agreed. ' + name(E(eid).by) + ' was notified.'); render();
};
MODALS.disagree = d => `${mhead('Not okay with it?')}<p class="mute">Send ${name(E(d.eid).by)} a short message.</p><textarea id="dm" class="input" rows="3" placeholder="e.g. I have an exam Saturday morning"></textarea>${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.sendDisagree('${d.eid}')">Send</button></div>`;
A.sendDisagree = eid => { const m = v('dm').trim(); if (!m) return fail([{ id: 'dm', msg: 'Add a short message.' }]); const e = E(eid); e.host.responses[S.me] = 'disagree'; e.host.msgs = { ...(e.host.msgs || {}), [S.me]: m }; UI.modal = null; toast('Message sent to ' + name(e.by)); render(); };
MODALS.widgets = () => `${mhead('Customize widgets')}<p class="mute" style="font-size:13px">Only you see your layout.</p>${S.widgets.map((w, i) => `<div class="item row"><input type="checkbox" class="tog" ${w.on ? 'checked' : ''} onchange="A.wOn(${i})" aria-label="${W[w.id].t}"><span class="grow">${W[w.id].t}</span><button class="btn s" ${i === 0 ? 'disabled' : ''} onclick="A.wMove(${i},-1)" aria-label="Move up">↑</button><button class="btn s" ${i === S.widgets.length - 1 ? 'disabled' : ''} onclick="A.wMove(${i},1)" aria-label="Move down">↓</button></div>`).join('')}<div class="acts"><button class="btn p" onclick="A.close()">Done</button></div>`;
A.wOn = i => { S.widgets[i].on = !S.widgets[i].on; render(); };
A.wMove = (i, d) => { const w = S.widgets; [w[i], w[i + d]] = [w[i + d], w[i]]; render(); };

/* ---------- 9. notifications ---------- */
const GROUPS = ['Chores', 'Money', 'Events & Hosting', 'Board'];
function notifActions(n) {
  if (n.kind === 'swap') { const c = C(n.ref), st = c && c.swap && c.swap.status; return st === 'pending' ? `<button class="btn p s" onclick="A.swapAnswer('${n.ref}',true)">Accept</button><button class="btn s" onclick="A.swapAnswer('${n.ref}',false)">Decline</button>` : badge(st === 'accepted' ? 'Accepted' : 'Declined', 'gray'); }
  if (n.kind === 'host') { const e = E(n.ref), r = e && e.host.responses[S.me]; return r == null ? `<button class="btn p s" onclick="A.hostRespond('${n.ref}','agree')">Agree</button><button class="btn s" onclick="A.hostRespond('${n.ref}','no')">Disagree</button>` : badge(r === 'agree' ? 'You agreed' : 'You disagreed', 'gray'); }
  if (n.kind === 'claim') { const [pid, uid] = n.ref.split(':'), p = P(pid), s = p && p.shares[uid]; if (!s) return ''; return s.status === 'claimed' ? `<button class="btn p s" onclick="A.confirmPay('${pid}','${uid}')">Yes, received</button><button class="btn s" onclick="A.denyPay('${pid}','${uid}')">Not received</button>` : badge(s.status === 'paid' ? 'Confirmed' : 'Marked not received', 'gray'); }
  return '';
}
PAGES.notifications = () => {
  const all = S.notifs.filter(n => !n.dismissed), vis = all.filter(n => UI.older || n.age <= 7), older = all.length - all.filter(n => n.age <= 7).length;
  const unread = all.filter(n => n.unread).length;
  return `<div class="ph"><h1>Notifications ${unread ? badge(unread + ' unread') : ''}</h1><button class="btn" onclick="A.markAll()">Mark all read</button></div>
${vis.length ? GROUPS.map(g => { const l = vis.filter(n => n.group === g); return `<section class="card"><h2>${g}</h2>${l.length ? l.map(n => `<div class="item row t ${n.unread ? 'unread' : ''}" style="padding:12px 8px;border-radius:12px">
${n.who ? av(n.who) : '<span class="av" style="background:#64748b">!</span>'}<div class="grow click" onclick="A.openNotif('${n.id}')"><div>${n.who ? '<b>' + name(n.who) + '</b> ' : ''}${n.text}</div><div class="mute" style="font-size:12px">${n.who ? 'from ' + name(n.who) + ' · ' : ''}${n.when}</div><div class="acts" style="justify-content:flex-start;margin-top:6px" onclick="event.stopPropagation()">${notifActions(n)}</div></div>
${n.unread ? '<span class="udot" title="Unread"></span>' : ''}<button class="x" aria-label="Dismiss" onclick="A.dismiss('${n.id}')">✕</button></div>`).join('') : '<p class="mute" style="padding:8px 0">Nothing here.</p>'}</section>`; }).join('') : `<section class="card">${empty('🔔', 'You’re all caught up', 'Activity that involves you shows up here.')}</section>`}
${!UI.older && older ? `<button class="btn" onclick="UI.older=true;render()">Load older (${older})</button>` : ''}`;
};
A.markAll = () => { S.notifs.forEach(n => n.unread = false); render(); };
A.dismiss = id => { S.notifs.find(n => n.id === id).dismissed = true; render(); };
A.openNotif = id => {
  const n = S.notifs.find(x => x.id === id); n.unread = false;
  if (n.kind === 'deleted') return A.modal('info', { title: 'Item no longer available', body: 'The post this refers to was deleted by its author.' });
  if (n.kind === 'swap') return (location.hash = '#/chore/' + n.ref);
  if (n.kind === 'host') return A.openEvent(n.ref);
  if (n.kind === 'claim') return A.modal('purchase', { id: n.ref.split(':')[0] });
  location.hash = n.route || '#/home'; render();
};

/* ---------- 10. my profile ---------- */
PAGES.profile = () => {
  const u = U(S.me);
  return `<div class="ph"><h1>My profile</h1><a class="btn" href="#/settings">Settings</a></div>
<section class="card stack"><div class="row"><div id="photoPrev">${av(S.me, 'xl')}</div><div><label class="btn s" style="display:inline-block">Change photo<input type="file" accept="image/*" hidden onchange="A.photo(this)"></label><div class="mute" style="font-size:13px;margin-top:6px">🏠 ${esc(S.house.name)} · ${u.role === 'owner' ? 'Owner' : 'Member'}</div></div></div><div id="perr" class="err"></div>
<div class="grid2">${field('fn', 'First name', '', u.first)}${field('ln', 'Last name', '', u.last)}${field('nk', 'Nickname', '', u.nick)}${field('lo', 'Location', '', u.location)}${field('ph', 'Phone', 'type="tel" placeholder="(512) 555-0100"', u.phone)}${field('mail', 'Email', 'type="email"', u.email)}</div>
${field('al', 'Allergies', 'placeholder="Roommates will see this"', u.allergies)}
<h2>How to pay me</h2><div class="grid2">${field('vn', 'Venmo', 'placeholder="@username"', u.venmo)}${field('zl', 'Zelle (email or phone)', '', u.zelle)}${field('ap', 'Apple Cash (phone)', '', u.apple)}
<label class="fld"><span>Preferred</span><select id="pf" class="input">${['', 'Venmo', 'Zelle', 'Apple Cash'].map(o => `<option ${u.pref === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label></div>
${errBox}<button class="btn p" onclick="A.saveProfile()">Save changes</button></section>`;
};
A.saveProfile = () => {
  const errs = [], ph = v('ph').trim(), vn = v('vn').trim(), zl = v('zl').trim(), ap = v('ap').trim(), digits = s => s.replace(/\D/g, '').length;
  if (!v('fn').trim()) errs.push({ id: 'fn', msg: 'First name is required.' });
  if (ph && (digits(ph) < 10 || /[a-z]/i.test(ph))) errs.push({ id: 'ph', msg: 'Phone number must have at least 10 digits.' });
  if (vn && !/^@[\w.-]{3,}$/.test(vn)) errs.push({ id: 'vn', msg: 'Venmo handle should look like @username.' });
  if (zl && !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(zl) || (digits(zl) >= 10 && !/[a-z]/i.test(zl)))) errs.push({ id: 'zl', msg: 'Zelle needs an email or a 10-digit phone.' });
  if (ap && (digits(ap) < 10 || /[a-z]/i.test(ap))) errs.push({ id: 'ap', msg: 'Apple Cash needs a 10-digit phone number.' });
  if (errs.length) return fail(errs);
  Object.assign(U(S.me), { first: v('fn').trim(), last: v('ln').trim(), nick: v('nk'), location: v('lo'), phone: ph, email: v('mail'), allergies: v('al'), venmo: vn, zelle: zl, apple: ap, pref: v('pf') });
  toast('Saved. Roommates see changes right away.'); render();
};

/* ---------- 11. calendar ---------- */
function itemsOn(iso) {
  const out = [], dow = pd(iso).getDay();
  S.events.forEach(e => { if (e.date === iso) out.push({ k: 'event', cat: 'events', t: e.name, time: e.time, who: e.by, on: `A.openEvent('${e.id}')` }); });
  S.chores.forEach(c => { if (!c.cal) return; const hit = c.type === 'one-time' ? c.date === iso : c.days.includes(dow) && iso >= (c.start || '2026-09-01'); if (hit) out.push({ k: 'chore', cat: 'chores', t: c.name, time: c.time, who: c.assignee, on: `location.hash='#/chore/${c.id}'` }); });
  if (S.rent.amount && S.rent.due === iso) out.push({ k: 'pay', cat: 'finances', t: 'Rent due', time: '', who: null, on: `A.fin('contracts')` });
  S.subs.forEach(s => { if (s.due === iso) out.push({ k: 'pay', cat: 'finances', t: s.name + ' due', time: '', who: null, on: `A.fin('contracts')` }); });
  return out.filter(i => (UI.calC === 'all' || i.cat === UI.calC) && (UI.calP === 'all' || !i.who || i.who === UI.calP));
}
const notesOn = iso => S.notes.filter(n => n.date === iso);
function dayCell(iso, mo) {
  const its = itemsOn(iso), ns = notesOn(iso), cur = pd(UI.anchor).getMonth();
  return `<div class="day ${iso === TODAY ? 'today' : ''} ${mo && pd(iso).getMonth() !== cur ? 'out' : ''}" onclick="A.modal('day',{date:'${iso}'})" role="button" tabindex="0" aria-label="${lbl(iso)}"><b style="font-size:${mo ? 12 : 13}px">${mo ? pd(iso).getDate() : lbl(iso)}</b>
${its.slice(0, mo ? 2 : 6).map(i => `<span class="pill ${i.k}">${i.time && !mo ? tm(i.time).replace(':00', '') + ' ' : ''}${esc(i.t)}</span>`).join('')}${mo && its.length > 2 ? `<span class="mute" style="font-size:10px">+${its.length - 2}</span>` : ''}
${ns.map(n => `<span class="pill ${n.urgent ? 'urgent' : 'note'}">${n.urgent ? '⚠ ' : '📝 '}${esc(n.text)}</span>`).join('')}</div>`;
}
PAGES.calendar = () => {
  let cells;
  if (UI.calV === 'week') cells = `<div class="wk">${weekDays().map(d => dayCell(d)).join('')}</div>`;
  else {
    const f = pd(UI.anchor); f.setDate(1); const s = addDays(fmt(f), -((f.getDay() + 6) % 7));
    cells = `<div class="mo">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="mute" style="font-size:11px;text-align:center">${d}</div>`).join('')}${[...Array(42)].map((_, i) => dayCell(addDays(s, i), true)).join('')}</div>`;
  }
  const title = UI.calV === 'week' ? `${short(weekDays()[0])} to ${short(weekDays()[6])}` : pd(UI.anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `${phead('Shared schedule', esc(S.house.calName) + ' <button class="btn s" onclick="A.modal(\'calName\')" aria-label="Rename calendar">✏️</button>', 'Everything coming up at ' + esc(S.house.name) + '.', '<button class="btn" onclick="A.modal(\'export\')">Import / export</button><button class="btn p" onclick="A.modal(\'addEvent\')">+ Add event</button>')}
<div class="split"><section class="card stack"><div class="row sp"><div class="row"><button class="btn s" onclick="A.calNav(-1)" aria-label="Previous">‹</button><b>${title}</b><button class="btn s" onclick="A.calNav(1)" aria-label="Next">›</button><button class="btn s" onclick="UI.anchor=TODAY;render()">Today</button></div></div>
${seg([['week', 'Week'], ['month', 'Month']], UI.calV, 'A.calV', 'full')}
<div class="row" style="flex-wrap:wrap;gap:6px"><span class="mute" style="font-size:13px">Person</span>${['all', ...S.order].map(i => `<button class="chip ${UI.calP === i ? 'on' : ''}" onclick="UI.calP='${i}';render()">${i === 'all' ? 'Everyone' : name(i)}</button>`).join('')}</div>
<div class="row" style="flex-wrap:wrap;gap:6px"><span class="mute" style="font-size:13px">Category</span>${[['all', 'All'], ['events', 'Events'], ['chores', 'Chores'], ['finances', 'Finances']].map(([k, l]) => `<button class="chip ${UI.calC === k ? 'on' : ''}" onclick="UI.calC='${k}';render()">${l}</button>`).join('')}</div>
${cells}<p class="mute" style="font-size:12px">Chores and payment due dates appear automatically. Add them in their own sections.</p></section>
<aside class="stack">${comingUp('Scheduled items', 6)}</aside></div>`;
};
A.calV = k => { UI.calV = k; render(); };
A.calNav = d => { if (UI.calV === 'week') UI.anchor = addDays(UI.anchor, 7 * d); else { const x = pd(UI.anchor); x.setDate(1); x.setMonth(x.getMonth() + d); UI.anchor = fmt(x); } render(); };
A.fin = t => { UI.fin = t; UI.modal = null; location.hash = '#/finances'; render(); };
MODALS.calName = () => `${mhead('Rename calendar')}${field('cn', 'Calendar name', '', S.house.calName)}<div class="acts"><button class="btn p" onclick="v('cn').trim()&&(S.house.calName=v('cn').trim());A.close()">Save</button></div>`;
MODALS.export = () => `${mhead('Import / export')}<p class="mute">Sync this calendar with another service.</p>${errBox}
<div class="stack"><button class="btn" onclick="A.doExport('Google Calendar')">Export to Google Calendar</button><button class="btn" onclick="A.doExport('Apple Calendar')">Export to Apple Calendar</button><button class="btn" onclick="A.close();toast('Imported 5 events from Google Calendar')">Import from Google Calendar</button></div>`;
A.doExport = svc => {
  UI.exportTries++;
  if (UI.exportTries % 2 === 1) { document.getElementById('err').innerHTML = `Couldn’t reach ${svc}. Check your connection and tap the button again to retry.`; return; }
  A.close(); toast('Exported to ' + svc);
};
MODALS.day = d => {
  const its = itemsOn(d.date), ns = notesOn(d.date);
  return `${mhead(lbl(d.date))}${its.length ? its.map(i => `<div class="item row click" onclick="${i.on}"><span class="pill ${i.k}">${i.k}</span><b class="grow">${esc(i.t)}</b><span class="mute" style="font-size:13px">${tm(i.time)} ${i.who ? name(i.who) : ''}</span></div>`).join('') : '<p class="mute">Nothing scheduled.</p>'}
${ns.map(n => `<div class="bubble">${n.urgent ? '⚠️ <b>Urgent</b> ' : '📝 '}${esc(n.text)} <span class="mute">· ${name(n.by)}</span></div>`).join('')}
<div class="acts"><button class="btn" onclick="A.modal('note',{date:'${d.date}'})">Add note</button><button class="btn p" onclick="A.modal('addEvent',{date:'${d.date}'})">Add event</button></div>`;
};
MODALS.note = d => `${mhead('Add a note')}<p class="mute">${lbl(d.date)}</p><textarea id="nt" class="input" rows="3" placeholder="Note for the house"></textarea><label class="row"><input type="checkbox" class="tog" id="nu"><span>Mark urgent (notifies roommates)</span></label>${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.addNote('${d.date}')">Save note</button></div>`;
A.addNote = date => { const t = v('nt').trim(); if (!t) return fail([{ id: 'nt', msg: 'Write a note first.' }]); const u = chk('nu'); S.notes.push({ id: 'k' + Date.now(), date, text: t, urgent: u, by: S.me }); UI.modal = null; toast(u ? 'Urgent note posted. Roommates notified.' : 'Note added'); render(); };

/* ---------- 12. add event ---------- */
MODALS.addEvent = d => `${mhead('Add event')}${field('en', 'Event name (required)')}<div class="grid2">${field('ed', 'Date (required)', 'type="date"', d.date || '')}${field('et', 'Time (optional)', 'type="time"')}</div>
<label class="fld"><span>Category</span><select id="ec" class="input" onchange="document.getElementById('hx').classList.toggle('hide',this.value!=='hosting')"><option value="other">Other</option><option value="house meeting">House meeting</option><option value="hosting">Hosting</option></select></label>
<div id="hx" class="hide stack"><div class="note">Roommates will be asked to agree or disagree.</div><div class="grid3">${field('eg', 'Guests', 'type="number" min="1"')}${field('ef', 'From', 'type="time" value="19:00"')}${field('eto', 'To', 'type="time" value="22:00"')}</div></div>
<label class="fld"><span>Description (optional)</span><textarea id="edc" class="input" rows="2"></textarea></label>${field('el', 'Link (optional)', 'type="url" placeholder="https://"')}${errBox}
<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.addEvent()">Save event</button></div>`;
A.addEvent = () => {
  const errs = [], hosting = v('ec') === 'hosting';
  if (!v('en').trim()) errs.push({ id: 'en', msg: 'Event name is required.' });
  if (!v('ed')) errs.push({ id: 'ed', msg: 'Date is required.' });
  if (hosting && !(+v('eg') >= 1)) errs.push({ id: 'eg', msg: 'Enter number of guests for a hosting event.' });
  if (errs.length) return fail(errs);
  const e = { id: 'e' + Date.now(), name: v('en').trim(), date: v('ed'), time: v('et'), cat: v('ec'), desc: v('edc'), link: v('el'), by: S.me };
  if (hosting) { const r = {}; S.order.forEach(i => r[i] = i === S.me ? 'agree' : null); e.host = { guests: +v('eg'), from: v('ef'), to: v('eto'), responses: r }; }
  S.events.push(e); UI.modal = null; toast(hosting ? 'Hosting request sent to roommates' : 'Event added. Roommates notified.'); render();
};
A.openEvent = id => { UI.modal = { t: 'event', d: { id } }; if (route().p !== 'home' && route().p !== 'calendar') { location.hash = '#/calendar'; } render(); };
MODALS.event = d => {
  const e = E(d.id); if (!e) return mhead('Event') + '<p>This event was deleted.</p>';
  const h = e.host, mine = h && e.by !== S.me ? h.responses[S.me] : 'x';
  return `${mhead(esc(e.name))}<p><b>${lbl(e.date)}</b> ${tm(e.time)} · ${badge(e.cat)}</p><p class="mute">Created by ${name(e.by)}</p>${e.desc ? `<p>${esc(e.desc)}</p>` : ''}${e.link ? `<a class="btn link" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.link)}</a>` : ''}
${h ? `<hr class="hr"><b>${h.guests} guests, ${tm(h.from)} to ${tm(h.to)}</b>${S.order.map(i => { const r = h.responses[i]; return `<div class="row">${av(i, 'sm')}<span class="grow">${name(i)}${i === e.by ? ' (host)' : ''}</span>${r === 'agree' ? badge('Agrees', 'good') : r === 'disagree' ? badge('Disagrees', 'bad') : badge('Waiting', 'gray')}</div>${h.msgs && h.msgs[i] ? `<div class="bubble mute" style="font-size:13px">“${esc(h.msgs[i])}”</div>` : ''}`; }).join('')}
${mine == null ? `<div class="acts"><button class="btn" onclick="A.hostRespond('${e.id}','no')">Disagree</button><button class="btn p" onclick="A.hostRespond('${e.id}','agree')">Agree</button></div>` : ''}` : ''}`;
};

/* ---------- dev tools ---------- */
MODALS.dev = () => `${mhead('Prototype tools')}
<div class="row sp"><span>Dark mode</span><input type="checkbox" class="tog" ${UI.dark ? 'checked' : ''} onchange="A.theme(this.checked)"></div>
<div class="row sp"><span>View as ${isOwner() ? 'member' : 'owner'}</span><button class="btn s" onclick="U(S.me).role=isOwner()?'member':'owner';UI.modal=null;render();toast('Now viewing as '+U(S.me).role)">Switch</button></div>
<div class="row sp"><span>Reset demo data</span><button class="btn s" onclick="S=seed();UI.modal=null;location.hash='#/home';render()">Reset</button></div>
<div class="row sp"><span>Empty household (empty states)</span><button class="btn s" onclick="S=emptySeed(['u1','u2','u3','u4']);UI.modal=null;location.hash='#/home';render()">Empty</button></div>
<hr class="hr"><b>Jump to screen</b><div class="row" style="flex-wrap:wrap;gap:6px">${[['1 Sign in', 'signin'], ['2 Welcome', 'welcome'], ['3 Profile setup', 'profile-setup'], ['4 Create/Join', 'choose'], ['5 New household', 'new-house'], ['6 Invite', 'invite'], ['7 Join', 'join'], ['8 Home', 'home'], ['9 Notifications', 'notifications'], ['10 Profile', 'profile'], ['11 Calendar', 'calendar'], ['13 Finances', 'finances'], ['14 Ledger', 'ledger/u2'], ['17 Wish list', 'finances|wish'], ['19 Contracts', 'finances|contracts'], ['20 Chores', 'chores'], ['22 Chore detail', 'chore/c2'], ['23 Settings', 'settings'], ['24 Members', 'members']].map(([l, h]) => `<button class="chip" onclick="${h.includes('|') ? `UI.fin='${h.split('|')[1]}';` : ''}A.go('#/${h.split('|')[0]}')">${l}</button>`).join('')}</div>
<p class="mute" style="font-size:12px">Modal screens (12 Add event, 15 Payment request, 16 Pay, 18 Mark bought, 21 Add chore) open from their parent screens.</p>`;

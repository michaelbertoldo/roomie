/* Roomie mockup: finances, chores, settings, members */
const handleOf = (u, m) => ({ Venmo: u.venmo, Zelle: u.zelle, 'Apple Cash': u.apple }[m] || '');
const METHODS = ['Venmo', 'Zelle', 'Apple Cash'];
const hasPay = u => !!(u.venmo || u.zelle || u.apple);
const unsettled = () => (youOwe() || owedToMe()) ? `You have unsettled balances: you owe ${money(youOwe())} and you’re owed ${money(owedToMe())}.` : '';
const daysSince = iso => iso ? Math.round((pd(TODAY) - pd(iso)) / 864e5) : null;
const dueBadge = c => c.status === 'done' ? badge('Done ' + short(c.lastDone), 'good') : c.status === 'overdue' ? badge('Overdue', 'bad') : c.date === TODAY ? badge('Due today', 'warn') : badge('Due ' + short(c.date));

/* ================= FINANCES ================= */
PAGES.finances = () => `${phead('Shared money', 'Finances', 'Keep every shared cost clear and accounted for.', UI.fin === 'settle' ? '<button class="btn p" onclick="A.modal(\'payReq\',{})">+ Log expense</button>' : '')}
${seg([['settle', 'Settle payments'], ['wish', 'Wish list'], ['contracts', 'Rent & subscriptions']], UI.fin, 'A.finTab')}${FIN[UI.fin]()}`;
A.finTab = k => { UI.fin = k; render(); };
const FIN = {};

/* 13. settle payments */
FIN.settle = () => {
  const me = U(S.me), open = S.purchases.filter(p => Object.entries(p.shares).some(([u, s]) => u !== p.buyer && s.status !== 'paid')).sort((a, b) => b.date.localeCompare(a.date));
  if (!others().length) return `<section class="card">${empty('👥', 'No roommates yet', 'Invite your roommates to start splitting costs.', '<a class="btn p" href="#/invite">Invite roommates</a>')}</section>`;
  return `${hasPay(me) ? '' : `<div class="note">You haven’t added a payment method. Roommates can’t pay you yet. <a class="btn link" href="#/profile">Set one up in your profile</a></div>`}
<div class="grid2"><section class="card"><h2>Balances</h2>${others().map(i => { const n = net(S.me, i); return `<div class="item row"><span class="click row grow" onclick="location.hash='#/ledger/${i}'">${av(i)}<div><b>${name(i)}</b><div style="font-size:13px" class="${n > 0 ? 'good' : n < 0 ? 'bad' : 'mute'}">${n > 0 ? 'owes you ' + money(n) : n < 0 ? 'you owe ' + money(-n) : 'All clear ✓'}</div></div></span>
${n < 0 ? `<button class="btn p s" onclick="A.modal('pay',{to:'${i}'})">Pay</button>` : n > 0 ? `<button class="btn s" onclick="A.remind('${i}')">Remind</button>` : badge('Clear', 'good')}<button class="btn link" onclick="location.hash='#/ledger/${i}'">Ledger</button></div>`; }).join('')}</section>
<section class="card"><h2>Shared purchases not fully paid</h2>${open.length ? open.map(p => `<div class="item click row t" onclick="A.modal('purchase',{id:'${p.id}'})"><div class="grow"><b>${esc(p.item)}</b> <span class="mute">${money(p.total)}</span><div class="mute" style="font-size:13px">${short(p.date)} · bought by ${name(p.buyer)}</div></div><div style="text-align:right;font-size:13px">${Object.entries(p.shares).filter(([u, s]) => u !== p.buyer && s.status !== 'paid').map(([u, s]) => `<div>${name(u)} ${money(s.amt)} ${s.status === 'claimed' ? badge('pending', 'warn') : ''}</div>`).join('')}</div></div>`).join('') : empty('🎉', 'Everyone’s settled', 'Fully paid purchases stay in the transaction history.')}</section></div>`;
};
A.remind = i => toast('Reminder sent to ' + U(i).first);

/* 14. ledger */
PAGES.ledger = r => {
  const i = r.a[0], u = U(i); if (!u) return empty('🤷', 'Roommate not found', '');
  const n = net(S.me, i), theirs = S.purchases.filter(p => p.buyer === i && p.shares[S.me]), mine = S.purchases.filter(p => p.buyer === S.me && p.shares[i]);
  const row = (p, who) => { const s = p.shares[who]; return `<div class="item click row" onclick="A.modal('purchase',{id:'${p.id}'})"><div class="grow"><b>${esc(p.item)}</b><div class="mute" style="font-size:13px">${short(p.date)} · total ${money(p.total)}</div></div><div style="text-align:right">${money(s.amt)}<div>${s.status === 'paid' ? badge('Paid ' + (s.date ? short(s.date) : ''), 'good') : s.status === 'claimed' ? badge('Awaiting confirm', 'warn') : badge('Unpaid', 'bad')}</div></div></div>`; };
  return `<div class="ph"><div class="row"><button class="btn s" onclick="location.hash='#/finances'">← Back</button>${av(i, 'lg')}<div><h1>${esc(u.first)} ${esc(u.last)}</h1><span class="${n > 0 ? 'good' : n < 0 ? 'bad' : 'mute'}">${n > 0 ? 'Owes you ' + money(n) : n < 0 ? 'You owe ' + money(-n) : 'All clear ✓'}</span></div></div>
<div class="row">${n < 0 ? `<button class="btn p" onclick="A.modal('pay',{to:'${i}'})">Pay ${esc(u.first)}</button>` : ''}<button class="btn" onclick="A.remind('${i}')">${n > 0 ? 'Request payment' : 'Remind'}</button></div></div>
${!theirs.length && !mine.length ? `<section class="card">${empty('🧾', 'No history yet', 'Shared purchases between you two will show up here.')}</section>` : `
<div class="grid2"><section class="card"><h2>${esc(u.first)} bought, you share</h2>${theirs.length ? theirs.map(p => row(p, S.me)).join('') : '<p class="mute">None.</p>'}</section>
<section class="card"><h2>You bought, ${esc(u.first)} shares</h2>${mine.length ? mine.map(p => row(p, i)).join('') : '<p class="mute">None.</p>'}</section></div>
<section class="card"><h2>Payments between you</h2>${[...theirs.map(p => [p, S.me, i]), ...mine.map(p => [p, i, S.me])].filter(([p, w]) => p.shares[w].status === 'paid' && p.shares[w].date).map(([p, w, to]) => `<div class="item row sp"><span>${name(w)} paid ${name(to)} for ${esc(p.item)}</span><b>${money(p.shares[w].amt)} · ${short(p.shares[w].date)}</b></div>`).join('') || '<p class="mute">No payments yet.</p>'}</section>`}`;
};

/* 15. payment request (log / edit) */
MODALS.payReq = d => {
  const ed = d.edit && P(d.edit), pre = d.pre || {}, sel = ed ? ed.split : S.order;
  return `${mhead(ed ? 'Edit purchase' : 'Log a shared expense')}${field('pi', 'Item purchased', 'placeholder="e.g. Paper towels"', ed ? ed.item : pre.item || '')}
${field('pa', 'Total amount ($)', 'inputmode="decimal" placeholder="0.00"', ed ? (ed.total / 100).toFixed(2) : pre.amt || '')}
<div class="fld"><span>Split with</span><div class="row" style="flex-wrap:wrap">${S.order.map(i => `<label class="chip row" style="gap:6px"><input type="checkbox" class="sp-c" value="${i}" ${sel.includes(i) ? 'checked' : ''} ${i === S.me ? 'checked disabled' : ''} onchange="A.splitPrev()">${name(i)}</label>`).join('')}</div><span class="mute" style="font-weight:400">Split equally. Extra cents go to the purchaser (you).</span></div>
<div id="splitprev" class="bubble" style="font-size:13px"></div>
<label class="fld"><span>Pay me through</span><select id="pm" class="input">${METHODS.map(m => `<option ${ed && ed.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
<label class="fld"><span>Receipt photo (optional)</span><input type="file" accept="image/*" class="input" onchange="toast('Receipt attached')"></label>
${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.savePurchase('${d.edit || ''}','${pre.wish || ''}')">${ed ? 'Save changes' : 'Save expense'}</button></div>`;
};
A.splitPrev = () => {
  const el = document.getElementById('splitprev'); if (!el) return;
  const ids = [...document.querySelectorAll('.sp-c')].filter(c => c.checked).map(c => c.value), t = Math.round(parseFloat(v('pa')) * 100);
  if (!(t > 0) || ids.length < 2) { el.innerHTML = ''; return; }
  const sh = splitShares(t, S.me, ids); el.innerHTML = ids.map(i => `${name(i)} ${money(sh[i].amt)}`).join(' · ');
};
A.savePurchase = (edit, wish) => {
  const errs = [], amt = parseFloat(v('pa')), ids = [...document.querySelectorAll('.sp-c')].filter(c => c.checked && c.value !== S.me).map(c => c.value);
  if (!v('pi').trim()) errs.push({ id: 'pi', msg: 'Item name is required.' });
  if (!(amt > 0)) errs.push({ id: 'pa', msg: 'Total must be a number greater than $0.' });
  if (!ids.length) errs.push({ id: 'pi', msg: 'Select at least one roommate to share the cost.' });
  if (errs.length) return fail(errs);
  const all = [S.me, ...ids], total = Math.round(amt * 100);
  if (edit) {
    const p = P(edit), old = p.shares; p.item = v('pi').trim(); p.total = total; p.method = v('pm'); p.split = all; p.shares = splitShares(total, S.me, all);
    all.forEach(i => { if (i !== S.me && old[i] && old[i].status === 'paid' && old[i].amt === p.shares[i].amt) p.shares[i] = old[i]; });
    toast('Updated. Balances recalculated.');
  } else {
    S.purchases.unshift({ id: 'p' + Date.now(), item: v('pi').trim(), total, buyer: S.me, date: TODAY, method: v('pm'), split: all, shares: splitShares(total, S.me, all) });
    toast(`Saved. ${ids.length} roommate${ids.length > 1 ? 's' : ''} notified.`);
  }
  if (wish) { S.wish.needs = S.wish.needs.filter(w => w.id !== wish); S.wish.wants = S.wish.wants.filter(w => w.id !== wish); }
  UI.modal = null; render();
};
MODALS.purchase = d => {
  const p = P(d.id); if (!p) return mhead('Purchase') + '<p>This purchase was deleted.</p>';
  const mineP = p.buyer === S.me;
  return `${mhead(esc(p.item))}<p><b>${money(p.total)}</b> · bought by ${name(p.buyer)} on ${lbl(p.date)}</p><p class="mute" style="font-size:13px">Pay ${name(p.buyer)} via ${p.method}</p>
${Object.entries(p.shares).map(([i, s]) => `<div class="item row">${av(i, 'sm')}<span class="grow">${name(i)} · ${money(s.amt)}${i === p.buyer ? ' (purchaser)' : ''}</span>
${i === p.buyer ? '' : s.status === 'paid' ? badge('Paid ' + (s.date ? short(s.date) : ''), 'good') : s.status === 'claimed' ? (mineP ? `<button class="btn p s" onclick="A.confirmPay('${p.id}','${i}')">Confirm</button><button class="btn s" onclick="A.denyPay('${p.id}','${i}')">Deny</button>` : badge('Awaiting confirm', 'warn')) : (i === S.me ? `<button class="btn p s" onclick="A.modal('pay',{to:'${p.buyer}',pid:'${p.id}'})">Pay</button>` : badge('Unpaid', 'bad'))}</div>`).join('')}
${mineP ? `<div class="acts"><button class="btn d" onclick="A.modal('confirm',{title:'Delete purchase?',body:'This removes ${esc(p.item)} and reverses everyone’s balances.',on:&quot;A.deletePurchase('${p.id}')&quot;,danger:1,ok:'Delete'})">Delete</button><button class="btn" onclick="A.modal('payReq',{edit:'${p.id}'})">Edit</button></div>` : ''}`;
};
A.deletePurchase = id => { S.purchases = S.purchases.filter(p => p.id !== id); UI.modal = null; toast('Purchase deleted. Balances reversed.'); render(); };
A.confirmPay = (pid, uid) => { const s = P(pid).shares[uid]; s.status = 'paid'; s.date = TODAY; S.history.unshift({ d: TODAY, t: `${name(uid)} paid ${name(P(pid).buyer)} ${money(s.amt)} for ${P(pid).item}` }); UI.modal = null; toast('Payment confirmed. Balances updated.'); render(); };
A.denyPay = (pid, uid) => { P(pid).shares[uid].status = 'unpaid'; UI.modal = null; toast('Returned to unpaid. ' + name(uid) + ' was notified.'); render(); };

/* 16. pay a roommate */
function payInfo(d) {
  const o = outstanding().filter(x => x.uid === S.me && x.p.buyer === d.to && x.status === 'unpaid' && (!d.pid || x.p.id === d.pid));
  return { o, amt: o.reduce((t, x) => t + x.amt, 0), what: o.map(x => x.p.item).join(', ') };
}
MODALS.pay = d => {
  const to = U(d.to), { o, amt, what } = payInfo(d), avail = METHODS.filter(m => handleOf(to, m)), m = d.method || avail[0];
  if (!o.length) return `${mhead('Pay ' + esc(to.first))}<p class="mute">Nothing left to pay ${esc(to.first)}. Anything you marked as paid is waiting on their confirmation.</p><div class="acts"><button class="btn p" onclick="A.close()">OK</button></div>`;
  if (d.step === 2) return `${mhead('Finish in ' + m)}<div class="card stack"><p>Opening <b>${m}</b> with the details filled in:</p><div class="bubble"><b>${money(amt)}</b> to <b>${esc(handleOf(to, m))}</b><br><span class="mute">${esc(what)}</span></div></div>
<p class="mute" style="font-size:13px">Roomie doesn’t move money. Come back and confirm once you’ve paid.</p>
<div class="acts"><button class="btn" onclick="A.notPaid()">I didn’t finish</button><button class="btn p" onclick="A.markClaimed('${d.to}','${d.pid || ''}')">I’ve paid</button></div>`;
  return `${mhead('Pay ' + esc(to.first))}<div class="row sp"><div><div class="mute" style="font-size:13px">Amount</div><b style="font-size:28px">${money(amt)}</b></div><div style="text-align:right" class="mute">For<br>${esc(what)}</div></div>
${avail.length ? `<div class="fld"><span>Payment method</span><div class="row" style="flex-wrap:wrap">${METHODS.map(x => `<button class="chip ${x === m ? 'on' : ''}" ${handleOf(to, x) ? '' : 'disabled style="opacity:.4"'} onclick="A.modal('pay',{to:'${d.to}',pid:'${d.pid || ''}',method:'${x}'})">${x}${x === 'Venmo' ? ' ★' : ''}</button>`).join('')}</div><span class="mute" style="font-weight:400">${esc(to.first)}’s ${m}: ${esc(handleOf(to, m))}</span></div>
<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.modal('pay',{to:'${d.to}',pid:'${d.pid || ''}',method:'${m}',step:2})">Open ${m}</button></div>`
      : `<div class="note">${esc(to.first)} hasn’t added a payment handle yet.</div><div class="acts"><button class="btn" onclick="A.close()">Close</button><button class="btn p" onclick="A.close();A.remind('${d.to}')">Remind ${esc(to.first)} to add one</button></div>`}`;
};
A.notPaid = () => { UI.modal = null; toast('Not marked as paid'); render(); };
A.markClaimed = (to, pid) => { payInfo({ to, pid }).o.forEach(x => x.p.shares[S.me].status = 'claimed'); UI.modal = null; toast(`Marked as paid. Waiting for ${U(to).first} to confirm.`); render(); };

/* 17. wish list */
FIN.wish = () => {
  const list = (k, t) => `<section class="card"><h2>${t}</h2>${S.wish[k].length ? S.wish[k].map(w => `<div class="item wi" data-n="${esc(w.name.toLowerCase())}"><div class="row"><div class="grow"><b>${esc(w.name)}</b> <span class="mute">est. ${money(w.est)}</span><div class="mute" style="font-size:13px">${w.who ? 'Assigned to ' + name(w.who) : 'Unassigned'}${w.comments.length ? ' · 💬 ' + w.comments.length : ''}</div></div></div>
<div class="acts" style="justify-content:flex-start;margin-top:6px"><button class="btn p s" onclick="A.modal('bought',{id:'${w.id}'})">Mark bought</button><button class="btn s" onclick="A.modal('comment',{id:'${w.id}'})">Comment</button><button class="btn s" onclick="A.assignWish('${w.id}')">${w.who === S.me ? 'Unassign' : 'I’ll get it'}</button><button class="btn s d" onclick="A.delWish('${w.id}')">Delete</button></div></div>`).join('') : empty(k === 'needs' ? '🛒' : '✨', 'Nothing here yet', k === 'needs' ? 'Add things the house needs.' : 'Add nice-to-haves.')}</section>`;
  return `<section class="card stack"><div class="row" style="flex-wrap:wrap"><input id="wn" class="input grow" placeholder="Search or add an item…" oninput="A.wishFilter(this.value)"><input id="we" class="input" style="width:110px" inputmode="decimal" placeholder="Est. $"><select id="wl" class="input" style="width:110px"><option value="needs">Need</option><option value="wants">Want</option></select><button class="btn p" onclick="A.addWish()">Add</button></div>${errBox}<span class="mute" style="font-size:12px">Prices are estimates until someone buys the item.</span></section>
<div class="grid2">${list('needs', 'Needs')}${list('wants', 'Wants')}</div>`;
};
A.wishFilter = q => document.querySelectorAll('.wi').forEach(e => e.classList.toggle('hide', !!q && !e.dataset.n.includes(q.toLowerCase())));
A.addWish = () => { const n = v('wn').trim(); if (!n) return fail([{ id: 'wn', msg: 'Type an item name to add.' }]); const e = Math.round((parseFloat(v('we')) || 0) * 100); S.wish[v('wl')].push({ id: 'w' + Date.now(), name: n, est: e, who: null, comments: [] }); toast('Added to ' + v('wl')); render(); };
A.delWish = id => { ['needs', 'wants'].forEach(k => S.wish[k] = S.wish[k].filter(w => w.id !== id)); render(); };
A.assignWish = id => { const w = [...S.wish.needs, ...S.wish.wants].find(x => x.id === id); w.who = w.who === S.me ? null : S.me; render(); };
const WI = id => [...S.wish.needs, ...S.wish.wants].find(x => x.id === id);
MODALS.comment = d => { const w = WI(d.id); return `${mhead('Comments: ' + esc(w.name))}${w.comments.length ? w.comments.map(c => `<div class="bubble"><b>${name(c.by)}</b> ${esc(c.text)}</div>`).join('') : '<p class="mute">No comments yet.</p>'}<input id="cm" class="input" placeholder="Add a comment"><div class="acts"><button class="btn p" onclick="v('cm').trim()&&WI('${d.id}').comments.push({by:S.me,text:v('cm').trim()});A.modal('comment',{id:'${d.id}'})">Post</button></div>`; };

/* 18. mark bought */
MODALS.bought = d => { const w = WI(d.id); return `${mhead('Mark as bought')}<p>Item: <b>${esc(w.name)}</b></p>${field('ba', 'Actual amount paid ($)', 'inputmode="decimal"', w.est ? (w.est / 100).toFixed(2) : '')}
<div class="fld"><span>Who shares the cost?</span><div class="row" style="flex-wrap:wrap">${others().map(i => `<label class="chip row" style="gap:6px"><input type="checkbox" class="bs" value="${i}" checked>${name(i)}</label>`).join('')}</div></div>${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.boughtSave('${d.id}')">Save</button></div>`; };
A.boughtSave = id => {
  const a = parseFloat(v('ba')), ids = [...document.querySelectorAll('.bs')].filter(c => c.checked).map(c => c.value), errs = [];
  if (!(a > 0)) errs.push({ id: 'ba', msg: 'Enter the amount you paid (a number above $0).' });
  if (!ids.length) errs.push({ id: 'ba', msg: 'Pick at least one roommate to share the cost.' });
  if (errs.length) return fail(errs);
  const w = WI(id), all = [S.me, ...ids], t = Math.round(a * 100);
  S.purchases.unshift({ id: 'p' + Date.now(), item: w.name, total: t, buyer: S.me, date: TODAY, method: 'Venmo', split: all, shares: splitShares(t, S.me, all) });
  A.delWish(id); UI.modal = null; UI.fin = 'settle'; toast(w.name + ' moved to Settle payments'); render();
};

/* 19. rent and subscriptions */
FIN.contracts = () => {
  const r = S.rent, per = rentShare(), can = canManage();
  return `<section class="card stack"><div class="row sp"><h2>Pooled rent</h2>${can ? '<button class="btn s" onclick="A.modal(\'editRent\')">Edit</button>' : '<span class="mute" style="font-size:12px">🔒 Owner only</span>'}</div>
${r.amount ? `<div class="row sp"><div><b style="font-size:26px">${money(r.amount)}</b><div class="mute">Due ${lbl(r.due)} · ${money(per)} each</div></div><label class="row" style="font-size:13px"><input type="checkbox" class="tog" ${r.remind ? 'checked' : ''} onchange="S.rent.remind=this.checked;toast(this.checked?'Reminders on (3 days before)':'Reminders off')">Remind 3 days before</label></div>
<div class="bar" style="--w:${Math.round(S.order.filter(i => r.paid[i]).length / Math.max(S.order.length, 1) * 100)}%"><i></i></div><div class="mute" style="font-size:12px">${S.order.filter(i => r.paid[i]).length} of ${S.order.length} paid</div>${S.order.map(i => `<div class="item row">${av(i, 'sm')}<span class="grow">${name(i)} · ${money(per)}</span>${r.paid[i] ? badge('Paid', 'good') : badge('Unpaid', 'warn')}</div>`).join('')}
<button class="btn ${r.paid[S.me] ? '' : 'p'}" onclick="A.rentToggle()">${r.paid[S.me] ? 'Undo: mark my share unpaid' : 'Mark my share paid'}</button>` : empty('🏠', 'No rent set up', 'Add the monthly rent so everyone gets reminders.', can ? '<button class="btn p" onclick="A.modal(\'editRent\')">Set up rent</button>' : '')}</section>
<section class="card stack"><div class="row sp"><h2>Shared subscriptions</h2><button class="btn s" onclick="A.modal('addSub')">+ Add</button></div>
${S.subs.length ? S.subs.map(s => `<div class="item row">${av(s.owner, 'sm')}<div class="grow"><b>${esc(s.name)}</b><div class="mute" style="font-size:13px">${name(s.owner)} pays · due ${short(s.due)}</div></div><div style="text-align:right"><b>${money(s.amount)}</b><div class="mute" style="font-size:12px">${money(Math.round(s.amount / Math.max(S.order.length, 1)))} each</div></div></div>`).join('') : empty('📺', 'No subscriptions', 'Add Netflix, Wi-Fi, or anything the house splits.')}</section>
<section class="card"><h2>Utilities <span class="badge gray">Coming later</span></h2><div class="row" style="flex-wrap:wrap;margin-top:8px">${['Water', 'Electricity', 'Wi-Fi', 'Other'].map(x => `<span class="chip" style="opacity:.5">${x}</span>`).join('')}</div></section>
<section class="card"><h2>Transaction history</h2>${S.history.length ? S.history.map(h => `<div class="item row sp"><span>${esc(h.t)}</span><span class="mute" style="font-size:13px">${short(h.d)}</span></div>`).join('') : '<p class="mute">No transactions yet.</p>'}</section>`;
};
A.rentToggle = () => { S.rent.paid[S.me] = !S.rent.paid[S.me]; if (S.rent.paid[S.me]) S.history.unshift({ d: TODAY, t: `You paid your rent share ${money(rentShare())}` }); render(); };
MODALS.editRent = () => `${mhead('Edit rent')}${field('ra', 'Total monthly rent ($)', 'inputmode="decimal"', S.rent.amount ? (S.rent.amount / 100).toFixed(2) : '')}${field('rd', 'Due date', 'type="date"', S.rent.due)}<p class="mute" style="font-size:13px">Everyone is notified when this changes.</p>${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.saveRent()">Save</button></div>`;
A.saveRent = () => { const a = parseFloat(v('ra')); if (!(a > 0)) return fail([{ id: 'ra', msg: 'Rent must be a number above $0.' }]); if (!v('rd')) return fail([{ id: 'rd', msg: 'Pick a due date.' }]); S.rent.amount = Math.round(a * 100); S.rent.due = v('rd'); UI.modal = null; toast('Rent updated. Roommates notified.'); render(); };
MODALS.addSub = () => `${mhead('Add subscription')}${field('sn', 'Name')}${field('sa', 'Monthly cost ($)', 'inputmode="decimal"')}${field('sd', 'Next due date', 'type="date"')}${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.addSub()">Add</button></div>`;
A.addSub = () => { const errs = [], a = parseFloat(v('sa')); if (!v('sn').trim()) errs.push({ id: 'sn', msg: 'Name is required.' }); if (!(a > 0)) errs.push({ id: 'sa', msg: 'Cost must be above $0.' }); if (!v('sd')) errs.push({ id: 'sd', msg: 'Due date is required.' }); if (errs.length) return fail(errs); S.subs.push({ id: 's' + Date.now(), name: v('sn').trim(), owner: S.me, amount: Math.round(a * 100), due: v('sd') }); UI.modal = null; toast('Added. Everyone affected was notified.'); render(); };

/* ================= CHORES ================= */
const sortChores = l => [...l].sort((a, b) => UI.cs === 'type' ? a.type.localeCompare(b.type) || a.name.localeCompare(b.name) : UI.cs === 'since' ? (a.lastDone || '0').localeCompare(b.lastDone || '0') : a.date.localeCompare(b.date));
function choreCard(c) {
  const ds = daysSince(c.lastDone);
  return `<div class="card click st-${c.status}" style="padding:14px" onclick="location.hash='#/chore/${c.id}'"><div class="row t"><div class="grow"><b>${esc(c.name)}</b> ${c.rotate ? '🔄' : ''}<div class="row" style="gap:6px;margin:4px 0">${av(c.assignee, 'sm')}<span class="mute" style="font-size:13px">${name(c.assignee)}</span></div>
<div class="row" style="flex-wrap:wrap;gap:6px">${dueBadge(c)}${badge(c.effort, 'gray')}${c.swap && c.swap.status === 'pending' ? badge('Swap pending', 'warn') : ''}${c.skip && c.skip.status === 'requested' ? badge('Skip requested', 'warn') : ''}<span class="mute" style="font-size:12px">${ds == null ? 'Never done' : 'Last done ' + (ds === 0 ? 'today' : ds + 'd ago')}</span></div></div>
${c.assignee === S.me && c.status !== 'done' ? `<button class="btn p s" onclick="event.stopPropagation();A.complete('${c.id}')">Done</button>` : ''}</div></div>`;
}
function workload() {
  if (!S.chores.length) return '';
  const cnt = S.order.map(i => [i, S.chores.filter(c => c.assignee === i && c.status !== 'done').length]), mx = Math.max(1, ...cnt.map(x => x[1]));
  return `<section class="card"><div class="row sp"><h2>Household workload</h2><span class="eyebrow">open chores</span></div><div class="grid2" style="gap:4px 32px;margin-top:6px">${cnt.map(([i, n]) => `<div class="row" style="padding:6px 0">${av(i, 'sm')}<span class="truncate" style="width:70px">${name(i)}</span><div class="bar grow" style="--w:${Math.round(n / mx * 100)}%"><i></i></div><b class="mute" style="width:18px;text-align:right">${n}</b></div>`).join('')}</div></section>`;
}
PAGES.chores = () => {
  const f = c => UI.cf === 'all' || c.assignee === UI.cf, mine = sortChores(S.chores.filter(c => c.assignee === S.me && f(c))), all = sortChores(S.chores.filter(f));
  const col = (t, l, key, msg) => `<div class="${UI.cv === key ? '' : 'hidden'} md:block stack"><h2 class="hidden md:block">${t}</h2>${l.length ? l.map(choreCard).join('') : `<section class="card">${empty('🧹', S.chores.length ? 'Nothing matches' : 'No chores yet', msg, S.chores.length ? '' : '<button class="btn p" onclick="A.modal(\'addChore\',{})">Add your first chore</button>')}</section>`}</div>`;
  return `${phead('Shared responsibilities', 'Chores', 'A clear view of what needs doing, and whose turn it is.', '<button class="btn p" onclick="A.modal(\'addChore\',{})">+ Add chore</button>')}
<div class="row sp" style="flex-wrap:wrap"><div class="md:hidden w-full">${seg([['my', 'My chores'], ['all', 'All chores']], UI.cv, 'A.cview', 'full')}</div>
<div class="row" style="flex-wrap:wrap"><select class="input" style="width:auto" onchange="UI.cf=this.value;render()" aria-label="Filter by person"><option value="all">Everyone</option>${S.order.map(i => `<option value="${i}" ${UI.cf === i ? 'selected' : ''}>${name(i)}</option>`).join('')}</select>
<select class="input" style="width:auto" onchange="UI.cs=this.value;render()" aria-label="Sort"><option value="due" ${UI.cs === 'due' ? 'selected' : ''}>Sort: due date</option><option value="type" ${UI.cs === 'type' ? 'selected' : ''}>Sort: chore type</option><option value="since" ${UI.cs === 'since' ? 'selected' : ''}>Sort: longest since done</option></select></div></div>
${workload()}
<div class="grid2">${col('My chores', mine, 'my', 'Nothing assigned to you.')}${col('All chores', all, 'all', 'Add a chore to get the house started.')}</div>`;
};
A.cview = k => { UI.cv = k; render(); };
A.complete = id => { const ev = window.event; if (ev && ev.clientX) confetti(ev.clientX, ev.clientY); const c = C(id); c.status = 'done'; c.lastDone = TODAY; toast('Marked complete. Logged for ' + short(TODAY)); render(); };

/* 22. chore details and swap */
PAGES.chore = r => {
  const c = C(r.a[0]); if (!c) return empty('🤷', 'Chore not found', 'It may have been deleted.', '<a class="btn" href="#/chores">Back to chores</a>');
  const mineC = c.assignee === S.me, canEdit = c.by === S.me || mineC, sw = c.swap && c.swap.status === 'pending';
  const incoming = sw && C(c.swap.toChore) && C(c.swap.toChore).assignee === S.me;
  const cands = S.chores.filter(x => x.assignee !== S.me && x.status !== 'done' && !(x.swap && x.swap.status === 'pending') && !S.chores.some(y => y.swap && y.swap.status === 'pending' && y.swap.toChore === x.id));
  const ds = daysSince(c.lastDone);
  return `<div class="ph"><div class="row"><button class="btn s" onclick="location.hash='#/chores'">← Back</button><h1>${esc(c.name)}</h1></div>${dueBadge(c)}</div>
<section class="card stack"><div class="grid2"><div><span class="mute">Assigned to</span><div class="row">${av(c.assignee, 'sm')}<b>${name(c.assignee)}</b></div></div><div><span class="mute">Schedule</span><div><b>${c.type === 'recurring' ? 'Repeats ' + c.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : lbl(c.date)} at ${tm(c.time)}</b></div></div>
<div><span class="mute">Effort</span><div><b>${c.effort}</b></div></div><div><span class="mute">Last completed</span><div><b>${c.lastDone ? lbl(c.lastDone) + ` (${ds}d ago)` : 'Never'}</b></div></div>
${c.rotate ? `<div><span class="mute">Rotation</span><div class="row">${(c.rotation || []).map(i => av(i, 'sm')).join('')}</div></div>` : ''}<div><span class="mute">Created by</span><div><b>${name(c.by)}</b></div></div></div>
${c.desc ? `<p>${esc(c.desc)}</p>` : ''}${c.notes ? `<p class="mute">Notes: ${esc(c.notes)}</p>` : ''}
<div class="acts" style="justify-content:flex-start">${mineC && c.status !== 'done' ? `<button class="btn p" onclick="A.complete('${c.id}')">Mark complete</button>` : ''}<button class="btn ${canEdit ? '' : 'off'}" ${canEdit ? `onclick="A.modal('addChore',{edit:'${c.id}'})"` : 'disabled'}>Edit</button>${mineC && !c.skip ? `<button class="btn" onclick="A.modal('skip',{id:'${c.id}'})">Request skip</button>` : ''}</div>${canEdit ? '' : '<p class="mute" style="font-size:12px">Only the creator or assignee can edit this chore.</p>'}</section>
${incoming ? `<section class="card stack"><h2>Swap request for you</h2><p>${name(c.swap.from)} wants to trade <b>${esc(c.name)}</b> for your <b>${esc(C(c.swap.toChore).name)}</b>.${c.swap.reason ? ` “${esc(c.swap.reason)}”` : ''}</p><div class="acts" style="justify-content:flex-start"><button class="btn p" onclick="A.swapAnswer('${c.id}',true)">Accept</button><button class="btn" onclick="A.swapAnswer('${c.id}',false)">Decline</button></div></section>` : ''}
${sw && !incoming ? `<section class="card"><h2>Swap pending</h2><p class="mute">Waiting on ${name(C(c.swap.toChore).assignee)} to answer. Only one swap can be pending per chore.</p>${c.swap.from === S.me ? `<div class="acts" style="justify-content:flex-start"><button class="btn s" onclick="A.swapAnswer('${c.id}',true,1)">Demo: they accept</button><button class="btn s" onclick="A.swapAnswer('${c.id}',false,1)">Demo: they decline</button></div>` : ''}</section>` : ''}
${c.skip ? `<section class="card stack"><h2>Skip request</h2>${c.skip.status === 'requested' ? `<p class="mute">“${esc(c.skip.reason)}”. Roommates were notified and haven’t accepted yet.</p><div class="acts" style="justify-content:flex-start"><button class="btn s" onclick="A.skipSim('${c.id}',1)">Demo: someone accepts</button><button class="btn s" onclick="A.skipSim('${c.id}',0)">Demo: due date passes</button></div>` : `<div class="ok">A roommate accepted your skip. Choose what happens next.</div><div class="row"><select id="sa" class="input">${others().map(i => `<option value="${i}">${name(i)}</option>`).join('')}</select><button class="btn p" onclick="A.skipAssign('${c.id}')">Assign</button></div><button class="btn d" onclick="A.skipDelete('${c.id}')">Delete this chore instance</button>`}</section>` : ''}
${mineC && !sw && !c.swap ? `<section class="card stack"><h2>Swap with a roommate</h2>${cands.length ? `<p class="mute" style="font-size:13px">Pick one of their upcoming chores to trade for.</p>${cands.map(x => `<label class="item row click"><input type="radio" name="sw" value="${x.id}">${av(x.assignee, 'sm')}<span class="grow"><b>${esc(x.name)}</b><div class="mute" style="font-size:12px">${name(x.assignee)} · ${short(x.date)}</div></span></label>`).join('')}${field('sr', 'Reason (optional)')}${errBox}<button class="btn p" onclick="A.sendSwap('${c.id}')">Send swap request</button>` : '<p class="mute">No other chores available to trade right now.</p>'}</section>` : ''}`;
};
A.sendSwap = id => { const s = document.querySelector('input[name=sw]:checked'); if (!s) return fail([{ id: 'sr', msg: 'Choose a chore to trade for.' }]); C(id).swap = { from: S.me, toChore: s.value, reason: v('sr').trim(), status: 'pending' }; toast('Swap request sent to ' + name(C(s.value).assignee)); render(); };
A.swapAnswer = (id, ok) => {
  const c = C(id), t = C(c.swap.toChore);
  if (ok) { [c.assignee, t.assignee] = [t.assignee, c.assignee]; c.swap.status = 'accepted'; toast('Swapped. Assignments and calendar updated.'); }
  else { c.swap.status = 'declined'; toast('Declined. ' + name(c.swap.from) + ' was notified.'); }
  render();
};
MODALS.skip = d => `${mhead('Request to skip')}<p class="mute">Roommates will be asked to cover it. A reason is required.</p><textarea id="sk" class="input" rows="3" placeholder="Why can’t you do it?"></textarea>${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.sendSkip('${d.id}')">Send request</button></div>`;
A.sendSkip = id => { const r = v('sk').trim(); if (!r) return fail([{ id: 'sk', msg: 'Add a reason for the skip request.' }]); C(id).skip = { reason: r, status: 'requested' }; UI.modal = null; toast('Roommates notified'); render(); };
A.skipSim = (id, acc) => { const c = C(id); if (acc) c.skip.status = 'accepted'; else { c.skip = null; c.status = 'overdue'; toast('No one accepted in time. Kept with you and marked overdue.'); } render(); };
A.skipAssign = id => { const c = C(id); c.assignee = v('sa'); c.skip = null; toast('Reassigned to ' + name(c.assignee)); render(); };
A.skipDelete = id => { S.chores = S.chores.filter(c => c.id !== id); toast('Chore instance deleted'); location.hash = '#/chores'; };

/* 21. add / edit chore */
MODALS.addChore = d => {
  const c = d.edit ? C(d.edit) : {}, rec = c.type === 'recurring';
  return `${mhead(d.edit ? 'Edit chore' : 'Add chore')}${field('cn', 'Chore name (required)', '', c.name || '')}${field('cd', 'Description (optional)', '', c.desc || '')}
<label class="fld"><span>Assigned to (required)</span><select id="ca" class="input" onchange="A.choreForm()"><option value="">Choose…</option>${S.order.map(i => `<option value="${i}" ${c.assignee === i && !c.rotate ? 'selected' : ''}>${name(i)}</option>`).join('')}<option value="rotate" ${c.rotate ? 'selected' : ''}>🔄 Rotate</option></select></label>
<div class="fld"><span>How often</span><div class="seg" style="width:fit-content"><button type="button" id="b1" class="${rec ? '' : 'on'}" onclick="A.choreType('one-time')">One-time</button><button type="button" id="b2" class="${rec ? 'on' : ''}" onclick="A.choreType('recurring')">Recurring</button></div><input type="hidden" id="ct" value="${rec ? 'recurring' : 'one-time'}"></div>
<div id="f1" class="${rec ? 'hide' : ''} grid2">${field('c1d', 'Due date (required)', 'type="date"', c.type === 'one-time' ? c.date : '')}${field('c1t', 'Time', 'type="time"', c.time || '18:00')}</div>
<div id="f2" class="${rec ? '' : 'hide'} stack"><div class="fld"><span>Repeats on (pick at least one)</span><div class="row" style="flex-wrap:wrap">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x, i) => `<label class="chip row" style="gap:5px"><input type="checkbox" class="dw" value="${i}" ${(c.days || []).includes(i) ? 'checked' : ''}>${x}</label>`).join('')}</div></div>
<div class="grid2">${field('c2t', 'Time', 'type="time"', c.time || '18:00')}${field('c2s', 'Start date', 'type="date"', TODAY)}</div>
<label class="fld"><span>Frequency</span><select class="input"><option>Weekly</option><option>Every 2 weeks</option></select></label>
<div id="rot" class="${c.rotate ? '' : 'hide'} fld"><span>Rotation order (at least one)</span><div class="row" style="flex-wrap:wrap">${S.order.map(i => `<label class="chip row" style="gap:5px"><input type="checkbox" class="ro" value="${i}" ${(c.rotation || S.order).includes(i) ? 'checked' : ''}>${name(i)}</label>`).join('')}</div></div></div>
<div class="grid2"><label class="fld"><span>Effort (optional)</span><select id="cef" class="input">${['easy', 'medium', 'hard'].map(x => `<option ${c.effort === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>${field('cno', 'Notes (optional)', '', c.notes || '')}</div>
<label class="row"><input type="checkbox" class="tog" id="ccal" ${c.cal === false ? '' : 'checked'}><span>Add to shared calendar</span></label>${errBox}
<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.saveChore('${d.edit || ''}')">${d.edit ? 'Save' : 'Add chore'}</button></div>`;
};
A.choreType = t => { document.getElementById('ct').value = t; document.getElementById('f1').classList.toggle('hide', t !== 'one-time'); document.getElementById('f2').classList.toggle('hide', t !== 'recurring'); document.getElementById('b1').classList.toggle('on', t === 'one-time'); document.getElementById('b2').classList.toggle('on', t === 'recurring'); };
A.choreForm = () => document.getElementById('rot').classList.toggle('hide', v('ca') !== 'rotate');
A.saveChore = edit => {
  const errs = [], rec = v('ct') === 'recurring', days = [...document.querySelectorAll('.dw')].filter(x => x.checked).map(x => +x.value), rot = [...document.querySelectorAll('.ro')].filter(x => x.checked).map(x => x.value), rotate = v('ca') === 'rotate';
  if (!v('cn').trim()) errs.push({ id: 'cn', msg: 'Chore name is required.' });
  if (!v('ca')) errs.push({ id: 'ca', msg: 'Choose who it’s assigned to (or Rotate).' });
  if (!rec && !v('c1d')) errs.push({ id: 'c1d', msg: 'Due date is required for a one-time chore.' });
  if (rec && !days.length) errs.push({ id: 'c2t', msg: 'Pick at least one day of the week.' });
  if (rec && rotate && !rot.length) errs.push({ id: 'ca', msg: 'Pick at least one person in the rotation.' });
  if (errs.length) return fail(errs);
  const start = v('c2s') || TODAY; let date = v('c1d');
  if (rec) { let d = start < TODAY ? TODAY : start; while (!days.includes(pd(d).getDay())) d = addDays(d, 1); date = d; }
  const o = { name: v('cn').trim(), desc: v('cd').trim(), assignee: rotate ? rot[0] : v('ca'), type: rec ? 'recurring' : 'one-time', days: rec ? days : [], time: rec ? v('c2t') : v('c1t'), date, effort: v('cef'), notes: v('cno'), rotate, rotation: rotate ? rot : undefined, cal: chk('ccal'), start: rec ? start : undefined };
  if (edit) Object.assign(C(edit), o); else S.chores.push({ id: 'c' + Date.now(), by: S.me, status: 'pending', lastDone: null, ...o });
  UI.modal = null; toast(`${edit ? 'Saved' : 'Added'}. ${name(o.assignee)} ${o.assignee === S.me ? 'has' : 'was notified of'} this chore${o.cal ? ' and it’s on the calendar' : ''}.`); render();
};

/* ================= SETTINGS ================= */
PAGES.settings = () => {
  const me = U(S.me), can = canManage(), lock = can ? '' : 'disabled', tag = can ? '' : '<span class="badge gray">🔒 Owner only</span>';
  const row = (l, inner) => `<div class="item row sp"><span>${l}</span>${inner}</div>`;
  return `${phead('Your space', 'Settings', 'The people and details behind ' + esc(S.house.name) + '.')}
<section class="card hero-card"><div class="row sp"><div><div class="eyebrow">${esc(S.house.type || 'Household')}</div><h2 style="font-size:22px;margin-top:4px">${esc(S.house.name)}</h2><p class="mute">${esc(S.house.address || '')} · ${S.order.length} roommates</p></div>${badge(me.role === 'owner' ? 'Owner' : 'Member', me.role === 'owner' ? '' : 'good')}</div></section>
<div class="grid2"><section class="card"><h2>Home settings</h2>
${row('Your role', badge(me.role === 'owner' ? 'Owner' : 'Member'))}
${row('Currency ' + tag, `<select class="input" style="width:auto" ${lock} onchange="S.house.currency=this.value;toast('Currency updated')">${['USD', 'EUR', 'GBP', 'CAD'].map(c => `<option ${S.house.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
${row('Address ' + tag, `<input class="input" style="width:60%" ${lock} value="${esc(S.house.address)}" onchange="S.house.address=this.value;toast('Address saved')">`)}
${row('Home type ' + tag, `<select class="input" style="width:auto" ${lock} onchange="S.house.type=this.value;toast('Saved')">${['Apartment', 'House', 'Dorm', 'Townhouse'].map(c => `<option ${S.house.type === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
${row('Theme color ' + tag, `<div class="row" style="gap:6px">${Object.entries(COLORS).map(([k, c]) => `<button class="sw ${S.house.color === k ? 'on' : ''}" style="background:${c};width:26px;height:26px;${can ? '' : 'opacity:.4;cursor:not-allowed'}" ${lock} aria-label="${k}" onclick="A.accent('${k}')"></button>`).join('')}</div>`)}
${row('Manage members', '<a class="btn s" href="#/members">Open</a>')}
${row('Invite roommates ' + tag, `<a class="btn s ${can ? '' : 'off'}" ${can ? 'href="#/invite"' : 'aria-disabled="true"'}>Invite</a>`)}
${row('Leave household', '<button class="btn s d" onclick="A.leaveAsk()">Leave</button>')}</section>
<section class="card"><h2>Personal settings</h2>
${row('Payment methods ' + (hasPay(me) ? '' : badge('Add one', 'warn')), '<button class="btn s" onclick="A.modal(\'pm\')">Edit</button>')}
${row('Dark mode', `<input type="checkbox" class="tog" ${UI.dark ? 'checked' : ''} onchange="A.theme(this.checked)">`)}
${row('Sign-in info', `<span class="mute">${esc(me.email)}</span>`)}
${row('Profile photo', '<a class="btn s" href="#/profile">Change</a>')}
${row('Language', '<select class="input" style="width:auto" onchange="toast(\'Language saved\')"><option>English</option><option>Español</option><option>Français</option></select>')}
${row('FAQs', '<button class="btn s" onclick="A.modal(\'info\',{title:\'FAQs\',body:\'How do I split a bill? Finances, then Log expense. How do I swap a chore? Open the chore and pick one to trade.\'})">Open</button>')}
${row('Feedback / report a problem', '<button class="btn s" onclick="A.modal(\'feedback\')">Send</button>')}
${row('Legal information', '<button class="btn s" onclick="A.modal(\'info\',{title:\'Legal\',body:\'Terms of Service and Privacy Policy (mockup placeholder).\'})">View</button>')}
${row('Rate and share the app', '<button class="btn s" onclick="toast(\'Opening share sheet…\')">Share</button>')}
${row('Social links', '<button class="btn s" onclick="toast(\'Opening Instagram…\')">Follow</button>')}
${row('Delete account', '<button class="btn s d" onclick="A.deleteAsk()">Delete</button>')}
${row('App version', '<span class="mute">1.0.0 (mockup)</span>')}</section></div>`;
};
MODALS.pm = () => { const u = U(S.me); return `${mhead('Payment methods')}${field('vn', 'Venmo (encouraged)', 'placeholder="@username"', u.venmo)}${field('zl', 'Zelle (email or phone)', '', u.zelle)}${field('ap', 'Apple Cash (phone)', '', u.apple)}${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="A.savePM()">Save</button></div>`; };
A.savePM = () => {
  const vn = v('vn').trim(), zl = v('zl').trim(), ap = v('ap').trim(), dg = s => s.replace(/\D/g, '').length, errs = [];
  if (vn && !/^@[\w.-]{3,}$/.test(vn)) errs.push({ id: 'vn', msg: 'Venmo handle should look like @username.' });
  if (zl && !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(zl) || dg(zl) >= 10)) errs.push({ id: 'zl', msg: 'Zelle needs an email or 10-digit phone.' });
  if (ap && dg(ap) < 10) errs.push({ id: 'ap', msg: 'Apple Cash needs a 10-digit phone.' });
  if (errs.length) return fail(errs);
  Object.assign(U(S.me), { venmo: vn, zelle: zl, apple: ap }); UI.modal = null; toast('Payment methods saved'); render();
};
MODALS.feedback = () => `${mhead('Send feedback')}<textarea id="fb" class="input" rows="4" placeholder="What’s going on?"></textarea>${errBox}<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p" onclick="v('fb').trim()?(A.close(),toast('Thanks, feedback sent')):fail([{id:'fb',msg:'Write something first.'}])">Send</button></div>`;
A.leaveAsk = () => {
  const w = unsettled();
  if (isOwner() && others().length) return A.modal('transfer');
  A.modal('confirm', { title: 'Leave household?', body: 'You’ll lose access to this household’s data.', warn: w, on: 'A.leave()', danger: 1, ok: 'Leave' });
};
MODALS.transfer = () => `${mhead('Transfer ownership')}<p>You’re the owner. Pick who takes over before you leave.</p>${unsettled() ? `<div class="note">${unsettled()}</div>` : ''}<select id="nw" class="input">${others().map(i => `<option value="${i}">${name(i)}</option>`).join('')}</select><div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p d" onclick="A.leave(v('nw'))">Transfer and leave</button></div>`;
A.leave = newOwner => { if (newOwner) U(newOwner).role = 'owner'; const me = U(S.me), keep = { ...me, role: 'owner' }; S = emptySeed(['u1']); S.users.u1 = keep; UI.modal = null; toast('You left the household'); location.hash = '#/choose'; render(); };
A.deleteAsk = () => A.modal('confirm', { title: 'Delete account?', body: 'This permanently deletes your account and can’t be undone.', warn: unsettled(), on: 'A.deleteAcct()', danger: 1, ok: 'Delete account' });
A.deleteAcct = () => { S = seed(); UI.newAcct = false; UI.up = false; UI.modal = null; toast('Account deleted'); location.hash = '#/signin'; render(); };

/* ================= 24. MEMBERS ================= */
PAGES.members = () => {
  const own = isOwner();
  return `<div class="ph"><div class="row"><button class="btn s" onclick="location.hash='#/settings'">← Back</button><h1>${esc(S.house.name)}</h1></div>${own ? '<a class="btn p" href="#/invite">Invite</a>' : ''}</div>
<section class="card"><h2>${S.order.length} member${S.order.length === 1 ? '' : 's'}</h2>${S.order.map(i => { const u = U(i); return `<div class="item row">${av(i)}<div class="grow click" onclick="A.modal('member',{id:'${i}'})"><b>${esc(u.first)} ${esc(u.last)}${i === S.me ? ' (you)' : ''}</b><div class="mute" style="font-size:13px">${u.role === 'owner' ? 'Owner' : u.manage ? 'Member · can manage home' : 'Member'}</div></div>
${own && i !== S.me ? `<label class="row" style="font-size:12px" title="Allow managing home settings"><input type="checkbox" class="tog" ${u.manage ? 'checked' : ''} onchange="U('${i}').manage=this.checked;toast(this.checked?'Permissions granted':'Permissions removed');render()" aria-label="Can manage home"></label><button class="btn s d" onclick="A.modal('removeMember',{id:'${i}'})">Remove</button>` : ''}</div>`; }).join('')}
${own ? '<p class="mute" style="font-size:12px">Toggle lets a member change home settings.</p>' : '<p class="mute" style="font-size:12px">Only the owner can invite, remove, or grant permissions.</p>'}</section>`;
};
MODALS.member = d => { const u = U(d.id); return `${mhead(esc(u.first) + ' ' + esc(u.last))}<div class="row">${av(d.id, 'xl')}<div><b>${u.role === 'owner' ? 'Owner' : 'Member'}</b><div class="mute">${esc(u.location || '')}</div></div></div>
<div class="item">📞 ${esc(u.phone || 'Not shared')}</div><div class="item">✉️ ${esc(u.email || 'Not shared')}</div><div class="item">⚠️ Allergies: ${esc(u.allergies || 'None listed')}</div>
<div class="item">💸 ${['Venmo', 'Zelle', 'Apple Cash'].filter(m => handleOf(u, m)).map(m => `${m}: ${esc(handleOf(u, m))}`).join(' · ') || 'No payment handle yet'}</div>`; };
MODALS.removeMember = d => {
  const u = U(d.id), n = net(S.me, d.id), cs = S.chores.filter(c => c.assignee === d.id), rest = S.order.filter(i => i !== d.id);
  const owe = outstanding().filter(o => o.uid === d.id || o.p.buyer === d.id).length;
  return `${mhead('Remove ' + esc(u.first) + '?')}${owe ? `<div class="note">${esc(u.first)} has outstanding balances${n ? ` (net ${money(Math.abs(n))} ${n > 0 ? 'owed to you' : 'you owe'})` : ''}. Settle first or remove anyway.</div>` : ''}
${cs.length ? `<p><b>Reassign ${cs.length} chore${cs.length > 1 ? 's' : ''}:</b></p>${cs.map(c => `<div class="row sp"><span>${esc(c.name)}</span><select id="ra-${c.id}" class="input" style="width:auto">${rest.map(i => `<option value="${i}">${name(i)}</option>`).join('')}</select></div>`).join('')}` : ''}
<div class="acts"><button class="btn" onclick="A.close()">Cancel</button><button class="btn p d" onclick="A.removeMember('${d.id}')">Remove</button></div>`;
};
A.removeMember = id => {
  S.chores.filter(c => c.assignee === id).forEach(c => c.assignee = v('ra-' + c.id));
  S.chores.forEach(c => { if (c.rotation) c.rotation = c.rotation.filter(i => i !== id); });
  const nm = U(id).first; S.order = S.order.filter(i => i !== id); UI.modal = null; toast(nm + ' removed'); render();
};

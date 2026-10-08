// Slice (a): Expense tracker. Balances are CALCULATED on the server from expenses, shares and payments;
// this page only displays them. Amounts arrive as strings ("12.34") and are converted to integer cents
// with the same shared money helpers the API uses.
import { actions, forms, inputs } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { avatar, badge, closeModal, empty, esc, fmtDay, fullName, ico, mhead, money, openModal, phead, seg, showError, toast } from '../lib/dom.js';
import { fromCents, splitCents, toCents } from '../../shared/money.ts';

let tab = 'settle';
let D = null; // { members, bal, expenses, wish } for the modals

const APP_LABEL = { venmo: 'Venmo', zelle: 'Zelle', apple_cash: 'Apple Cash' };
const $m = (str) => money(toCents(str));
const hid = () => household().householdId;
const who = (id) => D.members.find((m) => m.userId === id);
const first = (id) => (id === S.user.userId ? 'You' : who(id)?.firstName ?? 'Someone');
const nm = (id) => (id === S.user.userId ? 'you' : who(id)?.firstName ?? 'someone');
const active = () => D.members.filter((m) => !m.leftDate);
const STATUS = { buyer: ['buyer', 'Bought it'], unpaid: ['unpaid', 'Owes'], pending: ['pending', 'Sent, waiting'], paid: ['paid', 'Paid back'], disputed: ['disputed', 'Disputed'] };
const stChip = (status) => `<span class="st ${STATUS[status][0]}">${STATUS[status][1]}</span>`;

export async function financesView() {
  const h = hid();
  const [{ members }, bal, { expenses }] = await Promise.all([api(`/households/${h}/members`), api(`/households/${h}/balances`), api(`/households/${h}/expenses`)]);
  D = { members, bal, expenses, wish: D?.wish ?? [] };
  if (tab === 'wish') D.wish = (await api(`/households/${h}/wishlist`)).items;
  const action = tab === 'settle' ? `<button class="btn p" data-action="add-expense">${ico('plus', 16)} Log expense</button>` : `<button class="btn p" data-action="add-wish">${ico('plus', 16)} Add item</button>`;
  return `${phead('Shared money', 'Finances', 'Keep every shared cost clear and accounted for.', action)}
  ${seg([['settle', 'Settle payments'], ['wish', 'Wish list']], tab, 'fin-tab')}
  ${tab === 'settle' ? settleView() : wishView()}`;
}
actions['fin-tab'] = (el) => { tab = el.dataset.value; window.dispatchEvent(new Event('roomie:render')); };

// ---- settle tab -------------------------------------------------------------------------------
function person(id, extra = '') { const m = who(id); return `<div class="row" style="gap:10px;min-width:0">${avatar(m)}<div style="min-width:0"><b class="truncate">${esc(first(id))}</b>${m?.leftDate ? ' <span class="mute" style="font-size:12px">(moved out)</span>' : ''}${extra}</div></div>`; }

function settleView() {
  const { bal } = D;
  const mine = bal.mine.map((b) => {
    const cents = toCents(b.signedAmount);
    const owe = cents < 0;
    const payable = bal.payable.some((p) => p.payeeUserId === b.otherUserId);
    const note = toCents(b.pendingAmount) > 0 ? `<div class="hint">${$m(b.pendingAmount)} sent, waiting for ${owe ? esc(nm(b.otherUserId)) : 'you'} to confirm</div>` : '';
    const dis = toCents(b.disputedAmount) > 0 ? `<div class="hint" style="color:var(--bad)">${$m(b.disputedAmount)} is disputed</div>` : '';
    return `<div class="item row">${person(b.otherUserId, `<div class="${owe ? 'bad' : 'good'}" style="font-size:13px">${owe ? 'you owe' : 'owes you'} <b class="amount">${money(Math.abs(cents))}</b></div>${note}${dis}`)}
      <div class="grow"></div>${owe && payable ? `<button class="btn p s" data-action="pay" data-payee="${b.otherUserId}">Pay back</button>` : ''}</div>`;
  }).join('');

  const incoming = bal.incoming.map((p) => `<div class="item"><div class="row t">${avatar(who(p.payerUserId))}<div class="grow"><b>${esc(first(p.payerUserId))}</b> says they paid you <b class="amount">${$m(p.amount)}</b> via ${APP_LABEL[p.paidWith]}
      <div class="hint">${p.items.map((i) => esc(i.itemName)).join(', ')}</div>
      ${p.status === 'disputed' ? '<div style="margin-top:2px">' + stChip('disputed') + '</div>' : ''}
      <div class="acts" style="justify-content:flex-start;margin-top:8px"><button class="btn p s" data-action="review" data-payment="${p.paymentId}" data-status="confirmed">${p.status === 'disputed' ? 'Mark received' : 'Got it'}</button>${p.status === 'sent' ? `<button class="btn s" data-action="review" data-payment="${p.paymentId}" data-status="disputed">Did not get it</button>` : ''}</div></div></div></div>`).join('');
  const outgoing = bal.outgoing.map((p) => `<div class="item row">${person(p.payeeUserId, `<div class="hint">You sent ${$m(p.amount)} via ${APP_LABEL[p.paidWith]}</div>`)}<div class="grow"></div>${stChip(p.status === 'sent' ? 'pending' : 'disputed')}</div>`).join('');

  const pairs = bal.pairs.map((p) => `<div class="item row">${avatar(who(p.debtorUserId), 'sm')}<span class="grow"><b>${esc(first(p.debtorUserId))}</b> ${p.debtorUserId === S.user.userId ? 'owe' : 'owes'} <b>${esc(first(p.creditorUserId))}</b></span><b class="amount">${$m(p.amount)}</b></div>`).join('');

  return `<div class="grid2">
    <section class="card"><div class="row sp"><h2>Your balances</h2>${badge(mine ? 'Open' : 'All square', mine ? 'warn' : 'good')}</div>
      ${mine || `<p class="mute" style="padding:10px 0">You don't owe anyone, and no one owes you. Log an expense when you buy something for the house.</p>`}</section>
    <section class="card"><div class="row sp"><h2>Who owes who</h2>${badge(`${bal.pairs.length}`, 'gray')}</div>
      ${pairs || `<p class="mute" style="padding:10px 0">Everyone in the house is square.</p>`}</section>
  </div>
  ${incoming || outgoing ? `<div class="grid2">
    ${incoming ? `<section class="card"><h2>Waiting on you</h2>${incoming}</section>` : ''}
    ${outgoing ? `<section class="card"><h2>You sent</h2>${outgoing}</section>` : ''}</div>` : ''}
  <section class="card"><div class="row sp"><h2>Past purchases</h2>${badge(`${D.expenses.length}`, 'gray')}</div>
    ${D.expenses.length ? D.expenses.map(expenseRow).join('') : empty('🧾', 'No purchases yet', 'Log the first shared purchase and the split is figured out for you.', '<button class="btn p" data-action="add-expense">Log expense</button>')}</section>`;
}

function expenseRow(e) {
  const others = e.shares.filter((s) => s.userId !== e.paidByUserId);
  return `<div class="item exp" data-action="expense" data-id="${e.expenseId}"><div class="grow"><b class="truncate">${esc(e.itemName)}</b>
    <div class="hint">${fmtDay(e.purchaseDate)} · ${esc(first(e.paidByUserId))} paid</div>
    <div class="chips">${others.map((s) => `<span class="sharechip">${avatar(who(s.userId), 'sm')}${$m(s.amountOwed)} ${stChip(s.status)}</span>`).join('')}</div></div>
    <div class="amt">${$m(e.totalAmount)}</div></div>`;
}

actions.review = async (el) => {
  const status = el.dataset.status;
  await api(`/households/${hid()}/payments/${el.dataset.payment}`, { method: 'PATCH', body: { status } });
  toast(status === 'confirmed' ? 'Marked as received' : 'Marked as not received. They will be told.');
  window.dispatchEvent(new Event('roomie:render'));
};

// ---- expense detail ---------------------------------------------------------------------------
actions.expense = (el) => {
  const e = D.expenses.find((x) => x.expenseId === Number(el.dataset.id)); if (!e) return;
  openModal(`${mhead(esc(e.itemName))}
    <div class="tot">${$m(e.totalAmount)}</div><p class="mute">${fmtDay(e.purchaseDate, { weekday: 'long', month: 'long', day: 'numeric' })} · paid by ${esc(first(e.paidByUserId).toLowerCase() === 'you' ? 'you' : first(e.paidByUserId))}</p>
    <div>${e.shares.map((s) => `<div class="item row">${avatar(who(s.userId), 'sm')}<span class="grow">${esc(first(s.userId))}</span><b class="amount">${$m(s.amountOwed)}</b>${stChip(s.status)}</div>`).join('')}</div>
    <p class="hint">The buyer's own share is never owed. A share counts as paid back only after the buyer confirms the payment.</p>
    ${e.canDelete ? `<div class="acts"><button class="btn d" data-action="delete-expense" data-id="${e.expenseId}">Delete</button></div>` : ''}`);
};
actions['delete-expense'] = async (el) => {
  if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'Really delete? Tap again'; return; }
  await api(`/households/${hid()}/expenses/${el.dataset.id}`, { method: 'DELETE' });
  closeModal(); toast('Expense deleted'); window.dispatchEvent(new Event('roomie:render'));
};

// ---- log an expense ---------------------------------------------------------------------------
actions['add-expense'] = async (_el, _e, preset = {}) => {
  const wish = (await api(`/households/${hid()}/wishlist`)).items.filter((w) => !w.isBought);
  D.wish = wish;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: household().timezone }).format(new Date());
  const others = active().filter((m) => m.userId !== S.user.userId);
  openModal(`${mhead('Log an expense')}
    <form class="stack" data-form="expense" autocomplete="off">
      ${wish.length ? `<label class="fld"><span>From the wish list (optional)</span><select class="input" name="wishlistItemId" data-input="wish-pick"><option value="">Not from the wish list</option>${wish.map((w) => `<option value="${w.wishlistItemId}" data-name="${esc(w.itemName)}" data-price="${esc(w.estimatedPrice ?? '')}">${esc(w.itemName)}${w.estimatedPrice ? ' (about ' + $m(w.estimatedPrice) + ')' : ''}</option>`).join('')}</select></label>` : ''}
      <label class="fld"><span>What did you buy?</span><input class="input" name="itemName" required maxlength="120" placeholder="Paper towels" value="${esc(preset.itemName ?? '')}"></label>
      <div class="grid2" style="gap:12px">
        <label class="fld"><span>Total</span><input class="input" name="totalAmount" required inputmode="decimal" pattern="\\d{1,7}(\\.\\d{1,2})?" placeholder="24.99" data-input="split" value="${esc(preset.totalAmount ?? '')}"></label>
        <label class="fld"><span>Date</span><input class="input" name="purchaseDate" type="date" value="${today}" max="${today}"></label>
      </div>
      <div class="fld"><span>Split between</span>
        <div class="stack" style="gap:8px">
          <label class="chk off"><input type="checkbox" checked disabled> ${avatar(S.user, 'sm')} You (you paid)</label>
          ${others.map((m) => `<label class="chk"><input type="checkbox" name="p" value="${m.userId}" checked data-input="split"> ${avatar(m, 'sm')} ${esc(fullName(m))}</label>`).join('')}
        </div>
      </div>
      <div class="hint" id="split-preview"></div>
      <div class="err" role="alert"></div>
      <div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">Log expense</button></div>
    </form>`);
  inputs.split();
};
inputs['wish-pick'] = (el) => {
  const o = el.selectedOptions[0]; const f = el.form;
  if (!o?.value) return;
  f.itemName.value = o.dataset.name || ''; if (o.dataset.price) f.totalAmount.value = o.dataset.price; inputs.split();
};
inputs.split = () => {
  const f = document.querySelector('form[data-form=expense]'); const out = document.getElementById('split-preview'); if (!f || !out) return;
  const picked = [...f.querySelectorAll('input[name=p]:checked')];
  let total; try { total = toCents(f.totalAmount.value.trim()); } catch { total = 0; }
  if (!picked.length) { out.textContent = 'Pick at least one roommate to split with.'; return; }
  if (total <= 0) { out.textContent = `Split ${picked.length + 1} ways.`; return; }
  if (total < picked.length + 1) { out.textContent = 'That total is too small to split that many ways.'; return; }
  const parts = splitCents(total, picked.length + 1);
  out.textContent = parts[0] === parts[parts.length - 1] ? `${picked.length + 1} ways: ${money(parts[0])} each.` : `${picked.length + 1} ways: you pay ${money(parts[0])}, the others ${money(parts[parts.length - 1])} (leftover cents go to the first shares).`;
};
forms.expense = async (form) => {
  const f = new FormData(form);
  const body = { itemName: f.get('itemName'), totalAmount: String(f.get('totalAmount')).trim(), purchaseDate: f.get('purchaseDate'), participantUserIds: f.getAll('p').map(Number) };
  if (f.get('wishlistItemId')) body.wishlistItemId = Number(f.get('wishlistItemId'));
  try { await api(`/households/${hid()}/expenses`, { method: 'POST', body }); } catch (e) { return showError(form, e.message); }
  closeModal(); toast('Expense logged. Your roommates were notified.'); window.dispatchEvent(new Event('roomie:render'));
};

// ---- pay back ---------------------------------------------------------------------------------
actions.pay = (el) => {
  const payee = Number(el.dataset.payee);
  const items = D.bal.payable.filter((p) => p.payeeUserId === payee);
  const methods = D.bal.paymentMethods[payee] ?? [];
  const pref = methods.find((m) => m.isPreferred)?.app ?? methods[0]?.app ?? 'venmo';
  openModal(`${mhead(`Pay back ${esc(first(payee))}`)}
    <form class="stack" data-form="pay" data-payee="${payee}" autocomplete="off">
      <div class="fld"><span>Which purchases?</span><div class="stack" style="gap:8px">
        ${items.map((p) => `<label class="chk"><input type="checkbox" name="e" value="${p.expenseId}" data-amount="${esc(p.amountOwed)}" checked data-input="pay-total"> <span class="grow"><b>${esc(p.itemName)}</b><div class="hint">${fmtDay(p.purchaseDate)}</div></span><b class="amount">${$m(p.amountOwed)}</b></label>`).join('')}</div></div>
      <div class="rowline"><span class="mute">You are paying</span><span class="tot" id="pay-total">${money(items.reduce((a, p) => a + toCents(p.amountOwed), 0))}</span></div>
      <div class="fld"><span>How are you sending it?</span><div class="methods">
        ${['venmo', 'zelle', 'apple_cash'].map((app) => { const m = methods.find((x) => x.app === app); return `<label><input type="radio" name="paidWith" value="${app}" ${app === pref ? 'checked' : ''} data-input="pay-total">${APP_LABEL[app]}<small>${m ? esc(m.username) : 'no handle added'}</small></label>`; }).join('')}</div></div>
      <div class="steps" id="pay-steps"></div>
      <div class="err" role="alert"></div>
      <div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">I sent it</button></div>
      <p class="hint">Roomie never moves money. Send it in your payment app, then tap "I sent it". ${esc(first(payee))} confirms when it arrives, and only then does the balance go down.</p>
    </form>`);
  inputs['pay-total']();
};
inputs['pay-total'] = () => {
  const f = document.querySelector('form[data-form=pay]'); if (!f) return;
  const payee = Number(f.dataset.payee);
  const picked = [...f.querySelectorAll('input[name=e]:checked')];
  const cents = picked.reduce((a, c) => a + toCents(c.dataset.amount), 0);
  document.getElementById('pay-total').textContent = money(cents);
  f.querySelector('[type=submit]').disabled = !picked.length;
  const app = f.querySelector('input[name=paidWith]:checked')?.value; const m = (D.bal.paymentMethods[payee] ?? []).find((x) => x.app === app);
  const steps = document.getElementById('pay-steps');
  const handle = m ? m.username : null;
  let link = '';
  if (app === 'venmo' && handle && /^@?[A-Za-z0-9._-]{1,40}$/.test(handle)) {
    const note = encodeURIComponent(`Roomie: ${picked.map((c) => c.closest('label').querySelector('b').textContent).join(', ')}`.slice(0, 120));
    link = `<a class="btn" target="_blank" rel="noopener noreferrer" href="https://venmo.com/${encodeURIComponent(handle.replace(/^@/, ''))}?txn=pay&amount=${fromCents(cents)}&note=${note}">Open Venmo with ${money(cents)} filled in</a>`;
  }
  steps.innerHTML = handle ? `<div class="hint">Send <b>${money(cents)}</b> to <b>${esc(handle)}</b> in ${APP_LABEL[app]}.</div>${link}` : `<div class="hint">${esc(first(payee))} has not added a ${APP_LABEL[app]} handle. Pick another app, or ask them for it.</div>`;
};
forms.pay = async (form) => {
  const f = new FormData(form);
  const body = { payeeUserId: Number(form.dataset.payee), expenseIds: f.getAll('e').map(Number), paidWith: f.get('paidWith') };
  try { await api(`/households/${hid()}/payments`, { method: 'POST', body }); } catch (e) { return showError(form, e.message); }
  closeModal(); toast('Marked as sent. Waiting for them to confirm.'); window.dispatchEvent(new Event('roomie:render'));
};

// ---- wish list --------------------------------------------------------------------------------
function wishView() {
  const open = D.wish.filter((w) => !w.isBought), done = D.wish.filter((w) => w.isBought);
  const row = (w) => `<div class="item exp" data-action="wish" data-id="${w.wishlistItemId}"><div class="grow"><b class="truncate">${esc(w.itemName)}</b>
    <div class="hint">${esc(first(w.createdByUserId))} added it${w.estimatedPrice ? ' · about ' + $m(w.estimatedPrice) : ''}</div></div>
    ${badge(w.needOrWant === 'need' ? 'Need' : 'Want', w.needOrWant === 'need' ? 'warn' : '')}${w.isBought ? badge('Bought', 'good') : ''}</div>`;
  return `<section class="card"><div class="row sp"><h2>Wish list</h2>${badge(`${open.length} to buy`, 'gray')}</div>
    ${open.length ? open.map(row).join('') : empty('🛒', 'Nothing on the list', 'Add things the house needs or wants. Anyone can buy them and split the cost.', '<button class="btn p" data-action="add-wish">Add an item</button>')}</section>
    ${done.length ? `<section class="card"><h2>Already bought</h2>${done.map(row).join('')}</section>` : ''}`;
}
const wishForm = (w = {}) => `
  <label class="fld"><span>Item</span><input class="input" name="itemName" required maxlength="120" value="${esc(w.itemName ?? '')}" placeholder="Air fryer"></label>
  <div class="grid2" style="gap:12px"><label class="fld"><span>Need or want?</span><select class="input" name="needOrWant"><option value="need" ${w.needOrWant === 'need' ? 'selected' : ''}>Need</option><option value="want" ${w.needOrWant !== 'need' ? 'selected' : ''}>Want</option></select></label>
  <label class="fld"><span>Price (about)</span><input class="input" name="estimatedPrice" inputmode="decimal" pattern="\\d{1,7}(\\.\\d{1,2})?" placeholder="59.99" value="${esc(w.estimatedPrice ?? '')}"></label></div>
  <label class="fld"><span>Link (optional)</span><input class="input" name="itemLink" type="url" maxlength="500" placeholder="https://" value="${esc(w.itemLink ?? '')}"></label>
  <label class="fld"><span>Why does the house need it? (optional)</span><textarea class="input" name="description" rows="2" maxlength="500">${esc(w.description ?? '')}</textarea></label>`;
actions['add-wish'] = () => openModal(`${mhead('Add to the wish list')}<form class="stack" data-form="wish-add">${wishForm()}<div class="err" role="alert"></div><div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">Add item</button></div></form>`);
const wishBody = (form) => { const f = new FormData(form); return { itemName: f.get('itemName'), needOrWant: f.get('needOrWant'), estimatedPrice: String(f.get('estimatedPrice')).trim() || null, itemLink: String(f.get('itemLink')).trim() || null, description: String(f.get('description')).trim() || null }; };
forms['wish-add'] = async (form) => { try { await api(`/households/${hid()}/wishlist`, { method: 'POST', body: wishBody(form) }); } catch (e) { return showError(form, e.message); } closeModal(); toast('Added. Your roommates were notified.'); window.dispatchEvent(new Event('roomie:render')); };

actions.wish = (el) => {
  const w = D.wish.find((x) => x.wishlistItemId === Number(el.dataset.id)); if (!w) return;
  openModal(`${mhead(esc(w.itemName))}
    <div class="row" style="gap:8px">${badge(w.needOrWant === 'need' ? 'Need' : 'Want', w.needOrWant === 'need' ? 'warn' : '')}${w.isBought ? badge('Bought', 'good') : ''}<span class="mute">added by ${esc(first(w.createdByUserId).toLowerCase() === 'you' ? 'you' : first(w.createdByUserId))}</span></div>
    ${w.estimatedPrice ? `<div class="tot">about ${$m(w.estimatedPrice)}</div>` : ''}
    ${w.description ? `<p>${esc(w.description)}</p>` : ''}
    ${w.itemLink ? `<p><a class="btn link" href="${esc(w.itemLink)}" target="_blank" rel="noopener noreferrer">Open the link</a></p>` : ''}
    <div class="acts">${w.isBought ? '' : `<button class="btn p" data-action="buy-wish" data-id="${w.wishlistItemId}">I bought it</button>`}
      ${w.canEdit ? `<button class="btn" data-action="edit-wish" data-id="${w.wishlistItemId}">Edit</button><button class="btn d" data-action="delete-wish" data-id="${w.wishlistItemId}">Delete</button>` : ''}</div>
    ${w.canEdit ? '' : '<p class="hint">Only the person who added an item can edit or delete it.</p>'}`);
};
actions['buy-wish'] = async (el) => {
  const w = D.wish.find((x) => x.wishlistItemId === Number(el.dataset.id));
  await actions['add-expense'](el, null, { itemName: w.itemName, totalAmount: w.estimatedPrice ?? '' });
  const sel = document.querySelector('select[name=wishlistItemId]'); if (sel) { sel.value = String(w.wishlistItemId); inputs.split(); }
};
actions['edit-wish'] = (el) => {
  const w = D.wish.find((x) => x.wishlistItemId === Number(el.dataset.id));
  openModal(`${mhead('Edit item')}<form class="stack" data-form="wish-edit" data-id="${w.wishlistItemId}">${wishForm(w)}<div class="err" role="alert"></div><div class="acts"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn p" type="submit">Save</button></div></form>`);
};
forms['wish-edit'] = async (form) => { try { await api(`/households/${hid()}/wishlist/${form.dataset.id}`, { method: 'PATCH', body: wishBody(form) }); } catch (e) { return showError(form, e.message); } closeModal(); toast('Saved'); window.dispatchEvent(new Event('roomie:render')); };
actions['delete-wish'] = async (el) => {
  if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'Really delete? Tap again'; return; }
  await api(`/households/${hid()}/wishlist/${el.dataset.id}`, { method: 'DELETE' });
  closeModal(); toast('Deleted'); window.dispatchEvent(new Event('roomie:render'));
};

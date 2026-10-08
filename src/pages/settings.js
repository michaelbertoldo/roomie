import { actions } from '../lib/events.js';
import { api } from '../auth-client.js';
import { S, household } from '../lib/state.js';
import { avatar, badge, esc, fmtDate, fullName, phead, toast } from '../lib/dom.js';

export async function settingsView() {
  const h = household();
  const { members } = await api(`/households/${h.householdId}/members`);
  const current = members.filter((m) => !m.leftDate), former = members.filter((m) => m.leftDate);
  const row = (m) => `<div class="item row">${avatar(m)}<div class="grow"><b>${esc(fullName(m))}</b>${m.userId === S.user.userId ? ' <span class="mute">(you)</span>' : ''}
      <div class="mute" style="font-size:13px">${m.leftDate ? `Moved out ${fmtDate(m.leftDate, h.timezone)}` : `Joined ${fmtDate(m.joinedDate, h.timezone)}`}</div></div>${badge(m.role === 'owner' ? 'Owner' : 'Member', m.leftDate ? 'gray' : '')}</div>`;
  return `${phead('Your space', 'Settings', `The people and details behind ${esc(h.householdName)}.`)}
  <div class="grid2">
    <section class="card"><h2>Invite roommates</h2>
      <p class="mute" style="margin:6px 0 12px">Share this code. Anyone who signs up can join with it.</p>
      <div class="rowline"><span class="code">${esc(h.joinCode)}</span><button class="btn s" data-action="copy-code" data-code="${esc(h.joinCode)}">Copy</button></div>
      <hr class="hr"><div class="rowline"><span class="mute">Household timezone</span><b>${esc(h.timezone)}</b></div>
    </section>
    <section class="card"><h2>You</h2>
      <div class="item row">${avatar(S.user)}<div class="grow"><b>${esc(fullName(S.user))}</b><div class="mute" style="font-size:13px">${esc(S.user.email)}</div></div></div>
      <div class="acts" style="justify-content:flex-start;margin-top:12px"><button class="btn d" data-action="signout">Sign out</button></div>
    </section>
  </div>
  <section class="card"><h2>Household members</h2>${current.map(row).join('')}
    ${former.length ? `<div class="eyebrow" style="margin-top:16px">Moved out</div>${former.map(row).join('')}` : ''}</section>`;
}

actions['copy-code'] = async (el) => { try { await navigator.clipboard.writeText(el.dataset.code); toast('Join code copied'); } catch { toast(`Your code is ${el.dataset.code}`); } };

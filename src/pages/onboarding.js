import { actions, forms } from '../lib/events.js';
import { esc, mark, showError } from '../lib/dom.js';
import { api } from '../auth-client.js';
import { S } from '../lib/state.js';

export function onboardingView() {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [browserTz];
  return `<div class="onb"><div class="box">
    <div style="text-align:center">${mark('lg')}<h1 style="font-size:26px;font-weight:700;letter-spacing:-.03em;margin-top:14px">Hi ${esc(S.user?.firstName || 'there')}, let's find your house</h1><p class="mute">Join your roommates with a code, or start a new household.</p></div>
    <form class="card stack" data-form="join">
      <h2>Join with a code</h2>
      <label class="fld"><span>Join code</span><input class="input code" name="joinCode" required maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="MAPLE412" style="text-transform:uppercase"></label>
      <div class="err" role="alert"></div>
      <button class="btn p" type="submit">Join household</button>
    </form>
    <form class="card stack" data-form="create">
      <h2>Start a new household</h2>
      <label class="fld"><span>Household name</span><input class="input" name="householdName" required maxlength="80" placeholder="412 Maple St"></label>
      <label class="fld"><span>Address (optional)</span><input class="input" name="address" maxlength="200"></label>
      <label class="fld"><span>Timezone</span><select class="input" name="timezone">${zones.map((z) => `<option ${z === browserTz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
      <div class="err" role="alert"></div>
      <button class="btn" type="submit">Create household</button>
    </form>
    <p style="text-align:center"><button class="link-btn" data-action="signout">Sign out</button></p>
  </div></div>`;
}

forms.join = async (form) => {
  try { const r = await api('/households/join', { method: 'POST', body: { joinCode: new FormData(form).get('joinCode') } }); S.hid = r.householdId; }
  catch (e) { return showError(form, e.message); }
  window.dispatchEvent(new Event('roomie:reload'));
};
forms.create = async (form) => {
  const f = new FormData(form);
  try { const r = await api('/households', { method: 'POST', body: { householdName: f.get('householdName'), address: f.get('address'), timezone: f.get('timezone') } }); S.hid = r.householdId; }
  catch (e) { return showError(form, e.message); }
  window.dispatchEvent(new Event('roomie:reload'));
};

export const _a = actions;

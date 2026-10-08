import { actions, forms } from '../lib/events.js';
import { esc, mark, showError } from '../lib/dom.js';
import { signIn, signUp } from '../auth-client.js';

let mode = 'signin'; // 'signin' | 'signup'

export function authView() {
  const up = mode === 'signup';
  return `<div class="onb"><div class="box">
    <div style="text-align:center">${mark('lg')}<h1 style="font-size:30px;font-weight:700;letter-spacing:-.03em;margin-top:14px">Roomie</h1><p class="mute">Chores, costs, and plans for your house.</p></div>
    <form class="card stack" data-form="auth" autocomplete="on">
      <h2>${up ? 'Create your account' : 'Sign in'}</h2>
      ${up ? `<label class="fld"><span>Your name</span><input class="input" name="name" autocomplete="name" required maxlength="80" placeholder="Alex Rivera"></label>` : ''}
      <label class="fld"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required placeholder="you@school.edu"></label>
      <label class="fld"><span>Password</span><input class="input" name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" required minlength="8" placeholder="At least 8 characters"></label>
      <div class="err" role="alert"></div>
      <button class="btn p" type="submit">${up ? 'Create account' : 'Sign in'}</button>
      <p class="mute" style="text-align:center;font-size:14px">${up ? 'Already have an account?' : 'New here?'} <button type="button" class="link-btn" data-action="auth-toggle">${up ? 'Sign in' : 'Create an account'}</button></p>
    </form>
  </div></div>`;
}

actions['auth-toggle'] = () => { mode = mode === 'signin' ? 'signup' : 'signin'; window.dispatchEvent(new Event('roomie:render')); };

forms.auth = async (form) => {
  const f = new FormData(form);
  const email = String(f.get('email')).trim(), password = String(f.get('password'));
  try {
    if (mode === 'signup') await signUp(email, password, String(f.get('name')).trim());
    else await signIn(email, password);
  } catch (e) { return showError(form, e.message || 'Could not sign in'); }
  window.dispatchEvent(new Event('roomie:signedin'));
};

export const _esc = esc; // keep esc imported for future fields

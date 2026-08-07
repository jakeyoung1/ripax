/**
 * Sign-in UI. Button styling follows each provider's brand requirements:
 * Google wants its official mark on a white or dark button with the exact
 * "Sign in with Google" wording; Apple requires its logo, the phrase
 * "Sign in with Apple", and a black/white button with the correct corner radius.
 */

import { attr, esc } from './views.js';

const GOOGLE_MARK = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"/>
  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H1v2.34A9 9 0 0 0 9 18Z"/>
  <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.96H1a9 9 0 0 0 0 8.08l2.98-2.32Z"/>
  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.59A9 9 0 0 0 1 4.96l2.98 2.32C4.68 5.16 6.66 3.58 9 3.58Z"/>
</svg>`;

const APPLE_MARK = `<svg viewBox="0 0 16 20" width="16" height="18" aria-hidden="true" fill="currentColor">
  <path d="M13.36 10.6c.02 2.44 2.14 3.25 2.17 3.26-.02.05-.34 1.16-1.12 2.3-.68.99-1.38 1.97-2.49 1.99-1.09.02-1.44-.64-2.68-.64-1.24 0-1.63.62-2.66.66-1.07.04-1.88-1.06-2.56-2.04C2.6 14.1 1.53 10.43 2.96 7.95c.71-1.24 1.98-2.02 3.36-2.04 1.05-.02 2.04.71 2.68.71.64 0 1.85-.88 3.12-.75.53.02 2.02.19 2.97 1.45-.08.05-1.74 1.02-1.73 3.28M11.3 4.14c.56-.68.94-1.63.84-2.57-.83.03-1.83.55-2.41 1.23-.52.6-.98 1.57-.86 2.49.92.07 1.87-.47 2.43-1.15"/>
</svg>`;

/** Header slot: either the signed-in identity or a sign-in button. */
export function renderAuthSlot(user, providers) {
  if (user) {
    const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="account">
        <button class="account-btn" data-act="account" type="button" aria-label="Account menu">
          ${user.avatar
            ? `<img class="avatar" src="${attr(user.avatar)}" alt="" referrerpolicy="no-referrer">`
            : `<span class="avatar initial">${esc(initial)}</span>`}
          <span class="account-name">${esc(user.name || user.email || 'Account')}</span>
        </button>
        <div class="account-menu" id="account-menu" hidden>
          <div class="account-meta">
            ${user.email ? `<div class="account-email">${esc(user.email)}</div>` : ''}
            <div class="account-providers">
              via ${user.providers.map((p) => esc(providerLabel(p))).join(', ')}
            </div>
          </div>
          <button data-nav="collection" type="button">My collection</button>
          <button data-act="signout" type="button">Sign out</button>
        </div>
      </div>`;
  }

  const anyProvider = providers.providers.length > 0 || providers.devLogin;
  if (!anyProvider) return ''; // no auth configured: stay a purely local app

  return `<button class="btn small" data-act="signin" type="button">Sign in</button>`;
}

function providerLabel(provider) {
  return { google: 'Google', apple: 'Apple', dev: 'dev login' }[provider] || provider;
}

/** The sign-in modal. Only offers providers the server actually has configured. */
export function renderSignInModal(providers, returnTo) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';

  const google = providers.providers.includes('google')
    ? `<a class="oauth-btn google" href="/auth/google/start${query}">
         ${GOOGLE_MARK}<span>Sign in with Google</span>
       </a>`
    : '';

  const apple = providers.providers.includes('apple')
    ? `<a class="oauth-btn apple" href="/auth/apple/start${query}">
         ${APPLE_MARK}<span>Sign in with Apple</span>
       </a>`
    : '';

  const dev = providers.devLogin
    ? `<div class="dev-login">
         <div class="dev-label">Local testing</div>
         <div class="dev-row">
           <input id="dev-handle" type="text" placeholder="handle" value="jake" maxlength="24" autocomplete="off">
           <button class="btn sec small" data-act="devsignin" type="button">Dev sign in</button>
         </div>
         <p class="dev-note">
           Creates a local-only account so the collection sync can be tested
           before Google and Apple credentials are set up. Never enabled in production.
         </p>
       </div>`
    : '';

  const nothingReal = !google && !apple;

  return `
    <div class="modal-backdrop" data-act="closemodal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="signin-title">
        <button class="modal-x" data-act="closemodal" type="button" aria-label="Close">×</button>
        <h2 id="signin-title">Sign in to Ripax</h2>
        <p class="modal-sub">
          Keeps your collection on your account instead of one browser, so it
          survives a cleared cache and follows you between devices.
        </p>
        ${google}${apple}
        ${nothingReal ? `
          <p class="notice" style="margin:14px 0 0">
            Google and Apple sign-in are not configured on this server yet.
            Add credentials to <code>.env</code> — see
            <code>config/auth.example.env</code> for the exact steps.
          </p>` : ''}
        ${dev}
        <p class="modal-fine">
          Ripax stores your account id, email and what you've pulled. Nothing
          is sold, shared, or charged — there is no payment path in this app.
        </p>
      </div>
    </div>`;
}

/** Offered once, after a first sign-in with cards already in local storage. */
export function renderMergePrompt(localTotal) {
  return `
    <div class="modal-backdrop" data-act="closemodal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="merge-title">
        <h2 id="merge-title">Bring your cards with you?</h2>
        <p class="modal-sub">
          This browser has <b>${localTotal.toLocaleString()}</b> cards collected
          while you were signed out. Copy them into your account?
        </p>
        <div class="actions" style="margin:18px 0 0">
          <button class="btn" data-act="mergeyes" type="button">Copy to my account</button>
          <button class="btn sec" data-act="closemodal" type="button">Keep them local</button>
        </div>
        <p class="modal-fine">
          Copying adds them to whatever is already on your account, and clears
          them from this browser so they can't be counted twice. Say no and they
          stay here — you can copy them from your collection page any time.
        </p>
      </div>
    </div>`;
}

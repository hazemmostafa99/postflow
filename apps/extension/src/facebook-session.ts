/**
 * facebook-session.ts
 *
 * Injected into facebook.com pages.
 * Detects whether the user is logged into Facebook by checking for
 * the presence of the `c_user` cookie (set when the user is logged in).
 * Reports the session status to the background service worker.
 */

function isFacebookLoggedIn(): boolean {
  return document.cookie.split(';').some((c) => c.trim().startsWith('c_user='));
}

const sessionDetected = isFacebookLoggedIn();
console.log('[PostFlow] Facebook session detected:', sessionDetected);

chrome.runtime.sendMessage({
  type: 'FACEBOOK_SESSION_STATUS',
  sessionDetected,
});

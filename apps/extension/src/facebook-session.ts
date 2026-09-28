/**
 * facebook-session.ts
 *
 * Injected into facebook.com pages.
 * Detects whether the user is logged into Facebook by checking for
 * the presence of the `c_user` cookie (set when the user is logged in).
 * Reports the session status to the background service worker.
 */

function getFacebookUserId(): string | null {
  const cookie = document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('c_user='));
  if (!cookie) return null;

  const value = cookie.slice('c_user='.length);
  try {
    const decoded = decodeURIComponent(value);
    return /^\d+$/.test(decoded) ? decoded : null;
  } catch {
    return /^\d+$/.test(value) ? value : null;
  }
}

const facebookUserId = getFacebookUserId();
const sessionDetected = Boolean(facebookUserId);
console.log('[PostFlow] Facebook session detected:', sessionDetected, {
  facebookUserId,
});

chrome.runtime.sendMessage({
  type: 'FACEBOOK_SESSION_STATUS',
  sessionDetected,
  facebookUserId,
});

/**
 * postflow-content.ts
 *
 * Injected into the PostFlow Web App (localhost / production domain).
 * Reads the user's Clerk user ID from the DOM and stores it in chrome.storage.local.
 * This enables the background service worker to authenticate API calls.
 */

const USER_ID_ATTR = 'data-postflow-user-id';
const PENDING_SYNC_KEY = 'postflow:pending-sync-groups';

// ── Context validity guard ──
// When the extension is reloaded/updated, content scripts in already-open
// tabs become "orphaned". Any chrome.* call will throw "Extension context
// invalidated". We detect this once and tear down all listeners to prevent
// console spam.

let isContextValid = true;

function isExtensionAlive(): boolean {
  if (!isContextValid) return false;
  try {
    // Accessing chrome.runtime.id throws when the context is gone
    return !!chrome?.runtime?.id;
  } catch {
    isContextValid = false;
    return false;
  }
}

function safeSend(message: object) {
  if (!isExtensionAlive()) return;
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    isContextValid = false;
  }
}

function triggerGroupSync() {
  console.log('[PostFlow] Sync requested from Web App');
  if (!isExtensionAlive()) {
    window.dispatchEvent(new CustomEvent('postflow:sync-finished', { detail: { ok: false, error: 'Extension disconnected' } }));
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: 'TRIGGER_GROUP_SYNC' }, (response) => {
      console.log('[PostFlow] Sync finished', response);
      window.dispatchEvent(new CustomEvent('postflow:sync-finished', { detail: response }));
    });
  } catch {
    isContextValid = false;
    window.dispatchEvent(new CustomEvent('postflow:sync-finished', { detail: { ok: false, error: 'Extension error' } }));
  }
}

function consumePendingGroupSync() {
  try {
    const pendingSync = window.localStorage.getItem(PENDING_SYNC_KEY);
    if (!pendingSync) return;

    window.localStorage.removeItem(PENDING_SYNC_KEY);
    triggerGroupSync();
  } catch {
    // localStorage can be unavailable in unusual browser privacy modes.
  }
}

// ── User ID extraction ──

function extractAndStore() {
  if (!isExtensionAlive()) {
    // Orphaned context — disconnect the observer and stop trying
    observer.disconnect();
    return;
  }

  const el = document.getElementById('postflow-user-meta');
  if (!el) return;

  const userId = el.getAttribute(USER_ID_ATTR);
  if (!userId) return;

  try {
    chrome.storage.local.set({ webAppConnected: true, webAppLastSeenAt: Date.now() });
    // Read what we had before to detect a first-time store or user change
    chrome.storage.local.get('clerkUserId', (prev) => {
      if (chrome.runtime.lastError) { isContextValid = false; return; }

      const previousId = prev.clerkUserId as string | undefined;

      chrome.storage.local.set({ clerkUserId: userId }, () => {
        if (chrome.runtime.lastError) {
          isContextValid = false;
          return;
        }
        console.log('[PostFlow] User ID stored:', userId);

        // If the user ID just became available (or changed), immediately
        // re-sync all cached groups so nothing is lost from before login.
        if (!previousId || previousId !== userId) {
          console.log('[PostFlow] User ID is new/changed — triggering group sync to flush cached groups');
          safeSend({ type: 'TRIGGER_GROUP_SYNC' });
        }
      });
    });
  } catch {
    isContextValid = false;
  }
}

// Run on load and observe DOM changes in case Next.js renders after script injection
extractAndStore();
consumePendingGroupSync();

const observer = new MutationObserver(() => extractAndStore());
observer.observe(document.body, { childList: true, subtree: true });

const pendingSyncInterval = window.setInterval(() => {
  if (!isExtensionAlive()) {
    window.clearInterval(pendingSyncInterval);
    return;
  }
  consumePendingGroupSync();
}, 500);

const webAppPresenceInterval = window.setInterval(() => {
  if (!isExtensionAlive()) {
    window.clearInterval(webAppPresenceInterval);
    return;
  }
  chrome.storage.local.set({ webAppConnected: true, webAppLastSeenAt: Date.now() });
}, 30_000);

// Listen for manual sync requests dispatched by the Web App dashboard
window.addEventListener('postflow:sync-groups', () => {
  try {
    window.localStorage.removeItem(PENDING_SYNC_KEY);
  } catch {
    // Ignore storage errors; the direct event is enough.
  }
  triggerGroupSync();
});

// Listen for job check requests (e.g. after creating a new post)
window.addEventListener('postflow:check-jobs', () => {
  console.log('[PostFlow] Job check requested from Web App');
  safeSend({ type: 'TRIGGER_JOB_CHECK' });
});

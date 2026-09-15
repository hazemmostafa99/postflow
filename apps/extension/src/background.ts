// ── Configuration ──

import './posting-config.js';

const API_BASE_URL = 'http://localhost:8000';
const HEARTBEAT_ALARM = 'postflow-heartbeat';
const HEARTBEAT_INTERVAL_MINUTES = 1;
const POSTING_TIMING = (globalThis as { PostFlowPostingTiming?: PostFlowPostingTimingConfig }).PostFlowPostingTiming!;

// ── Helpers ──

async function getClerkUserId(): Promise<string | null> {
  const result = await chrome.storage.local.get('clerkUserId');
  return (result.clerkUserId as string) ?? null;
}

async function apiFetch(path: string, body?: Record<string, unknown>, method?: string) {
  const clerkUserId = await getClerkUserId();
  if (!clerkUserId) {
    console.warn('[PostFlow] No user ID found — skipping API call:', path);
    return null;
  }

  const httpMethod = method || (body ? 'POST' : 'GET');

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'x-clerk-user-id': clerkUserId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      console.warn(`[PostFlow] API error ${response.status} on ${path}`);
      return null;
    }

    // Handle empty responses (like 200 OK with no JSON)
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    console.error('[PostFlow] Network error:', err);
    return null;
  }
}

async function updateJobStatus(
  jobId: string,
  body: { status: string; error?: string },
) {
  return apiFetch(`/api/jobs/${jobId}/status`, body);
}

// ── Registration ──

async function registerExtension() {
  const result = await apiFetch('/api/extensions/register', undefined, 'POST');
  if (result) {
    console.log('[PostFlow] Registered with backend:', result._id);
  }
}

// ── Heartbeat ──

async function sendHeartbeat() {
  const result = await apiFetch('/api/extensions/heartbeat', undefined, 'POST');
  if (result) {
    console.log('[PostFlow] Heartbeat sent at', new Date().toISOString());
  }
}

// ── Session reporting ──

async function reportSession(sessionDetected: boolean) {
  const result = await apiFetch('/api/extensions/session', { sessionDetected });
  if (result) {
    console.log('[PostFlow] Session status reported:', sessionDetected);
  }
}

// ── Group storage (existing logic) ──

let pendingGroupSync: Promise<unknown> = Promise.resolve();

async function syncGroupsToBackend(groups: FacebookGroup[]) {
  const result = await apiFetch('/api/groups/sync', {
    groups: groups.map((g) => ({
      externalId: g.id,
      name: g.name,
      url: g.url,
      numericId: g.numericId,
    })),
  });
  if (result) {
    await chrome.storage.local.set({
      groupsSyncStatus: 'synced',
      groupsSyncCount: groups.length,
      groupsLastSyncedAt: Date.now(),
    });
    console.log('[PostFlow] Groups synced to backend:', result);
  } else {
    await chrome.storage.local.set({ groupsSyncStatus: 'error' });
  }
  return result;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'postflow-content') return;

  port.onMessage.addListener(async (message) => {
    if (message.type !== 'GROUPS_DETECTED') return;

    const incoming = message.groups as FacebookGroup[];

    const result = await chrome.storage.local.get('facebookGroups');
    const existing = (result.facebookGroups ?? []) as FacebookGroup[];

    const merged = new Map<string, FacebookGroup>();
    for (const g of existing) merged.set(g.id, g);
    for (const g of incoming) {
      const prev = merged.get(g.id);
      merged.set(g.id, {
        ...prev,
        ...g,
        name: prev?.name ?? g.name,
        numericId: g.numericId ?? prev?.numericId,
        url: `https://www.facebook.com/groups/${g.id}/`,
      });
    }

    const mergedList = Array.from(merged.values());
    await chrome.storage.local.set({ facebookGroups: mergedList });
    console.log(`[PostFlow] Storage: ${mergedList.length} groups total`);

    // Sync to backend
    pendingGroupSync = syncGroupsToBackend(mergedList).catch((err) => {
      console.error('[PostFlow] Group backend sync failed:', err);
    });
  });

  port.onDisconnect.addListener(() => {
    console.log('[PostFlow] Content script disconnected');
  });
});

// ── Session + sync messages ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POSTING_LOG' && message.entry) {
    console.log('[PostFlow][posting-log]', message.entry);
    void (async () => {
      const result = await chrome.storage.local.get('postingLogs');
      const logs = Array.isArray(result.postingLogs) ? result.postingLogs : [];
      logs.push({ ...message.entry, tabId: sender.tab?.id ?? null });
      // Keep the latest entries only so a long-running extension cannot grow storage forever.
      await chrome.storage.local.set({ postingLogs: logs.slice(-500) });
    })().catch((err) => console.warn('[PostFlow] Could not save posting log:', err));
    return;
  }

  if (message.type === 'FACEBOOK_SESSION_STATUS') {
    reportSession(message.sessionDetected as boolean);
  }

  if (message.type === 'TRIGGER_GROUP_SYNC') {
    (async () => {
      try {
        await chrome.storage.local.set({ groupsSyncStatus: 'syncing' });
        // 1. Immediately flush whatever is already cached in storage to the backend.
        //    This handles the race condition where groups were discovered before the
        //    user logged in (so the earlier sync was silently skipped due to missing userId).
        const result = await chrome.storage.local.get('facebookGroups');
        const cached = (result.facebookGroups ?? []) as FacebookGroup[];
        if (cached.length > 0) {
          console.log(`[PostFlow] Flushing ${cached.length} cached groups to backend`);
          await syncGroupsToBackend(cached);
        }

        // 2. Also tell open Facebook tabs to do a fresh DOM scan for new groups.
        const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
        if (!tabs.length) {
          console.warn('[PostFlow] Sync requested but no Facebook tabs are open');
          await chrome.storage.local.set({ groupsSyncStatus: 'not-synced' });
          sendResponse({ ok: true, scanned: false });
          return;
        }
        
        const scanPromises = tabs.map(tab => {
          if (tab.id !== undefined) {
            return chrome.tabs.sendMessage(tab.id, { type: 'SCAN_NOW' }).catch(() => null);
          }
          return Promise.resolve(null);
        });
        
        await Promise.all(scanPromises);
        // GROUPS_DETECTED is handled asynchronously through the runtime port.
        // Wait for its backend upload before telling the web app that sync ended.
        await pendingGroupSync;
        console.log(`[PostFlow] Finished scan on ${tabs.length} Facebook tab(s)`);
        sendResponse({ ok: true, scanned: true });
      } catch (err) {
        console.error('[PostFlow] Error during group sync:', err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true; // Keep message channel open for sendResponse
  }
  if (message.type === 'TRIGGER_JOB_CHECK') {
    checkPendingJobs();
  }
});

// ── Job Execution Flow ──

let isProcessingJob = false;
let finishExecutionHandshake: (() => void) | null = null;

async function checkPendingJobs() {
  if (isProcessingJob) return;

  const job = await apiFetch('/api/jobs/next');
  if (!job || !job.postId) {
    console.log('[PostFlow] No pending jobs');
    return;
  }

  isProcessingJob = true;
  console.log('[PostFlow] Found pending job:', job._id);

  try {
    // 1. Mark as running
    await updateJobStatus(job._id, { status: 'RUNNING' });

    // 2. Find or create a Facebook tab for the group
    const targetUrl = job.groupId.url;
    
    // Check if we already have an active Facebook tab we can reuse
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    let fbTab = tabs[0];
    if (fbTab && fbTab.id) {
      try {
        await chrome.tabs.update(fbTab.id, { url: targetUrl, active: true });
      } catch (navigationError) {
        // A tab can reject navigation while it is closing or already moving
        // between Facebook documents. Use a fresh tab as a safe fallback.
        console.warn('[PostFlow] Existing Facebook tab rejected navigation; opening a new tab', navigationError);
        fbTab = await chrome.tabs.create({ url: targetUrl, active: true });
      }
    } else {
      fbTab = await chrome.tabs.create({ url: targetUrl, active: true });
    }

    const tabId = fbTab.id;
    if (!tabId) {
      await updateJobStatus(job._id, { status: 'FAILED', error: 'Could not get tab ID' });
      isProcessingJob = false;
      return;
    }
    const readyTabId = tabId;

    // tabs.update/tabs.create resolves before the old Facebook document has
    // necessarily been replaced. Sending EXECUTE_JOB immediately can make
    // the previous page open its composer. Wait for the target group document.
    const targetReady = await waitForFacebookTabDocument(readyTabId, targetUrl, POSTING_TIMING.facebookTabReadyTimeoutMs);
    if (!targetReady) {
      console.error('[PostFlow] Target Facebook group page did not finish loading', targetUrl);
      await updateJobStatus(job._id, {
        status: 'FAILED',
        error: 'Target Facebook group page did not finish loading',
      });
      isProcessingJob = false;
      return;
    }
    console.log('[PostFlow] Target Facebook group page is loaded; waiting for content script', targetUrl);

      let sent = false;
      let sendInFlight = false;
      let timeoutHandle: ReturnType<typeof setTimeout>;
      let retryHandle: ReturnType<typeof setInterval> | null = null;

    function sendExecuteJob(force = false) {
        if (sent && !force) return;
        if (sendInFlight) {
          console.log('[PostFlow] Skipping overlapping EXECUTE_JOB send', job._id);
          return;
        }
        sendInFlight = true;
        console.log('[PostFlow] Sending EXECUTE_JOB to Facebook tab', {
          tabId: readyTabId,
          jobId: job._id,
          force,
        });
        chrome.tabs.sendMessage(readyTabId, {
          type: 'EXECUTE_JOB',
          jobId: job._id,
          post: job.postId,
        }).then(() => {
          sendInFlight = false;
          sent = true;
          console.log('[PostFlow] Facebook content script accepted EXECUTE_JOB');
        }).catch(() => {
          sendInFlight = false;
          sent = false;
          console.log('[PostFlow] Facebook content script is not ready; retrying');
        });
      }

      function onMessage(message: any, sender: chrome.runtime.MessageSender) {
        if (message.type === 'CONTENT_SCRIPT_READY' && sender.tab?.id === readyTabId) {
          // Facebook can tear down the content script when the composer is
          // clicked. Force delivery to the replacement content-script instance.
          console.log('[PostFlow] Facebook content script ready; resuming job', job._id);
          sendExecuteJob(true);
        }
      }

    function cleanup() {
        chrome.runtime.onMessage.removeListener(onMessage);
        if (retryHandle) clearInterval(retryHandle);
        if (finishExecutionHandshake === cleanup) finishExecutionHandshake = null;
      }

    finishExecutionHandshake = cleanup;

    chrome.runtime.onMessage.addListener(onMessage);
    sendExecuteJob();
    retryHandle = setInterval(sendExecuteJob, POSTING_TIMING.facebookMessageRetryIntervalMs);

    timeoutHandle = setTimeout(async () => {
        if (sent) return;
        cleanup();
        console.error('[PostFlow] Timed out waiting for Facebook tab to be ready');
        await updateJobStatus(job._id, {
          status: 'FAILED',
          error: 'Timed out waiting for Facebook page to load',
        });
        isProcessingJob = false;
    }, POSTING_TIMING.facebookTabReadyTimeoutMs);

  } catch (err) {
    console.error('[PostFlow] Error processing job:', err);
    await updateJobStatus(job._id, { 
      status: 'FAILED', 
      error: 'Extension error while processing job' 
    });
    isProcessingJob = false;
  }
}

async function waitForFacebookTabDocument(tabId: number, targetUrl: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  let targetPath = '';
  try {
    targetPath = new URL(targetUrl).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return false;
  }

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url ?? '';
      const currentPath = currentUrl ? new URL(currentUrl).pathname.replace(/\/+$/, '').toLowerCase() : '';
      if (tab.status === 'complete' && currentPath === targetPath) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

// Handle JOB result messages from content script
chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'JOB_SUCCESS') {
    void (async () => {
      console.log('[PostFlow] Job succeeded:', message.jobId);
      finishExecutionHandshake?.();
      await updateJobStatus(message.jobId, { status: 'SUCCESS' });
      isProcessingJob = false;
      checkPendingJobs();
    })();
  }
  if (message.type === 'JOB_FAILED') {
    void (async () => {
      console.error('[PostFlow] Job failed:', message.jobId, message.error);
      finishExecutionHandshake?.();
      await updateJobStatus(message.jobId, { status: 'FAILED', error: message.error });
      isProcessingJob = false;
      checkPendingJobs();
    })();
  }
});

// ── Alarms ──

chrome.alarms.create(HEARTBEAT_ALARM, {
  periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    sendHeartbeat();
    checkPendingJobs(); // Also check jobs on heartbeat
  }
});

// ── Startup ──

chrome.runtime.onStartup.addListener(() => {
  registerExtension();
  sendHeartbeat();
  checkPendingJobs();
});

chrome.runtime.onInstalled.addListener(() => {
  registerExtension();
  sendHeartbeat();
  checkPendingJobs();
});

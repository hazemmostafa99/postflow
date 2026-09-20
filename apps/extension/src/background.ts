// ── Configuration ──

import './posting-config.js';

import { API_BASE_URL, BUILD_ENV } from './env.js';

console.info(`[PostFlow] ${BUILD_ENV === 'production' ? 'PROD' : 'DEV'} environment | API: ${API_BASE_URL}`);

const HEARTBEAT_ALARM = 'postflow-heartbeat';
const HEARTBEAT_INTERVAL_MINUTES = 1;
const PENDING_POST_SYNC_ALARM = 'postflow-pending-post-sync';
const PENDING_POST_SYNC_INTERVAL_MINUTES = 10;
const ENGAGEMENT_SYNC_ALARM = 'postflow-engagement-sync';
const ENGAGEMENT_SYNC_INTERVAL_MINUTES = 30;
const POSTING_TIMING = (globalThis as { PostFlowPostingTiming?: PostFlowPostingTimingConfig }).PostFlowPostingTiming!;

// ── Helpers ──

async function getClerkUserId(): Promise<string | null> {
  const result = await chrome.storage.local.get('clerkUserId');
  return (result.clerkUserId as string) ?? null;
}

async function apiFetch(path: string, body?: Record<string, unknown>, method?: string) {
  if (!path || !path.startsWith('/')) {
    console.warn('[PostFlow] Refusing API call with invalid path:', path);
    return null;
  }

  const clerkUserId = await getClerkUserId();
  if (!clerkUserId) {
    console.warn('[PostFlow] No user ID found — skipping API call:', path);
    return null;
  }

  const httpMethod = method || (body ? 'POST' : 'GET');
  const url = `${API_BASE_URL}${path}`;

  try {
    const response = await fetch(url, {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'x-clerk-user-id': clerkUserId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle empty responses (like 200 OK with no JSON)
    const text = await response.text();
    if (!response.ok) {
      console.warn('[PostFlow] API error', {
        status: response.status,
        method: httpMethod,
        path,
        url,
        response: text.slice(0, 300),
      });
      return null;
    }

    return text ? JSON.parse(text) : null;
  } catch (err) {
    console.error('[PostFlow] Network error:', { method: httpMethod, path, url, err });
    return null;
  }
}

async function updateJobStatus(
  jobId: string,
  body: {
    status: string;
    error?: string;
    submissionResult?: {
      status: 'PUBLISHED' | 'PENDING_APPROVAL' | 'UNKNOWN';
      postUrl?: string;
      reason?: string;
    };
  },
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
let isCheckingPendingPost = false;
let isFacebookSyncBusy = false;
let pendingCheckSequence = 0;
let finishExecutionHandshake: (() => void) | null = null;
let activeExecution: { jobId: string; tabId: number } | null = null;

async function checkPendingJobs() {
  if (isProcessingJob || isFacebookSyncBusy) {
    console.log('[PostFlow] Skipping job check while Facebook navigation is busy', {
      isProcessingJob,
      isFacebookSyncBusy,
    });
    return;
  }
  isProcessingJob = true;

  const job = await apiFetch('/api/jobs/next');
  if (!job || !job.postId) {
    console.log('[PostFlow] No pending jobs');
    isProcessingJob = false;
    return;
  }

  console.log('[PostFlow] Found pending job:', job._id);

  try {
    // 1. Mark as running
    await updateJobStatus(job._id, { status: 'RUNNING' });

    // 2. Find or create a Facebook tab for the group
    const targetUrl = getSafeFacebookGroupUrl(job.groupId, job.groupId.url);
    if (!targetUrl) {
      console.error('[PostFlow] Refusing to navigate to invalid Facebook group URL', {
        jobId: job._id,
        group: job.groupId,
      });
      await updateJobStatus(job._id, { status: 'FAILED', error: 'Invalid Facebook group URL' });
      isProcessingJob = false;
      return;
    }
    
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
      activeExecution = null;
      return;
    }
    const readyTabId = tabId;
    activeExecution = { jobId: job._id, tabId: readyTabId };

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
      activeExecution = null;
      return;
    }
    console.log('[PostFlow] Target Facebook group page is loaded; waiting for content script', targetUrl);

      let sent = false;
      let sendInFlight = false;
      let timeoutHandle: ReturnType<typeof setTimeout>;
      let retryHandle: ReturnType<typeof setInterval> | null = null;

    function sendExecuteJob(force = false) {
        if (activeExecution?.jobId !== job._id || activeExecution?.tabId !== readyTabId) {
          console.warn('[PostFlow] Skipping stale EXECUTE_JOB send', {
            jobId: job._id,
            tabId: readyTabId,
            activeExecution,
          });
          return;
        }
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
          group: job.groupId,
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
          if (activeExecution?.jobId !== job._id || activeExecution?.tabId !== readyTabId) {
            console.warn('[PostFlow] Ignoring stale content-script ready handler', {
              jobId: job._id,
              tabId: readyTabId,
              activeExecution,
            });
            cleanup();
            return;
          }
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
        activeExecution = null;
    }, POSTING_TIMING.facebookTabReadyTimeoutMs);

  } catch (err) {
    console.error('[PostFlow] Error processing job:', err);
    await updateJobStatus(job._id, { 
      status: 'FAILED', 
      error: 'Extension error while processing job' 
    });
    isProcessingJob = false;
    activeExecution = null;
  }
}

function getSafeFacebookGroupUrl(group: any, fallback?: string): string | null {
  const candidate = typeof fallback === 'string' ? fallback : group?.url;
  let groupId = typeof group?.externalId === 'string' ? group.externalId : '';
  try {
    const url = candidate ? new URL(candidate) : null;
    if (!groupId) groupId = url?.pathname.match(/^\/groups\/([^/]+)/i)?.[1] ?? '';
  } catch {
    // Rebuild from externalId when the stored URL is malformed.
  }
  if (!groupId || /[/?#]/.test(groupId)) return null;
  return `https://www.facebook.com/groups/${groupId}/`;
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

function isCurrentExecutionResult(message: any, sender: chrome.runtime.MessageSender) {
  if (!activeExecution) {
    console.warn('[PostFlow] Ignoring job result with no active execution:', message.type, message.jobId);
    return false;
  }
  if (message.jobId !== activeExecution.jobId) {
    console.warn('[PostFlow] Ignoring stale job result for non-active job:', {
      type: message.type,
      receivedJobId: message.jobId,
      activeJobId: activeExecution.jobId,
    });
    return false;
  }
  if (sender.tab?.id !== activeExecution.tabId) {
    console.warn('[PostFlow] Ignoring job result from non-active tab:', {
      type: message.type,
      jobId: message.jobId,
      receivedTabId: sender.tab?.id,
      activeTabId: activeExecution.tabId,
    });
    return false;
  }
  return true;
}

// Handle JOB result messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'JOB_SUCCESS') {
    if (!isCurrentExecutionResult(message, sender)) return;
    void (async () => {
      console.log('[PostFlow] Job succeeded:', message.jobId);
      finishExecutionHandshake?.();
      await updateJobStatus(message.jobId, {
        status: 'SUCCESS',
        submissionResult: message.submissionResult,
      });
      isProcessingJob = false;
      activeExecution = null;
      checkPendingJobs();
    })();
  }
  if (message.type === 'JOB_FAILED') {
    if (!isCurrentExecutionResult(message, sender)) return;
    void (async () => {
      console.error('[PostFlow] Job failed:', message.jobId, message.error);
      finishExecutionHandshake?.();
      await updateJobStatus(message.jobId, { status: 'FAILED', error: message.error });
      isProcessingJob = false;
      activeExecution = null;
      checkPendingJobs();
    })();
  }
});

/** Navigate to one pending post's group and ask the Facebook content script to
 * perform the DOM match. This function intentionally does not update the API;
 * persistence belongs to the next feature phase. */
async function checkSinglePendingPost(post: PendingFacebookPost, lockAlreadyHeld = false): Promise<PendingPostSyncResult> {
  if (isProcessingJob) {
    return { status: 'CHECK_FAILED', reason: 'A new Facebook post is currently being published' };
  }
  if (isCheckingPendingPost) {
    return { status: 'CHECK_FAILED', reason: 'Another pending post check is already running' };
  }
  if (!lockAlreadyHeld && isFacebookSyncBusy) {
    return { status: 'CHECK_FAILED', reason: 'Another Facebook sync is already running' };
  }
  if (!lockAlreadyHeld) isFacebookSyncBusy = true;

  isCheckingPendingPost = true;
  const requestId = `pending-${++pendingCheckSequence}`;
  let syncTabId: number | undefined;
  try {
    const groupUrl = getSafeFacebookGroupUrl(post, post.groupUrl);
    if (!groupUrl) {
      return { status: 'CHECK_FAILED', reason: 'Invalid Facebook group URL' };
    }
    console.log('[PendingPostSync] Starting single post check', {
      postId: post.id,
      groupUrl,
      requestId,
    });
    // Status checks must never reuse or foreground the tab used for a new
    // publish. Reusing tabs here was the source of old posts appearing during
    // a different group's publish flow.
    let checkUrl = groupUrl;
    if (post.postUrl) {
      try {
        const savedUrl = new URL(post.postUrl);
        if (/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/\d+/i.test(savedUrl.pathname)) {
          checkUrl = savedUrl.href;
        }
      } catch {
        // Fall back to the group feed when the saved pending URL is invalid.
      }
    }
    const fbTab = await chrome.tabs.create({ url: checkUrl, active: false });
    syncTabId = fbTab.id;

    if (!fbTab.id || !(await waitForFacebookTabAfterNavigation(fbTab.id, checkUrl, POSTING_TIMING.facebookTabReadyTimeoutMs))) {
      console.warn('[PendingPostSync] Facebook pending-post navigation failed', { postId: post.id, checkUrl });
      return { status: 'CHECK_FAILED', reason: 'Target Facebook group page did not finish loading' };
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < POSTING_TIMING.facebookTabReadyTimeoutMs) {
      try {
        console.log('[PendingPostSync] Asking Facebook content script to check post', {
          postId: post.id,
          tabId: fbTab.id,
          requestId,
        });
        const response = await chrome.tabs.sendMessage(fbTab.id, {
          type: 'CHECK_PENDING_POST',
          requestId,
          post,
        });
        if (response?.ok && response.result) {
          console.log('[PendingPostSync] Facebook content script returned result', {
            postId: post.id,
            result: response.result,
          });
          return response.result as PendingPostSyncResult;
        }
      } catch {
        // Content scripts can be replaced during navigation; retry until timeout.
      }
      await new Promise((resolve) => setTimeout(resolve, POSTING_TIMING.facebookMessageRetryIntervalMs));
    }
    return { status: 'CHECK_FAILED', reason: 'Timed out waiting for pending post matcher' };
  } catch (err: any) {
    return { status: 'CHECK_FAILED', reason: err?.message ?? 'Pending post check failed' };
  } finally {
    if (syncTabId !== undefined) {
      await chrome.tabs.remove(syncTabId).catch(() => undefined);
    }
    isCheckingPendingPost = false;
    if (!lockAlreadyHeld) isFacebookSyncBusy = false;
  }
}

/**
 * Wait for a real navigation cycle when reusing a tab. A same-path tab can
 * otherwise still report `complete` for the old Facebook document.
 */
async function waitForFacebookTabAfterNavigation(tabId: number, targetUrl: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  let targetPath = '';
  let targetGroupPath = '';
  let targetPostIdentity = '';
  const targetIsPost = /\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/\d+/i.test(targetUrl);
  try {
    const parsedTarget = new URL(targetUrl);
    targetPath = parsedTarget.pathname.replace(/\/+$/, '').toLowerCase();
    targetGroupPath = parsedTarget.pathname.match(/^\/groups\/[^/]+/i)?.[0].toLowerCase() ?? '';
    targetPostIdentity = parsedTarget.pathname.match(/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/(\d+)/i)?.[1] ?? '';
  } catch {
    return false;
  }

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url ?? '';
      const currentPath = currentUrl ? new URL(currentUrl).pathname.replace(/\/+$/, '').toLowerCase() : '';
      const currentPostIdentity = currentPath.match(/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/(\d+)/i)?.[1] ?? '';
      const landedOnTarget = currentPath === targetPath ||
        (targetIsPost && currentPath === targetGroupPath) ||
        (targetIsPost && targetPostIdentity && currentPostIdentity === targetPostIdentity);
      if (tab.status === 'complete' && landedOnTarget && Date.now() - startedAt >= 1500) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'TRIGGER_SINGLE_PENDING_SYNC' || !message.post) return;
  void checkSinglePendingPost(message.post as PendingFacebookPost)
    .then(async (result) => {
      const updated = await persistPendingSyncResult(message.post as PendingFacebookPost, result);
      console.log('[PendingPostSync] Single check persisted', {
        postId: message.post.id,
        status: result.status,
        updated,
      });
      sendResponse({ ok: true, result, updated });
    })
    .catch((err) => sendResponse({ ok: false, error: err?.message ?? 'Pending post sync failed' }));
  return true;
});

let isPendingBatchRunning = false;

/** Fetch and process a small pending-post batch without opening concurrent tabs. */
async function syncPendingPostsBatch(): Promise<Array<{ postId: string; result: PendingPostSyncResult; updated: boolean }>> {
  if (isPendingBatchRunning || isFacebookSyncBusy || isProcessingJob) return [];
  isPendingBatchRunning = true;
  isFacebookSyncBusy = true;

  try {
    const pendingPosts = await apiFetch('/api/jobs/pending?limit=10');
    if (!Array.isArray(pendingPosts)) {
      console.warn('[PendingPostSync] Could not fetch pending posts');
      return [];
    }

    const results: Array<{ postId: string; result: PendingPostSyncResult; updated: boolean }> = [];
    for (const post of pendingPosts as PendingFacebookPost[]) {
      let result: PendingPostSyncResult;
      try {
        result = await checkSinglePendingPost(post, true);
      } catch (err: any) {
        result = { status: 'CHECK_FAILED', reason: err?.message ?? 'Pending post check failed' };
      }

      const updated = await persistPendingSyncResult(post, result);
      results.push({ postId: post.id, result, updated });
      console.log('[PendingPostSync] Completed pending post check', {
        postId: post.id,
        status: result.status,
        updated,
      });
    }
    return results;
  } finally {
    isPendingBatchRunning = false;
    isFacebookSyncBusy = false;
  }
}

async function persistPendingSyncResult(post: PendingFacebookPost, result: PendingPostSyncResult): Promise<boolean> {
  const response = await apiFetch(`/api/jobs/${post.id}/pending-sync`, result);
  return Boolean(response);
}

let isEngagementBatchRunning = false;
let engagementCheckSequence = 0;
let isCheckingEngagement = false;

function normalizeStoredFacebookPostUrl(value: string): string | null {
  const markdownMatch = value.trim().match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  const candidate = markdownMatch?.[1] ?? value.trim();
  try {
    const url = new URL(candidate);
    if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function checkSinglePostEngagement(post: PublishedFacebookPost, lockAlreadyHeld = false): Promise<PostEngagementSyncResult> {
  if (isProcessingJob) {
    return { status: 'CHECK_FAILED', reason: 'A new Facebook post is currently being published' };
  }
  if (isCheckingEngagement || (!lockAlreadyHeld && isFacebookSyncBusy)) {
    return { status: 'CHECK_FAILED', reason: 'Another engagement check is already running' };
  }
  if (!lockAlreadyHeld) isFacebookSyncBusy = true;
  isCheckingEngagement = true;
  const requestId = `engagement-${++engagementCheckSequence}`;
  let syncTabId: number | undefined;
  const postUrl = normalizeStoredFacebookPostUrl(post.postUrl);
  if (!postUrl) {
    console.error('[PostAnalytics] Invalid stored Facebook post URL', { postId: post.id, postUrl: post.postUrl });
    isCheckingEngagement = false;
    if (!lockAlreadyHeld) isFacebookSyncBusy = false;
    return { status: 'CHECK_FAILED', reason: 'Stored Facebook post URL is invalid' };
  }
  try {
    console.log('[PostAnalytics] Opening published post', {
      postId: post.id,
      postUrl,
      requestId,
    });
    // Analytics runs in an isolated background tab. It must not navigate the
    // active publishing tab to a previously stored post URL.
    const fbTab = await chrome.tabs.create({ url: postUrl, active: false });
    syncTabId = fbTab.id;
    console.log('[PostAnalytics] Facebook tab opened', { tabId: fbTab.id, postId: post.id });
    const ready = Boolean(fbTab.id && await waitForFacebookTabAfterNavigation(fbTab.id, postUrl, POSTING_TIMING.facebookTabReadyTimeoutMs));
    console.log('[PostAnalytics] Facebook tab readiness result', { tabId: fbTab.id, postId: post.id, ready });
    if (!fbTab.id || !ready) {
      console.warn('[PostAnalytics] Facebook post navigation failed', { postId: post.id, postUrl });
      return { status: 'CHECK_FAILED', reason: 'Target Facebook post did not finish loading' };
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < POSTING_TIMING.facebookTabReadyTimeoutMs) {
      try {
        console.log('[PostAnalytics] Sending engagement check to Facebook tab', {
          postId: post.id,
          tabId: fbTab.id,
          requestId,
        });
        const response = await chrome.tabs.sendMessage(fbTab.id, {
          type: 'CHECK_POST_ENGAGEMENT', requestId, post: { ...post, postUrl },
        });
        console.log('[PostAnalytics] Facebook tab response received', { postId: post.id, tabId: fbTab.id, response });
        if (response?.ok && response.result) {
          console.log('[PostAnalytics] Engagement check completed', { postId: post.id, result: response.result });
          return response.result as PostEngagementSyncResult;
        }
      } catch (error) {
        console.log('[PostAnalytics] Facebook content script unavailable; retrying', {
          postId: post.id,
          tabId: fbTab.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // The content script can be replaced while Facebook finishes navigation.
      }
      await new Promise((resolve) => setTimeout(resolve, POSTING_TIMING.facebookMessageRetryIntervalMs));
    }
    console.error('[PostAnalytics] Timed out waiting for Facebook engagement content script', {
      postId: post.id,
      tabId: fbTab.id,
    });
    return { status: 'CHECK_FAILED', reason: 'Timed out waiting for engagement counters' };
  } catch (err: any) {
    return { status: 'CHECK_FAILED', reason: err?.message ?? 'Engagement check failed' };
  } finally {
    if (syncTabId !== undefined) {
      await chrome.tabs.remove(syncTabId).catch(() => undefined);
    }
    isCheckingEngagement = false;
    if (!lockAlreadyHeld) isFacebookSyncBusy = false;
  }
}

async function syncPublishedEngagementBatch(postId?: string) {
  if (isEngagementBatchRunning || isFacebookSyncBusy || isProcessingJob) return [];
  isEngagementBatchRunning = true;
  isFacebookSyncBusy = true;
  try {
    const query = postId
      ? `/api/jobs/engagement-pending?limit=50&postId=${encodeURIComponent(postId)}`
      : '/api/jobs/engagement-pending?limit=10';
    const posts = await apiFetch(query);
    if (!Array.isArray(posts)) return [];
    const results = [];
    for (const post of posts as PublishedFacebookPost[]) {
      const result = await checkSinglePostEngagement(post, true);
      const updated = Boolean(await apiFetch(`/api/jobs/${post.id}/engagement`, result));
      results.push({ postId: post.id, result, updated });
      console.log('[PostAnalytics] Engagement sync completed', { postId: post.id, result, updated });
    }
    return results;
  } finally {
    isEngagementBatchRunning = false;
    isFacebookSyncBusy = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TRIGGER_SINGLE_ENGAGEMENT_SYNC' && message.post) {
    void checkSinglePostEngagement(message.post as PublishedFacebookPost)
      .then(async (result) => {
        const updated = Boolean(await apiFetch(`/api/jobs/${message.post.id}/engagement`, result));
        sendResponse({ ok: true, result, updated, postId: message.post.id });
      })
      .catch((err) => sendResponse({ ok: false, error: err?.message ?? 'Engagement sync failed' }));
    return true;
  }
  if (message.type !== 'TRIGGER_ENGAGEMENT_SYNC') return;
  void syncPublishedEngagementBatch(typeof message.postId === 'string' ? message.postId : undefined)
    .then((results) => sendResponse({ ok: true, results }))
    .catch((err) => sendResponse({ ok: false, error: err?.message ?? 'Engagement sync failed' }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'TRIGGER_PENDING_POST_SYNC') return;
  void syncPendingPostsBatch()
    .then((results) => sendResponse({ ok: true, results }))
    .catch((err) => sendResponse({ ok: false, error: err?.message ?? 'Pending post batch failed' }));
  return true;
});

// ── Alarms ──

chrome.alarms.create(HEARTBEAT_ALARM, {
  periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
});
chrome.alarms.create(PENDING_POST_SYNC_ALARM, {
  periodInMinutes: PENDING_POST_SYNC_INTERVAL_MINUTES,
});
// Engagement checks are explicitly user-triggered from the dashboard. An
// automatic alarm can open a previously stored post URL while a new post is
// being published, so do not schedule background navigation for analytics.
void chrome.alarms.clear(ENGAGEMENT_SYNC_ALARM);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    sendHeartbeat();
    checkPendingJobs(); // Also check jobs on heartbeat
  }
  if (alarm.name === PENDING_POST_SYNC_ALARM) {
    void syncPendingPostsBatch();
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

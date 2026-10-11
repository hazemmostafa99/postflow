import type { PlatformPublisherAdapter, PublishResult } from '../../platform-adapter.js';
import type { PublishJob } from '../../publishing-target.js';
import { getJobMediaReferences } from '../../shared/media/index.js';
import { API_BASE_URL } from '../../env.js';
import { bindTikTokExecution, releaseTikTokExecution } from './bridge.js';
import { ensureTikTokComposer, refreshTikTokSession } from './worker.js';
import { isTikTokUploadUrl, normalizeTikTokPostUrl } from './result.js';

// Four photo media fetches can finish near the 60s delivery ceiling and
// TikTok may then need up to two minutes to ingest them before enabling Post.
// Keep the outer channel alive long enough for that bounded workflow.
const TIKTOK_EXECUTION_TIMEOUT_MS = 300_000;

// Keep the upload-stage breakpoint off; photo caption input is now being
// verified before allowing the normal submission flow to continue.
const TIKTOK_DEBUG_PAUSE_AFTER_UPLOAD = false;
const TIKTOK_DEBUG_PAUSE_AFTER_CAPTION = false;

export class TikTokAdapter implements PlatformPublisherAdapter {
  readonly platform = 'TIKTOK' as const;
  readonly allowedHostnames = ['www.tiktok.com'];
  readonly supportedTargetTypes = ['TIKTOK_VIDEO', 'TIKTOK_PHOTO'];

  validateJob(job: PublishJob) {
    const media = getJobMediaReferences(job.post);
    const isTikTokTarget = job.target.type === 'TIKTOK_VIDEO' || job.target.type === 'TIKTOK_PHOTO';
    const username = job.target.type === 'TIKTOK_VIDEO' || job.target.type === 'TIKTOK_PHOTO'
      ? job.target.tiktokUsername : undefined;
    const validMedia = job.target.type === 'TIKTOK_PHOTO'
      ? media.length >= 1 && media.length <= 4 && media.every((item) => item.contentType.startsWith('image/'))
      : media.length === 1 && media[0]?.contentType.startsWith('video/');
    const valid = job.platform === 'TIKTOK' && isTikTokTarget &&
      /^[A-Za-z0-9._]{1,24}$/.test(username ?? '') &&
      Array.isArray(job.post.media) && job.post.media.length === media.length && validMedia &&
      media.every((item) => Date.parse(item.expiresAt) > Date.now() &&
        item.fetchPath === `/api/jobs/${job.id}/media/${item.index}`);
    return { valid, reason: valid ? undefined : 'TikTok requires an expected account and live job-scoped video or photo references' };
  }

  getTargetUrl(job: PublishJob) {
    return ['TIKTOK_VIDEO', 'TIKTOK_PHOTO'].includes(job.target.type) ? 'https://www.tiktok.com/tiktokstudio/upload' : null;
  }

  async verifyActiveAccount(job: PublishJob) {
    const expected = job.target.type === 'TIKTOK_VIDEO' || job.target.type === 'TIKTOK_PHOTO'
      ? job.target.tiktokUsername?.toLowerCase() : undefined;
    const readSession = () => chrome.storage.local.get([
      'tiktokSessionDetected', 'tiktokDetectedUsername', 'tiktokSessionLastCheckedAt', 'tiktokConnectionStatus',
    ]);
    let stored = await readSession();
    let lastCheckedAt = Number(stored.tiktokSessionLastCheckedAt);
    let age = Number.isFinite(lastCheckedAt) ? Date.now() - lastCheckedAt : null;
    let detectedUsername = typeof stored.tiktokDetectedUsername === 'string'
      ? stored.tiktokDetectedUsername.toLowerCase()
      : undefined;
    let evidenceIsFresh = Boolean(stored.tiktokSessionDetected && age !== null && age >= 0 && age < 45_000 &&
      detectedUsername && detectedUsername === expected);
    let refreshAttempted = false;
    let refreshSucceeded = false;

    // Registration can finish well before a scheduled job runs. Refresh stale
    // or mismatched evidence here so the freshness window covers this job.
    if (expected && !evidenceIsFresh) {
      refreshAttempted = true;
      try {
        refreshSucceeded = await refreshTikTokSession();
      } catch (error) {
        console.warn('[PostFlow][TikTok] Job-time identity refresh failed', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      stored = await readSession();
      lastCheckedAt = Number(stored.tiktokSessionLastCheckedAt);
      age = Number.isFinite(lastCheckedAt) ? Date.now() - lastCheckedAt : null;
      detectedUsername = typeof stored.tiktokDetectedUsername === 'string'
        ? stored.tiktokDetectedUsername.toLowerCase()
        : undefined;
      evidenceIsFresh = Boolean(refreshSucceeded && stored.tiktokSessionDetected && age !== null && age >= 0 && age < 45_000 &&
        detectedUsername && detectedUsername === expected);
    }

    const verified = Boolean(expected && evidenceIsFresh);
    console.info('[PostFlow][TikTok] Account verification snapshot', {
      jobId: job.id,
      expectedUsername: expected ?? null,
      detectedUsername: detectedUsername ?? null,
      sessionDetected: stored.tiktokSessionDetected === true,
      connectionStatus: stored.tiktokConnectionStatus ?? null,
      lastCheckedAt: Number.isFinite(lastCheckedAt) ? new Date(lastCheckedAt).toISOString() : null,
      ageMs: age,
      refreshAttempted,
      refreshSucceeded: refreshAttempted ? refreshSucceeded : null,
      verified,
    });
    return { verified, reason: verified ? undefined : 'TikTok identity must be freshly verified' };
  }

  async waitForReady(tabId: number, job: PublishJob) {
    const deadline = Date.now() + 30_000;
    let lastTabState = '';
    let lastProbeError = '';
    let pageErrorRecoveryAttempted = false;
    console.info('[PostFlow][TikTok] Waiting for upload page readiness', { tabId, targetType: job.target.type });
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) {
        console.warn('[PostFlow][TikTok] Upload tab disappeared before readiness', { tabId });
        return false;
      }
      const tabState = `${tab.status ?? 'unknown'}|${tab.url ?? ''}|${tab.pendingUrl ?? ''}`;
      if (tabState !== lastTabState) {
        lastTabState = tabState;
        console.info('[PostFlow][TikTok] Upload tab state', {
          tabId,
          status: tab.status ?? 'unknown',
          url: tab.url ?? null,
          pendingUrl: tab.pendingUrl ?? null,
        });
      }
      if (tab.status !== 'complete') {
        if (tab.pendingUrl && !isTikTokUploadUrl(tab.pendingUrl)) {
          console.warn('[PostFlow][TikTok] Navigation left the allowlisted upload surface', { tabId, pendingUrl: tab.pendingUrl });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (!isTikTokUploadUrl(tab.url ?? '')) {
        console.warn('[PostFlow][TikTok] Loaded tab is not an allowlisted upload URL', { tabId, url: tab.url ?? null });
        return false;
      }
      let ready: {
        ready?: boolean;
        listenerReady?: boolean;
        pageError?: boolean;
        diagnostics?: Record<string, unknown>;
      } | null = null;
      try {
        ready = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_COMPOSER_READY', targetType: job.target.type });
      } catch (error) {
        const probeError = error instanceof Error ? error.message : String(error);
        if (probeError !== lastProbeError) {
          lastProbeError = probeError;
          console.warn('[PostFlow][TikTok] Composer readiness probe failed', { tabId, error: probeError });
        }
      }
      if (ready?.pageError) {
        console.warn('[PostFlow][TikTok] Upload page is showing TikTok error state', {
          tabId,
          diagnostics: ready.diagnostics ?? null,
          recoveryAttempted: pageErrorRecoveryAttempted,
        });
        if (!pageErrorRecoveryAttempted && chrome.tabs.reload) {
          pageErrorRecoveryAttempted = true;
          lastTabState = '';
          lastProbeError = '';
          console.info('[PostFlow][TikTok] Reloading TikTok upload page after error state', { tabId });
          await chrome.tabs.reload(tabId).catch((error) => {
            console.warn('[PostFlow][TikTok] Could not reload TikTok upload page', {
              tabId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        return false;
      }
      if (ready?.ready === true && ready.listenerReady !== false) {
        console.info('[PostFlow][TikTok] Upload page is ready', { tabId, diagnostics: ready.diagnostics ?? null });
        return true;
      }
      if (!ready && lastProbeError !== 'NO_RESPONSE') {
        lastProbeError = 'NO_RESPONSE';
        console.warn('[PostFlow][TikTok] Composer readiness probe returned no response', { tabId });
      }
      if (ready?.diagnostics) console.info('[PostFlow][TikTok] Upload page is loaded but composer is not ready', { tabId, diagnostics: ready.diagnostics });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.warn('[PostFlow][TikTok] Upload page readiness timed out', { tabId, timeoutMs: 30_000, lastTabState, lastProbeError: lastProbeError || null });
    return false;
  }

  async execute(tabId: number, job: PublishJob): Promise<PublishResult> {
    if (!this.validateJob(job).valid) return { success: false, status: 'FAILED', reason: 'Invalid TikTok job' };
    // TikTok can finish a route transition with a visually valid upload URL
    // while the old content-script listener has already been destroyed. Ping
    // and, when necessary, reattach it immediately before binding ownership
    // and starting the long-running upload command.
    let composerState = await ensureTikTokComposer(tabId);
    if (!composerState.ok) {
      console.warn('[PostFlow][TikTok] Composer listener unavailable before execution', { tabId, jobId: job.id });
      return { success: false, status: 'FAILED', reason: 'TIKTOK_COMPOSER_UNAVAILABLE' };
    }
    if (composerState.pageError) {
      console.warn('[PostFlow][TikTok] TikTok error page detected immediately before execution; attempting one reload', {
        tabId,
        jobId: job.id,
      });
      if (!chrome.tabs.reload) {
        return { success: false, status: 'FAILED', reason: 'TIKTOK_PAGE_ERROR' };
      }
      await chrome.tabs.reload(tabId).catch((error) => {
        console.warn('[PostFlow][TikTok] Could not reload TikTok error page before execution', {
          tabId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      if (!await this.waitForReady(tabId, job)) {
        console.warn('[PostFlow][TikTok] TikTok upload page did not recover from error state', { tabId, jobId: job.id });
        return { success: false, status: 'FAILED', reason: 'TIKTOK_PAGE_ERROR' };
      }
      composerState = await ensureTikTokComposer(tabId);
      if (!composerState.ok || composerState.pageError) {
        console.warn('[PostFlow][TikTok] TikTok upload page still unavailable after error recovery', {
          tabId,
          jobId: job.id,
          pageError: composerState.pageError === true,
        });
        return { success: false, status: 'FAILED', reason: composerState.pageError ? 'TIKTOK_PAGE_ERROR' : 'TIKTOK_COMPOSER_UNAVAILABLE' };
      }
    }
    console.info('[PostFlow][TikTok] Sending composer execution', { tabId, jobId: job.id, targetType: job.target.type });
    bindTikTokExecution(tabId, job);
    try {
      const sendExecution = (resume = false) => chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_EXECUTE_JOB', jobId: job.id,
        targetType: job.target.type,
        expectedUsername: job.target.type === 'TIKTOK_VIDEO' || job.target.type === 'TIKTOK_PHOTO'
          ? job.target.tiktokUsername : undefined,
        resume,
        pauseAfterUpload: TIKTOK_DEBUG_PAUSE_AFTER_UPLOAD,
        pauseAfterCaption: TIKTOK_DEBUG_PAUSE_AFTER_CAPTION,
        post: job.post, apiBaseUrl: API_BASE_URL }) as Promise<PublishResult | undefined>;
      const executeWithTimeout = async (resume = false): Promise<PublishResult | undefined> => {
        const execution = sendExecution(resume);
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const timeout = new Promise<PublishResult | undefined>((resolve) => {
          timeoutId = globalThis.setTimeout(() => {
            console.warn('[PostFlow][TikTok] Composer response timed out; automatic retry is unsafe', {
              tabId,
              jobId: job.id,
              timeoutMs: TIKTOK_EXECUTION_TIMEOUT_MS,
              resume,
            });
            resolve({ success: true, status: 'UNKNOWN', reason: 'TikTok composer timed out; inspect the upload before retrying' });
          }, TIKTOK_EXECUTION_TIMEOUT_MS);
          // Node-based fixture contexts may expose setTimeout without the
          // matching clearTimeout global. Do not let this safety timer keep a
          // test process alive after the composer has already responded.
          (timeoutId as ReturnType<typeof globalThis.setTimeout> & { unref?: () => void }).unref?.();
        });
        try {
          return await Promise.race([execution, timeout]);
        } finally {
          if (timeoutId !== undefined && typeof globalThis.clearTimeout === 'function') {
            globalThis.clearTimeout(timeoutId);
          }
        }
      };

      let result: PublishResult | undefined;
      try {
        result = await executeWithTimeout();
      } catch (error) {
        const channelError = error instanceof Error ? error.message : String(error);
        console.warn('[PostFlow][TikTok] Composer response channel closed; recovering upload editor', {
          tabId, jobId: job.id, error: channelError,
        });
        let state = await ensureTikTokComposer(tabId);
        const recoveryDeadline = Date.now() + 15_000;
        while (state.ok && state.busy && Date.now() < recoveryDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          state = await ensureTikTokComposer(tabId);
        }
        if (state.pageError) {
          result = { success: true, status: 'UNKNOWN', reason: 'TikTok upload page entered an error state; inspect it before retrying' };
        }
        const completed = state.lastExecution?.jobId === job.id ? state.lastExecution.result : null;
        if (result) {
          // The upload document is no longer trustworthy. Do not resume or
          // attach media a second time automatically; the owner can use the
          // manual retry action after inspecting TikTok.
        } else if (completed && typeof completed.status === 'string') {
          result = completed as unknown as PublishResult;
        } else if (state.ok && !state.busy) {
          console.info('[PostFlow][TikTok] Resuming existing upload after channel recovery', { tabId, jobId: job.id });
          result = await executeWithTimeout(true);
        } else {
          throw error;
        }
      }
      const normalized = result ?? { success: true, status: 'UNKNOWN' as const, reason: 'TikTok response lost; inspect the upload before retrying' };
      console.info('[PostFlow][TikTok] Composer response received', { tabId, jobId: job.id, status: normalized.status,
        success: normalized.success, reason: normalized.reason, diagnostics: normalized.diagnostics ?? null });
      return normalized;
    } catch (error) {
      console.warn('[PostFlow][TikTok] Composer response channel closed', { tabId, jobId: job.id, error: error instanceof Error ? error.message : String(error) });
      return { success: true, status: 'UNKNOWN', reason: 'TikTok response channel closed; automatic retry is unsafe' };
    } finally { releaseTikTokExecution(tabId); }
  }

  normalizePostUrl(value: string) { return normalizeTikTokPostUrl(value); }
  matchesUrl(value: string) { return isTikTokUploadUrl(value); }
}

export const tiktokAdapter = new TikTokAdapter();

import type { PlatformPublisherAdapter, PublishResult } from '../../platform-adapter.js';
import type { PublishJob } from '../../publishing-target.js';
import { getJobMediaReferences } from '../../shared/media/index.js';
import { API_BASE_URL } from '../../env.js';
import { bindTikTokExecution, releaseTikTokExecution } from './bridge.js';
import { ensureTikTokComposer } from './worker.js';
import { isTikTokUploadUrl, normalizeTikTokPostUrl } from './result.js';

// Four photo media fetches can finish near the 60s delivery ceiling and
// TikTok may then need up to two minutes to ingest them before enabling Post.
// Keep the outer channel alive long enough for that bounded workflow.
const TIKTOK_EXECUTION_TIMEOUT_MS = 300_000;

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
    const stored = await chrome.storage.local.get(['tiktokSessionDetected', 'tiktokDetectedUsername', 'tiktokSessionLastCheckedAt']);
    const expected = job.target.type === 'TIKTOK_VIDEO' || job.target.type === 'TIKTOK_PHOTO'
      ? job.target.tiktokUsername?.toLowerCase() : undefined;
    const lastCheckedAt = Number(stored.tiktokSessionLastCheckedAt);
    const age = Number.isFinite(lastCheckedAt) ? Date.now() - lastCheckedAt : null;
    const detectedUsername = typeof stored.tiktokDetectedUsername === 'string'
      ? stored.tiktokDetectedUsername.toLowerCase()
      : undefined;
    const verified = Boolean(expected && stored.tiktokSessionDetected && age !== null && age >= 0 && age < 45_000 &&
      detectedUsername && detectedUsername === expected);
    console.info('[PostFlow][TikTok] Account verification snapshot', {
      jobId: job.id,
      expectedUsername: expected ?? null,
      detectedUsername: detectedUsername ?? null,
      sessionDetected: stored.tiktokSessionDetected === true,
      connectionStatus: stored.tiktokConnectionStatus ?? null,
      lastCheckedAt: Number.isFinite(lastCheckedAt) ? new Date(lastCheckedAt).toISOString() : null,
      ageMs: age,
      verified,
    });
    return { verified, reason: verified ? undefined : 'TikTok identity must be freshly verified' };
  }

  async waitForReady(tabId: number, job: PublishJob) {
    const deadline = Date.now() + 30_000;
    let lastTabState = '';
    let lastProbeError = '';
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
      let ready: { ready?: boolean; diagnostics?: Record<string, unknown> } | null = null;
      try {
        ready = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_COMPOSER_READY', targetType: job.target.type });
      } catch (error) {
        const probeError = error instanceof Error ? error.message : String(error);
        if (probeError !== lastProbeError) {
          lastProbeError = probeError;
          console.warn('[PostFlow][TikTok] Composer readiness probe failed', { tabId, error: probeError });
        }
      }
      if (ready?.ready === true) {
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
    console.info('[PostFlow][TikTok] Sending composer execution', { tabId, jobId: job.id, targetType: job.target.type });
    bindTikTokExecution(tabId, job);
    try {
      const sendExecution = (resume = false) => chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_EXECUTE_JOB', jobId: job.id,
        targetType: job.target.type,
        expectedUsername: job.target.type === 'TIKTOK_VIDEO' || job.target.type === 'TIKTOK_PHOTO'
          ? job.target.tiktokUsername : undefined,
        resume,
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
        const completed = state.lastExecution?.jobId === job.id ? state.lastExecution.result : null;
        if (completed && typeof completed.status === 'string') {
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

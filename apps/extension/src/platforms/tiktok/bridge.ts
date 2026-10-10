import type { PublishJob } from '../../publishing-target.js';
import type { TikTokSessionApiFetch } from './worker.js';
import { isTikTokUploadUrl } from './result.js';

const activeTikTokExecutions = new Map<number, { jobId: string; username: string; armed: boolean }>();

export function bindTikTokExecution(tabId: number, job: PublishJob): void {
  if (job.target.type !== 'TIKTOK_VIDEO' && job.target.type !== 'TIKTOK_PHOTO') throw new Error('Invalid TikTok target');
  activeTikTokExecutions.set(tabId, { jobId: job.id, username: job.target.tiktokUsername!.toLowerCase(), armed: false });
}

export function releaseTikTokExecution(tabId: number): void {
  activeTikTokExecutions.delete(tabId);
}

export function registerTikTokPublishingBridge(apiFetch: TikTokSessionApiFetch): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['TIKTOK_CHECK_JOB', 'TIKTOK_ARM_SUBMISSION', 'TIKTOK_CONFIRM_SUBMISSION', 'TIKTOK_COMPOSER_STAGE'].includes(message?.type)) return;
    const active = sender.tab?.id === undefined ? undefined : activeTikTokExecutions.get(sender.tab.id);
    if (!active || sender.frameId !== 0 || !isTikTokUploadUrl(sender.url ?? sender.tab?.url ?? '') ||
      message.jobId !== active.jobId || message.username?.toLowerCase() !== active.username) {
      sendResponse({ ok: false, reason: 'Execution ownership or identity mismatch' });
      return;
    }
    if (message.type === 'TIKTOK_COMPOSER_STAGE') {
      console.info('[PostFlow][TikTok] Composer stage', {
        tabId: sender.tab?.id,
        jobId: active.jobId,
        stage: typeof message.stage === 'string' ? message.stage : 'unknown',
        details: message.details && typeof message.details === 'object' ? message.details : undefined,
      });
      sendResponse({ ok: true });
      return;
    }
    void checkTikTokExecution(apiFetch, active, message.type).then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'Worker check unavailable' }));
    return true;
  });
}

async function checkTikTokExecution(apiFetch: TikTokSessionApiFetch,
  active: { jobId: string; armed: boolean }, type: string) {
  const path = `/api/jobs/${encodeURIComponent(active.jobId)}`;
  if (type === 'TIKTOK_ARM_SUBMISSION') {
    if (active.armed) return { ok: false, uncertain: true, reason: 'Submission already armed' };
    active.armed = true;
    const result = await apiFetch(`${path}/submission-intent`, {}, 'POST', true);
    return { ok: result?.allowed === true, uncertain: result?.allowed !== true };
  }
  const job = await apiFetch(path, undefined, 'GET', true);
  if (!job || job.apiFetchError) return { ok: false, reason: 'Job check unavailable' };
  if (type === 'TIKTOK_CONFIRM_SUBMISSION') return { ok: active.armed && job.status === 'RUNNING' && Boolean(job.submittedAt) };
  return { ok: job.status === 'RUNNING' && !job.submittedAt,
    canceled: job.status === 'CANCEL_REQUESTED', uncertain: Boolean(job.submittedAt) };
}

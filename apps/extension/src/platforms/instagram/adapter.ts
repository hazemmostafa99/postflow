import type {
  AccountVerificationResult,
  PlatformPublisherAdapter,
  PublishResult,
  ValidationResult,
} from '../../platform-adapter.js';
import type { PublishJob } from '../../publishing-target.js';
import { normalizeInstagramPostUrl } from './result.js';
import {
  refreshAndResolveInstagramPostUrl,
  resolveInstagramPostUrl,
  waitForInstagramBaselineProbe,
  type InstagramPostProbe,
} from './permalink.js';

type InstagramTarget = Extract<PublishJob['target'], { type: 'INSTAGRAM_FEED' | 'INSTAGRAM_REEL' }>;

function isInstagramTarget(target: PublishJob['target']): target is InstagramTarget {
  return target.type === 'INSTAGRAM_FEED' || target.type === 'INSTAGRAM_REEL';
}

function isComposerChannelClosed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /message channel closed|asynchronous response.*channel closed|returning true/i.test(message);
}

export class InstagramAdapter implements PlatformPublisherAdapter {
  readonly platform = 'INSTAGRAM' as const;
  readonly allowedHostnames = ['www.instagram.com', 'instagram.com'];
  readonly supportedTargetTypes = ['INSTAGRAM_FEED', 'INSTAGRAM_REEL'] as const;

  validateJob(job: PublishJob): ValidationResult {
    if (!isInstagramTarget(job.target)) return { valid: false, reason: `Unsupported Instagram target: ${job.target.type}` };
    const mediaUrls = Array.isArray(job.post.mediaUrls) ? job.post.mediaUrls : [];
    const isReel = job.target.type === 'INSTAGRAM_REEL';
    const expectedPrefix = isReel ? 'data:video/' : 'data:image/';
    if (mediaUrls.length !== 1 || typeof mediaUrls[0] !== 'string' || !mediaUrls[0].startsWith(expectedPrefix)) {
      return { valid: false, reason: isReel ? 'Instagram Reel requires one video' : 'Instagram Feed requires one image' };
    }
    return { valid: true };
  }

  getTargetUrl(job: PublishJob): string | null {
    if (!isInstagramTarget(job.target)) return null;
    return this.matchesUrl(job.target.url) ? job.target.url : 'https://www.instagram.com/';
  }

  async verifyActiveAccount(job: PublishJob): Promise<AccountVerificationResult> {
    if (!isInstagramTarget(job.target) || !job.target.instagramUsername) {
      return { verified: false, reason: 'Instagram expected username is missing' };
    }
    const stored = await chrome.storage.local.get([
      'instagramSessionDetected',
      'instagramDetectedUsername',
    ]);
    const detected = typeof stored.instagramDetectedUsername === 'string'
      ? stored.instagramDetectedUsername.toLowerCase()
      : '';
    const expected = job.target.instagramUsername.toLowerCase();
    const verified = stored.instagramSessionDetected === true && detected === expected;
    return {
      verified,
      expectedAccountId: expected,
      detectedAccountId: detected || undefined,
      reason: verified ? undefined : 'Instagram session is not verified for the expected account',
    };
  }

  async waitForReady(tabId: number): Promise<boolean> {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (current?.status === 'complete') return true;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener as any);
        resolve(false);
      }, 30_000);
      const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener as any);
        resolve(true);
      };
      chrome.tabs.onUpdated.addListener(listener as any);
    });
  }

  async execute(tabId: number, job: PublishJob): Promise<PublishResult> {
    if (!isInstagramTarget(job.target)) {
      return { success: false, status: 'FAILED', reason: `Unsupported Instagram target: ${job.target.type}` };
    }
    let existingPostProbe: InstagramPostProbe = { urls: [], available: false };
    let observedPostUrl: string | undefined;
    let navigationListener: ((updatedTabId: number, changeInfo: { url?: string }) => void) | undefined;
    try {
      console.info('[PostFlow][Instagram] Sending composer command', {
        tabId,
        jobId: job.id,
        targetType: job.target.type,
        captionLength: typeof job.post.content === 'string' ? job.post.content.trim().length : 0,
      });
      existingPostProbe = await waitForInstagramBaselineProbe(tabId);
      console.info('[PostFlow][Instagram] Permalink probe armed', {
        tabId,
        baselineAvailable: existingPostProbe.available,
        baselineCount: existingPostProbe.urls.length,
      });
      navigationListener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || !changeInfo.url) return;
        const normalized = normalizeInstagramPostUrl(changeInfo.url);
        if (!normalized) return;
        observedPostUrl = normalized;
        console.info('[PostFlow][Instagram] Post permalink observed during navigation', {
          tabId,
          jobId: job.id,
          postUrl: normalized,
        });
      };
      chrome.tabs.onUpdated.addListener(navigationListener as any);
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'INSTAGRAM_EXECUTE_JOB',
        jobId: job.id,
        expectedUsername: job.target.instagramUsername,
        targetType: job.target.type,
        post: job.post,
      }) as PublishResult | undefined;
      console.info('[PostFlow][Instagram] Composer response received', {
        tabId,
        jobId: job.id,
        status: response?.status || 'NO_RESPONSE',
        success: response?.success === true,
        canceled: response?.canceled === true,
        reason: response?.reason,
      });
      if (observedPostUrl) {
        return {
          ...(response ?? {}),
          success: true,
          status: 'PUBLISHED',
          postUrl: response?.postUrl ?? observedPostUrl,
          reason: 'Instagram post permalink was observed during tab navigation.',
        };
      }
      if (response?.success === true && response.status === 'PUBLISHED' && !response.postUrl) {
        const recoveredPostUrl = await resolveInstagramPostUrl(tabId, existingPostProbe)
          ?? await refreshAndResolveInstagramPostUrl(tabId, existingPostProbe);
        if (recoveredPostUrl) {
          console.info('[PostFlow][Instagram] Recovered permalink after composer response', {
            tabId,
            jobId: job.id,
            postUrl: recoveredPostUrl,
          });
          return { ...response, postUrl: recoveredPostUrl };
        }
      }
      return response ?? { success: false, status: 'FAILED', reason: 'Instagram composer returned no result' };
    } catch (error) {
      if (isComposerChannelClosed(error)) {
        const recoveredPostUrl = observedPostUrl
          ?? await resolveInstagramPostUrl(tabId, existingPostProbe)
          ?? await refreshAndResolveInstagramPostUrl(tabId, existingPostProbe);
        const recoveryReason = recoveredPostUrl
          ? 'Instagram navigated while confirming the publish; the post permalink was recovered from the tab URL.'
          : 'Instagram closed the composer response channel after Share; publish state is uncertain and will not be retried automatically.';
        console.warn('[PostFlow][Instagram] Composer response channel closed; recovered terminal result', {
          tabId,
          jobId: job.id,
          currentUrl: (await chrome.tabs.get(tabId).catch(() => null))?.url,
          postUrl: recoveredPostUrl,
          status: recoveredPostUrl ? 'PUBLISHED' : 'UNKNOWN',
        });
        return {
          success: true,
          status: recoveredPostUrl ? 'PUBLISHED' : 'UNKNOWN',
          ...(recoveredPostUrl ? { postUrl: recoveredPostUrl } : {}),
          reason: recoveryReason,
        };
      }
      console.error('[PostFlow][Instagram] Composer command failed', {
        tabId,
        jobId: job.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return { success: false, status: 'FAILED', reason: error instanceof Error ? error.message : String(error) };
    } finally {
      if (navigationListener) {
        chrome.tabs.onUpdated.removeListener(navigationListener as any);
      }
    }
  }

  normalizePostUrl(value: string): string | null {
    return normalizeInstagramPostUrl(value);
  }

  matchesUrl(value: string): boolean {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return this.allowedHostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }
}

export const instagramAdapter = new InstagramAdapter();

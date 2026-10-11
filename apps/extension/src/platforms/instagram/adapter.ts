import type {
  AccountVerificationResult,
  PlatformPublisherAdapter,
  PublishResult,
  ValidationResult,
} from '../../platform-adapter.js';
import type { PublishJob } from '../../publishing-target.js';
import { normalizeInstagramPostUrl } from './result.js';
import { verifyPublishedInstagramCaption } from './published-caption.js';
import { isFreshInstagramSession, type InstagramSessionSnapshot } from './session-state.js';
import { bindInstagramExecution, refreshInstagramSession, releaseInstagramExecution } from './worker.js';
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

async function confirmInstagramCaption(result: PublishResult, job: PublishJob): Promise<PublishResult> {
  const caption = typeof job.post.content === 'string' ? job.post.content.trim() : '';
  if (!caption || !result.success || result.status !== 'PUBLISHED') return result;
  const verified = result.postUrl
    ? await verifyPublishedInstagramCaption(result.postUrl, caption)
    : false;
  console.info('[PostFlow][Instagram] Published caption check', {
    jobId: job.id,
    postUrlPresent: Boolean(result.postUrl),
    captionLength: caption.length,
    verified,
  });
  return verified ? result : {
    ...result,
    status: 'UNKNOWN',
    reason: `Instagram shared the post, but its published caption could not be verified. Inspect it before retrying.${result.postUrl ? ` Post: ${result.postUrl}` : ''}`,
  };
}

const RESERVED_INSTAGRAM_PATHS = new Set([
  'accounts', 'direct', 'directory', 'emails', 'explore', 'legal', 'p', 'privacy',
  'reel', 'reels', 'session', 'settings', 'stories', 'web',
]);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeInstagramProfileUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://www.instagram.com/');
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'www.instagram.com' && hostname !== 'instagram.com')) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1 || RESERVED_INSTAGRAM_PATHS.has(segments[0].toLowerCase()) || !/^[a-z0-9._]+$/i.test(segments[0])) return null;
    return `https://www.instagram.com/${encodeURIComponent(segments[0])}/`;
  } catch {
    return null;
  }
}

function profileUrlForUsername(username: string | undefined): string | null {
  return normalizeInstagramProfileUrl(`https://www.instagram.com/${(username ?? '').replace(/^@/, '')}/`);
}

async function discoverOwnProfileUrl(tabId: number): Promise<string | null> {
  console.info('[PostFlow][Instagram] Resolving authenticated profile link before publishing', { tabId });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'INSTAGRAM_GET_PROFILE_URL' }).catch(() => undefined) as
      { profileUrl?: unknown } | undefined;
    const profileUrl = normalizeInstagramProfileUrl(response?.profileUrl);
    if (profileUrl) {
      console.info('[PostFlow][Instagram] Authenticated profile link resolved', {
        tabId,
        profilePath: new URL(profileUrl).pathname,
        attempt: attempt + 1,
      });
      return profileUrl;
    }
    if (attempt < 7) await delay(500);
  }
  console.warn('[PostFlow][Instagram] Authenticated profile link was not found', { tabId, attempts: 8 });
  return null;
}

function waitForProfileReady(tabId: number, profileUrl: string, timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener as any);
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const listener = (updatedTabId: number, changeInfo: { status?: string; url?: string }) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      void chrome.tabs.get(tabId).then((tab) => {
        finish(tab?.url ? normalizeInstagramProfileUrl(tab.url) === profileUrl : false);
      }).catch(() => finish(false));
    };
    chrome.tabs.onUpdated.addListener(listener as any);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === 'complete' && tab.url && normalizeInstagramProfileUrl(tab.url) === profileUrl) finish(true);
    }).catch(() => finish(false));
  });
}

async function ensureInstagramProfilePage(tabId: number, target: InstagramTarget): Promise<string | null> {
  // Legacy jobs carry the username in the target. ID-backed jobs intentionally
  // do not persist a username, so discover the current account's own profile
  // link from the authenticated Instagram document instead.
  const profileUrl = profileUrlForUsername(target.instagramUsername) ?? await discoverOwnProfileUrl(tabId);
  if (!profileUrl) return null;
  const current = await chrome.tabs.get(tabId).catch(() => null);
  const currentProfileUrl = normalizeInstagramProfileUrl(current?.url);
  if (currentProfileUrl === profileUrl) return profileUrl;
  console.info('[PostFlow][Instagram] Navigating to the account profile before publishing', {
    tabId,
    profilePath: new URL(profileUrl).pathname,
  });
  await chrome.tabs.update(tabId, { url: profileUrl, active: true });
  return (await waitForProfileReady(tabId, profileUrl)) ? profileUrl : null;
}

export class InstagramAdapter implements PlatformPublisherAdapter {
  readonly platform = 'INSTAGRAM' as const;
  readonly allowedHostnames = ['www.instagram.com', 'instagram.com'];
  readonly supportedTargetTypes = ['INSTAGRAM_FEED', 'INSTAGRAM_REEL'] as const;

  validateJob(job: PublishJob): ValidationResult {
    if (!isInstagramTarget(job.target)) return { valid: false, reason: `Unsupported Instagram target: ${job.target.type}` };
    const mediaUrls = Array.isArray(job.post.mediaUrls) ? job.post.mediaUrls : [];
    const isReel = job.target.type === 'INSTAGRAM_REEL';
    const imageCount = mediaUrls.filter((url) => typeof url === 'string' && url.startsWith('data:image/')).length;
    const videoCount = mediaUrls.filter((url) => typeof url === 'string' && url.startsWith('data:video/')).length;
    const validMedia = isReel
      ? mediaUrls.length === 1 && videoCount === 1
      : imageCount >= 1 && imageCount <= 4 && imageCount === mediaUrls.length;
    if (!validMedia) {
      return { valid: false, reason: isReel ? 'Instagram Reel requires one video' : 'Instagram Feed requires one to four images' };
    }
    return { valid: true };
  }

  getTargetUrl(job: PublishJob): string | null {
    if (!isInstagramTarget(job.target)) return null;
    return this.matchesUrl(job.target.url) ? job.target.url : 'https://www.instagram.com/';
  }

  async verifyActiveAccount(job: PublishJob): Promise<AccountVerificationResult> {
    if (!isInstagramTarget(job.target) || (!job.target.instagramAccountId && !job.target.instagramUsername)) {
      return { verified: false, reason: 'Instagram expected account identity is missing' };
    }
    const refreshed = await refreshInstagramSession(job.target.instagramAccountId, job.target.instagramUsername);
    const stored = await chrome.storage.local.get([
      'instagramSessionDetected',
      'instagramDetectedAccountId',
      'instagramDetectedUsername',
      'instagramSessionSnapshot',
    ]);
    const detected = typeof stored.instagramDetectedAccountId === 'string'
      ? stored.instagramDetectedAccountId
      : '';
    const expected = job.target.instagramAccountId?.trim();
    const detectedUsername = typeof stored.instagramDetectedUsername === 'string'
      ? stored.instagramDetectedUsername.toLowerCase()
      : '';
    const expectedUsername = job.target.instagramUsername?.trim().replace(/^@/, '').toLowerCase();
    const verified = refreshed && isFreshInstagramSession(stored.instagramSessionSnapshot as InstagramSessionSnapshot | undefined) &&
      Boolean((expected && detected === expected) || (!expected && expectedUsername && detectedUsername === expectedUsername));
    return {
      verified,
      expectedAccountId: expected ?? expectedUsername,
      detectedAccountId: detected || detectedUsername || undefined,
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
      const profileUrl = await ensureInstagramProfilePage(tabId, job.target);
      if (!profileUrl) {
        console.warn('[PostFlow][Instagram] Own profile page could not be resolved before publishing', { tabId, jobId: job.id });
        return {
          success: false,
          status: 'FAILED',
          reason: 'Instagram account profile page could not be opened before publishing.',
        };
      }
      console.info('[PostFlow][Instagram] Profile page ready; starting composer', {
        tabId,
        jobId: job.id,
        profilePath: new URL(profileUrl).pathname,
      });
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
      bindInstagramExecution(tabId, job.id);
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'INSTAGRAM_EXECUTE_JOB',
        jobId: job.id,
        expectedAccountId: job.target.instagramAccountId,
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
        return confirmInstagramCaption({
          ...(response ?? {}),
          success: true,
          status: 'PUBLISHED',
          postUrl: response?.postUrl ?? observedPostUrl,
          reason: 'Instagram post permalink was observed during tab navigation.',
        }, job);
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
          return confirmInstagramCaption({ ...response, postUrl: recoveredPostUrl }, job);
        }
      }
      return confirmInstagramCaption(
        response ?? { success: false, status: 'FAILED', reason: 'Instagram composer returned no result' },
        job,
      );
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
        return confirmInstagramCaption({
          success: true,
          status: recoveredPostUrl ? 'PUBLISHED' : 'UNKNOWN',
          ...(recoveredPostUrl ? { postUrl: recoveredPostUrl } : {}),
          reason: recoveryReason,
        }, job);
      }
      console.error('[PostFlow][Instagram] Composer command failed', {
        tabId,
        jobId: job.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return { success: false, status: 'FAILED', reason: error instanceof Error ? error.message : String(error) };
    } finally {
      releaseInstagramExecution(tabId);
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

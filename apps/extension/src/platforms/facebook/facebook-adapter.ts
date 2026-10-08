// Facebook Platform Adapter
// Keeps Facebook DOM automation inside the existing Facebook content script.

import {
  type AccountVerificationResult,
  type PlatformPublisherAdapter,
  type PublishResult,
  type ValidationResult,
} from '../../platform-adapter.js';
import type { PublishJob } from '../../publishing-target.js';
import {
  clearFacebookExecution,
  prepareFacebookExecution,
  refreshFacebookSession,
  verifyProfileTargetIdentity,
} from '../../background.js';

export class FacebookAdapter implements PlatformPublisherAdapter {
  readonly platform = 'FACEBOOK' as const;
  readonly allowedHostnames = ['www.facebook.com', 'facebook.com', 'm.facebook.com'];
  readonly supportedTargetTypes = ['GROUP', 'PROFILE_FEED'] as const;

  validateJob(job: PublishJob): ValidationResult {
    if (job.target.type !== 'GROUP' && job.target.type !== 'PROFILE_FEED') {
      return { valid: false, reason: `Unsupported Facebook target type: ${job.target.type}` };
    }
    return { valid: true };
  }

  getTargetUrl(job: PublishJob): string | null {
    if (job.target.type === 'GROUP') return job.target.url;
    if (job.target.type === 'PROFILE_FEED') return job.target.url;
    return null;
  }

  async verifyActiveAccount(job: PublishJob): Promise<AccountVerificationResult> {
    if (job.target.type === 'PROFILE_FEED') {
      const verified = await verifyProfileTargetIdentity(job.target);
      return {
        verified,
        expectedAccountId: job.target.facebookUserId,
        reason: verified ? undefined : 'Facebook profile account mismatch',
      };
    }
    const verified = await refreshFacebookSession();
    return {
      verified,
      reason: verified ? undefined : 'Facebook session is not verified',
    };
  }

  async waitForReady(tabId: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener as any);
        resolve(false);
      }, 30_000);

      const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status !== 'complete') return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener as any);
        resolve(true);
      };
      chrome.tabs.onUpdated.addListener(listener as any);
    });
  }

  async execute(tabId: number, job: PublishJob): Promise<PublishResult> {
    const profileVideoNotificationBaselineKeys =
      await prepareFacebookExecution(job, tabId);
    try {
      const resultPromise = this.waitForFacebookResult(tabId, job.id);
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_JOB',
        jobId: job.id,
        post: job.post,
        target: job.target,
        profileVideoNotificationBaselineKeys,
      });
      if (response?.accepted === true) {
        return resultPromise;
      }
      return {
        success: false,
        status: 'FAILED',
        reason: response?.error ?? 'Facebook content script did not accept the job',
      };
    } catch (error) {
      return {
        success: false,
        status: 'FAILED',
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // The legacy background result listener may clear this earlier after it
      // records the result; this is harmless and protects timeout/error paths.
      clearFacebookExecution(job.id);
    }
  }

  private waitForFacebookResult(tabId: number, jobId: string): Promise<PublishResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({
          success: false,
          status: 'FAILED',
          reason: 'Timed out waiting for Facebook publish result',
        });
      }, 5 * 60_000);

      const listener = (message: any, sender: chrome.runtime.MessageSender) => {
        if (message?.jobId !== jobId || sender.tab?.id !== tabId) return;
        if (message.type === 'JOB_SUCCESS') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          const submissionResult = message.submissionResult ?? {};
          resolve({
            success: true,
            status: submissionResult.status === 'PENDING_APPROVAL'
              ? 'PENDING_APPROVAL'
              : submissionResult.status === 'UNKNOWN'
                ? 'UNKNOWN'
                : 'PUBLISHED',
            postUrl: typeof submissionResult.postUrl === 'string'
              ? submissionResult.postUrl
              : undefined,
            reason: typeof submissionResult.reason === 'string'
              ? submissionResult.reason
              : undefined,
          });
        }
        if (message.type === 'JOB_FAILED') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve({
            success: false,
            status: 'FAILED',
            reason: typeof message.error === 'string' ? message.error : 'Facebook publishing failed',
            shouldPauseQueue: message.shouldPauseQueue === true,
            detector: typeof message.publishStatus === 'string' ? message.publishStatus : undefined,
          });
        }
        if (message.type === 'JOB_CANCELED') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve({
            success: false,
            status: 'FAILED',
            reason: 'Job canceled before Facebook submit',
          });
        }
      };

      chrome.runtime.onMessage.addListener(listener);
    });
  }

  normalizePostUrl(value: string): string | null {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return value;
      const match = url.pathname.match(
        /^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)/i,
      );
      if (!match) return value;
      return `https://www.facebook.com/groups/${match[1]}/${match[2]}/${match[3]}/`;
    } catch {
      return value;
    }
  }

  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.allowedHostnames.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }
}

export const facebookAdapter = new FacebookAdapter();

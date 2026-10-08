// Platform Publisher Adapter Contract
// Each platform implements this interface for isolated publishing behavior.

import type { PublishJob, PublishTarget } from './publishing-target.js';

export type PublishingPlatform = 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';

export interface AccountVerificationResult {
  verified: boolean;
  expectedAccountId?: string;
  detectedAccountId?: string;
  reason?: string;
}

export interface PublishResult {
  success: boolean;
  status: 'PUBLISHED' | 'PENDING_APPROVAL' | 'UNKNOWN' | 'FAILED';
  canceled?: boolean;
  postUrl?: string;
  externalPostId?: string;
  externalPublishId?: string;
  reason?: string;
  shouldPauseQueue?: boolean;
  detector?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface PlatformPublisherAdapter {
  readonly platform: PublishingPlatform;
  readonly allowedHostnames: readonly string[];
  readonly supportedTargetTypes: readonly string[];

  /** Validate the job before any navigation. */
  validateJob(job: PublishJob): ValidationResult;

  /** Get the initial navigation URL for this job's target. */
  getTargetUrl(job: PublishJob): string | null;

  /** Verify the active platform account matches the expected connection identity. */
  verifyActiveAccount(job: PublishJob): Promise<AccountVerificationResult>;

  /** Wait for the platform page to be ready for publishing. */
  waitForReady(tabId: number, job: PublishJob): Promise<boolean>;

  /** Execute the publishing flow. Returns the result. */
  execute(tabId: number, job: PublishJob): Promise<PublishResult>;

  /** Normalize a platform post URL to a stable canonical form. */
  normalizePostUrl(value: string): string | null;

  /** Optional: Check if the current page URL belongs to this platform. */
  matchesUrl(url: string): boolean;
}

// Shared step names for observability
export const PUBLISHING_STEPS = {
  JOB_CLAIMED: 'job.claimed',
  NAVIGATION_STARTED: 'navigation.started',
  DOCUMENT_READY: 'document.ready',
  IDENTITY_VERIFIED: 'identity.verified',
  COMPOSER_OPENED: 'composer.opened',
  MEDIA_ATTACHED: 'media.attached',
  CAPTION_INSERTED: 'caption.inserted',
  SUBMIT_STARTED: 'submit.started',
  SUBMIT_ACCEPTED: 'submit.accepted',
  RESULT_PUBLISHED: 'result.published',
  RESULT_UNKNOWN: 'result.unknown',
  RESULT_FAILED: 'result.failed',
} as const;

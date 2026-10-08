type EngagementSubmissionStatus = 'PUBLISHED' | 'PENDING_APPROVAL' | 'UNKNOWN';

export interface EngagementQueueCandidate {
  platform?: 'FACEBOOK' | 'INSTAGRAM';
  status?: string;
  submissionStatus?: EngagementSubmissionStatus;
  postUrl?: string;
  nextEngagementSyncAt?: Date | null;
}

/**
 * Mongo-compatible pattern for Facebook URLs that identify one published
 * post. Group feeds, profile pages, and pending-approval URLs are excluded.
 * The optional Markdown wrapper supports legacy values already stored as
 * `[label](https://...)`.
 */
export const FACEBOOK_ENGAGEMENT_PERMALINK_PATTERN =
  /^(?:\[[^\]]+\]\()?https:\/\/(?:[a-z0-9-]+\.)*facebook\.com\/(?:groups\/[^/?#]+\/(?:posts|permalink)\/[A-Za-z0-9_-]+|reel\/[A-Za-z0-9_-]+|share\/v\/[A-Za-z0-9_-]+|[^/?#]+\/posts\/[A-Za-z0-9_-]+|permalink\.php\?[^#)]*(?:story_fbid|fbid)=[A-Za-z0-9_-]+|watch\/?\?[^#)]*v=[A-Za-z0-9_-]+)(?:[/?#&][^)]*)?\)?$/i;

/** Instagram profile and canonical post/reel permalinks accepted by the worker. */
export const INSTAGRAM_ENGAGEMENT_PERMALINK_PATTERN =
  /^(?:\[[^\]]+\]\()?https:\/\/(?:www\.)?instagram\.com\/(?:[a-z0-9._-]+\/)?(?:p|reel)\/[A-Za-z0-9_-]+\/?(?:[?#][^)]*)?\)?$/i;

export function isFacebookEngagementPermalink(value?: string): boolean {
  return Boolean(
    value && FACEBOOK_ENGAGEMENT_PERMALINK_PATTERN.test(value.trim()),
  );
}

export function isInstagramEngagementPermalink(value?: string): boolean {
  return Boolean(
    value && INSTAGRAM_ENGAGEMENT_PERMALINK_PATTERN.test(value.trim()),
  );
}

export function isEligibleForEngagementSync(
  job: EngagementQueueCandidate,
  now = new Date(),
): boolean {
  return (
    job.status === 'SUCCESS' &&
    job.submissionStatus === 'PUBLISHED' &&
    (job.platform === 'INSTAGRAM'
      ? isInstagramEngagementPermalink(job.postUrl)
      : isFacebookEngagementPermalink(job.postUrl)) &&
    (!job.nextEngagementSyncAt || job.nextEngagementSyncAt <= now)
  );
}

export function getEngagementQueueFilter(now = new Date()) {
  return {
    status: 'SUCCESS',
    submissionStatus: 'PUBLISHED' as const,
    postUrl: { $regex: FACEBOOK_ENGAGEMENT_PERMALINK_PATTERN },
    $or: [
      { nextEngagementSyncAt: { $exists: false } },
      { nextEngagementSyncAt: null },
      { nextEngagementSyncAt: { $lte: now } },
    ],
  };
}

export function getPlatformEngagementQueueFilter(
  platform: 'FACEBOOK' | 'INSTAGRAM',
  now = new Date(),
) {
  const permalinkPattern = platform === 'INSTAGRAM'
    ? INSTAGRAM_ENGAGEMENT_PERMALINK_PATTERN
    : FACEBOOK_ENGAGEMENT_PERMALINK_PATTERN;
  return {
    status: 'SUCCESS',
    submissionStatus: 'PUBLISHED' as const,
    postUrl: { $regex: permalinkPattern },
    $or: [
      { nextEngagementSyncAt: { $exists: false } },
      { nextEngagementSyncAt: null },
      { nextEngagementSyncAt: { $lte: now } },
    ],
  };
}

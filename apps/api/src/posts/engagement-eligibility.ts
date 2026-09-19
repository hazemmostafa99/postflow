type EngagementSubmissionStatus = 'PUBLISHED' | 'PENDING_APPROVAL' | 'UNKNOWN';

export interface EngagementQueueCandidate {
  status?: string;
  submissionStatus?: EngagementSubmissionStatus;
  postUrl?: string;
  nextEngagementSyncAt?: Date | null;
}

export function isEligibleForEngagementSync(
  job: EngagementQueueCandidate,
  now = new Date(),
): boolean {
  return job.status === 'SUCCESS'
    && job.submissionStatus === 'PUBLISHED'
    && Boolean(job.postUrl)
    && (!job.nextEngagementSyncAt || job.nextEngagementSyncAt <= now);
}

export function getEngagementQueueFilter(now = new Date()) {
  return {
    status: 'SUCCESS',
    submissionStatus: 'PUBLISHED',
    postUrl: { $exists: true, $ne: '' },
    $or: [
      { nextEngagementSyncAt: { $exists: false } },
      { nextEngagementSyncAt: null },
      { nextEngagementSyncAt: { $lte: now } },
    ],
  };
}

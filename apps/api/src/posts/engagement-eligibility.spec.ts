import { getEngagementQueueFilter, isEligibleForEngagementSync } from './engagement-eligibility';

describe('engagement eligibility', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('accepts only successful published jobs with a due permalink', () => {
    expect(isEligibleForEngagementSync({ status: 'SUCCESS', submissionStatus: 'PUBLISHED', postUrl: 'https://facebook.com/post' }, now)).toBe(true);
    expect(isEligibleForEngagementSync({ status: 'FAILED', submissionStatus: 'PUBLISHED', postUrl: 'https://facebook.com/post' }, now)).toBe(false);
    expect(isEligibleForEngagementSync({ status: 'SUCCESS', submissionStatus: 'PENDING_APPROVAL', postUrl: 'https://facebook.com/post' }, now)).toBe(false);
    expect(isEligibleForEngagementSync({ status: 'SUCCESS', submissionStatus: 'PUBLISHED' }, now)).toBe(false);
  });

  it('excludes jobs whose next sync is in the future', () => {
    expect(isEligibleForEngagementSync({ status: 'SUCCESS', submissionStatus: 'PUBLISHED', postUrl: 'url', nextEngagementSyncAt: new Date('2026-01-01T12:01:00.000Z') }, now)).toBe(false);
    expect(getEngagementQueueFilter(now).$or).toHaveLength(3);
  });
});

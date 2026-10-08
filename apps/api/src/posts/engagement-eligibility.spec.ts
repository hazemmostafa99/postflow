import {
  getEngagementQueueFilter,
  getPlatformEngagementQueueFilter,
  isFacebookEngagementPermalink,
  isInstagramEngagementPermalink,
  isEligibleForEngagementSync,
} from './engagement-eligibility';

describe('engagement eligibility', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('accepts only successful published jobs with a due permalink', () => {
    expect(
      isEligibleForEngagementSync(
        {
          status: 'SUCCESS',
          submissionStatus: 'PUBLISHED',
          postUrl: 'https://www.facebook.com/groups/123/posts/456/',
        },
        now,
      ),
    ).toBe(true);
    expect(
      isEligibleForEngagementSync(
        {
          status: 'FAILED',
          submissionStatus: 'PUBLISHED',
          postUrl: 'https://www.facebook.com/groups/123/posts/456/',
        },
        now,
      ),
    ).toBe(false);
    expect(
      isEligibleForEngagementSync(
        {
          status: 'SUCCESS',
          submissionStatus: 'PENDING_APPROVAL',
          postUrl: 'https://www.facebook.com/groups/123/posts/456/',
        },
        now,
      ),
    ).toBe(false);
    expect(
      isEligibleForEngagementSync(
        { status: 'SUCCESS', submissionStatus: 'PUBLISHED' },
        now,
      ),
    ).toBe(false);
  });

  it('excludes jobs whose next sync is in the future', () => {
    expect(
      isEligibleForEngagementSync(
        {
          status: 'SUCCESS',
          submissionStatus: 'PUBLISHED',
          postUrl: 'https://www.facebook.com/reel/123/',
          nextEngagementSyncAt: new Date('2026-01-01T12:01:00.000Z'),
        },
        now,
      ),
    ).toBe(false);
    expect(getEngagementQueueFilter(now).$or).toHaveLength(3);
  });

  it.each([
    'https://www.facebook.com/groups/123/posts/456/',
    'https://www.facebook.com/groups/community/permalink/456/',
    'https://www.facebook.com/reel/123/',
    'https://www.facebook.com/profile-name/posts/456/',
    'https://www.facebook.com/permalink.php?id=123&story_fbid=456',
    'https://www.facebook.com/watch/?v=456',
    '[Facebook post](https://www.facebook.com/groups/123/posts/456/)',
  ])('accepts a supported Facebook permalink: %s', (postUrl) => {
    expect(isFacebookEngagementPermalink(postUrl)).toBe(true);
  });

  it.each([
    'https://www.facebook.com/groups/123/',
    'https://www.facebook.com/groups/123/pending_posts/456/',
    'https://example.com/groups/123/posts/456/',
    'not-a-url',
  ])('rejects a non-post URL: %s', (postUrl) => {
    expect(isFacebookEngagementPermalink(postUrl)).toBe(false);
  });

  it.each([
    'https://www.instagram.com/p/DeOaDcwHEsk/',
    'https://www.instagram.com/ema.d1852/p/DeOaDcwHEsk/',
    'https://instagram.com/ema.d1852/reel/ABC_123/',
  ])('accepts a supported Instagram permalink: %s', (postUrl) => {
    expect(isInstagramEngagementPermalink(postUrl)).toBe(true);
  });

  it('builds an Instagram-specific engagement queue filter', () => {
    const filter = getPlatformEngagementQueueFilter('INSTAGRAM', now);
    expect(filter.postUrl.$regex).toBeDefined();
    expect(filter.$or).toHaveLength(3);
  });

  it('accepts an Instagram candidate when its platform is explicit', () => {
    expect(
      isEligibleForEngagementSync(
        {
          platform: 'INSTAGRAM',
          status: 'SUCCESS',
          submissionStatus: 'PUBLISHED',
          postUrl: 'https://www.instagram.com/p/DeOaDcwHEsk/',
        },
        now,
      ),
    ).toBe(true);
  });
});

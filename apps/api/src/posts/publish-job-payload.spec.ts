import { PublishingTargetType } from '../schemas/publishing-target';
import { PublishingPlatform } from '../schemas/publishing-platform';
import {
  getFacebookProfileUrl,
  toPublishJobPayload,
} from './publish-job-payload';

describe('toPublishJobPayload', () => {
  const id = (value: string) => ({ toString: () => value });

  it('maps group jobs to normalized and legacy-compatible payload fields', () => {
    const groupId = id('group-1');
    const payload = toPublishJobPayload({
      _id: id('job-1'),
      targetType: PublishingTargetType.GROUP,
      postId: {
        content: 'Hello group',
        mediaUrls: ['https://cdn.example/post.png'],
      },
      groupId: {
        _id: groupId,
        name: 'Launch group',
        externalId: 'launch-group',
        url: 'https://www.facebook.com/groups/launch-group/',
      },
    });

    expect(payload?.groupId?._id.toString()).toBe('group-1');
    expect(payload).toEqual({
      id: 'job-1',
      _id: 'job-1',
      platform: PublishingPlatform.FACEBOOK,
      targetType: PublishingTargetType.GROUP,
      post: {
        content: 'Hello group',
        mediaUrls: ['https://cdn.example/post.png'],
      },
      postId: {
        content: 'Hello group',
        mediaUrls: ['https://cdn.example/post.png'],
      },
      groupId: {
        _id: groupId,
        name: 'Launch group',
        externalId: 'launch-group',
        url: 'https://www.facebook.com/groups/launch-group/',
      },
      target: {
        type: PublishingTargetType.GROUP,
        groupId: 'group-1',
        name: 'Launch group',
        externalId: 'launch-group',
        url: 'https://www.facebook.com/groups/launch-group/',
      },
    });
  });

  it('maps profile feed jobs from the populated Facebook connection', () => {
    const payload = toPublishJobPayload({
      _id: id('job-2'),
      targetType: PublishingTargetType.PROFILE_FEED,
      postId: { content: 'Hello profile' },
      facebookConnectionId: {
        _id: id('connection-1'),
        displayName: 'Chrome Work',
        facebookUserId: '12345',
        detectedFacebookUserId: '12345',
      },
    });

    expect(payload).toEqual({
      id: 'job-2',
      _id: 'job-2',
      platform: PublishingPlatform.FACEBOOK,
      targetType: PublishingTargetType.PROFILE_FEED,
      post: {
        content: 'Hello profile',
        mediaUrls: [],
      },
      postId: {
        content: 'Hello profile',
        mediaUrls: [],
      },
      target: {
        type: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: 'connection-1',
        facebookUserId: '12345',
        name: 'Chrome Work',
        url: 'https://www.facebook.com/profile.php?id=12345',
      },
    });
  });

  it('returns null for malformed target payloads', () => {
    expect(
      toPublishJobPayload({
        _id: id('job-3'),
        targetType: PublishingTargetType.GROUP,
        postId: { content: 'No group' },
      }),
    ).toBeNull();

    expect(
      toPublishJobPayload({
        _id: id('job-4'),
        targetType: PublishingTargetType.PROFILE_FEED,
        postId: { content: 'No identity' },
        facebookConnectionId: { _id: id('connection-1') },
      }),
    ).toBeNull();
  });

  it('fails closed for platform targets whose delivery adapter is not enabled', () => {
    expect(
      toPublishJobPayload({
        _id: id('job-5'),
        targetType: PublishingTargetType.INSTAGRAM_FEED,
        postId: { content: 'Not deliverable yet' },
      }),
    ).toBeNull();
  });

  it('maps an Instagram Feed job using the username identity fallback', () => {
    const payload = toPublishJobPayload({
      _id: id('job-instagram-1'),
      targetType: PublishingTargetType.INSTAGRAM_FEED,
      postId: { content: 'Hello Instagram', mediaUrls: ['data:image/png;base64,AAAA'] },
      platformConnectionId: {
        _id: id('platform-connection-1'),
        platform: PublishingPlatform.INSTAGRAM,
        externalUsername: 'brand.account',
      },
    });

    expect(payload?.target).toEqual({
      type: PublishingTargetType.INSTAGRAM_FEED,
      platformConnectionId: 'platform-connection-1',
      instagramUsername: 'brand.account',
      url: 'https://www.instagram.com/brand.account/',
    });
  });

  it('externalizes TikTok video bytes behind a lease-scoped media reference', () => {
    const expiresAt = new Date('2026-10-09T03:00:00.000Z');
    const payload = toPublishJobPayload(
      {
        _id: id('job-tiktok-1'),
        platform: PublishingPlatform.TIKTOK,
        targetType: PublishingTargetType.TIKTOK_VIDEO,
        claimExpiresAt: expiresAt,
        postId: {
          content: 'TikTok caption',
          mediaUrls: ['data:video/mp4;base64,SGVsbG8='],
        },
        platformConnectionId: {
          _id: id('platform-connection-tiktok-1'),
          platform: PublishingPlatform.TIKTOK,
          externalUsername: 'creator',
        },
      },
      { mediaAccessToken: 'a'.repeat(43) },
    );

    expect(payload?.post.mediaUrls).toEqual([]);
    expect(payload?.post.media).toEqual([
      {
        index: 0,
        contentType: 'video/mp4',
        sizeBytes: 5,
        fileName: 'postflow-media.mp4',
        fetchPath: '/api/jobs/job-tiktok-1/media/0',
        accessToken: 'a'.repeat(43),
        expiresAt: expiresAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain('SGVsbG8');
  });

  it('externalizes every TikTok photo behind lease-scoped media references', () => {
    const expiresAt = new Date('2026-10-09T03:00:00.000Z');
    const payload = toPublishJobPayload({
      _id: id('job-tiktok-photos'), platform: PublishingPlatform.TIKTOK,
      targetType: PublishingTargetType.TIKTOK_PHOTO, claimExpiresAt: expiresAt,
      postId: { content: 'Photo caption', mediaUrls: [
        'data:image/png;base64,SGVsbG8=', 'data:image/jpeg;base64,V29ybGQ=',
      ] },
      platformConnectionId: { _id: id('platform-connection-tiktok-1'),
        platform: PublishingPlatform.TIKTOK, externalUsername: 'creator' },
    }, { mediaAccessToken: 'a'.repeat(43) });
    expect(payload?.target.type).toBe(PublishingTargetType.TIKTOK_PHOTO);
    expect(payload?.post.media).toHaveLength(2);
    expect(payload?.post.mediaUrls).toEqual([]);
  });

  it('fails closed for a TikTok job without a live media grant', () => {
    expect(
      toPublishJobPayload({
        _id: id('job-tiktok-2'),
        platform: PublishingPlatform.TIKTOK,
        targetType: PublishingTargetType.TIKTOK_VIDEO,
        postId: { mediaUrls: ['data:video/mp4;base64,SGVsbG8='] },
        platformConnectionId: {
          _id: id('platform-connection-tiktok-1'),
          platform: PublishingPlatform.TIKTOK,
          externalUsername: 'creator',
        },
      }),
    ).toBeNull();
  });
});

describe('getFacebookProfileUrl', () => {
  it('encodes the persisted Facebook user id', () => {
    expect(getFacebookProfileUrl('abc 123')).toBe(
      'https://www.facebook.com/profile.php?id=abc%20123',
    );
  });
});

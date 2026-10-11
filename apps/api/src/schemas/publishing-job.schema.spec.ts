import {
  getPublishingPlatformForTargetType,
  PublishingTargetType,
  resolvePublishingTargetType,
  validatePublishingTarget,
} from './publishing-target';
import {
  PublishingPlatform,
  resolvePublishingPlatform,
} from './publishing-platform';

describe('PublishingJob target validation', () => {
  it('treats a missing target type as a legacy GROUP job', () => {
    expect(resolvePublishingTargetType()).toBe(PublishingTargetType.GROUP);
    expect(resolvePublishingPlatform()).toBe(PublishingPlatform.FACEBOOK);
    expect(validatePublishingTarget({ groupId: 'group-id' })).toBeNull();
  });

  it.each([
    [PublishingTargetType.GROUP, PublishingPlatform.FACEBOOK],
    [PublishingTargetType.PROFILE_FEED, PublishingPlatform.FACEBOOK],
    [PublishingTargetType.INSTAGRAM_FEED, PublishingPlatform.INSTAGRAM],
    [PublishingTargetType.INSTAGRAM_REEL, PublishingPlatform.INSTAGRAM],
    [PublishingTargetType.TIKTOK_VIDEO, PublishingPlatform.TIKTOK],
    [PublishingTargetType.TIKTOK_PHOTO, PublishingPlatform.TIKTOK],
  ])('maps %s to %s', (targetType, platform) => {
    expect(getPublishingPlatformForTargetType(targetType)).toBe(platform);
  });

  it('requires a group for GROUP jobs', () => {
    expect(
      validatePublishingTarget({ targetType: PublishingTargetType.GROUP }),
    ).toEqual({
      path: 'groupId',
      message: 'GROUP jobs require a group',
    });
  });

  it('accepts a PROFILE_FEED job assigned to a Facebook connection', () => {
    expect(
      validatePublishingTarget({
        targetType: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: 'connection-id',
      }),
    ).toBeNull();
  });

  it('requires a Facebook connection for PROFILE_FEED jobs', () => {
    expect(
      validatePublishingTarget({
        targetType: PublishingTargetType.PROFILE_FEED,
      }),
    ).toEqual({
      path: 'facebookConnectionId',
      message: 'PROFILE_FEED jobs require a Facebook connection',
    });
  });

  it('rejects a group on PROFILE_FEED jobs', () => {
    expect(
      validatePublishingTarget({
        targetType: PublishingTargetType.PROFILE_FEED,
        groupId: 'group-id',
        facebookConnectionId: 'connection-id',
      }),
    ).toEqual({
      path: 'groupId',
      message: 'PROFILE_FEED jobs must not reference a group',
    });
  });

  it.each([
    [PublishingTargetType.INSTAGRAM_FEED, PublishingPlatform.INSTAGRAM],
    [PublishingTargetType.INSTAGRAM_REEL, PublishingPlatform.INSTAGRAM],
    [PublishingTargetType.TIKTOK_VIDEO, PublishingPlatform.TIKTOK],
    [PublishingTargetType.TIKTOK_PHOTO, PublishingPlatform.TIKTOK],
  ])(
    'accepts a %s job with its platform connection',
    (targetType, platform) => {
      expect(
        validatePublishingTarget({
          platform,
          targetType,
          platformConnectionId: 'platform-connection-id',
        }),
      ).toBeNull();
    },
  );

  it('rejects a target whose platform discriminator does not match', () => {
    expect(
      validatePublishingTarget({
        platform: PublishingPlatform.TIKTOK,
        targetType: PublishingTargetType.INSTAGRAM_REEL,
        platformConnectionId: 'platform-connection-id',
      }),
    ).toEqual({
      path: 'platform',
      message: 'INSTAGRAM_REEL jobs require the INSTAGRAM platform',
    });
  });

  it('requires a generic platform connection for Instagram and TikTok', () => {
    expect(
      validatePublishingTarget({
        platform: PublishingPlatform.TIKTOK,
        targetType: PublishingTargetType.TIKTOK_VIDEO,
      }),
    ).toEqual({
      path: 'platformConnectionId',
      message: 'TIKTOK_VIDEO jobs require a platform connection',
    });
  });

  it('rejects Facebook ownership fields on non-Facebook jobs', () => {
    expect(
      validatePublishingTarget({
        platform: PublishingPlatform.INSTAGRAM,
        targetType: PublishingTargetType.INSTAGRAM_FEED,
        facebookConnectionId: 'facebook-connection-id',
        platformConnectionId: 'platform-connection-id',
      }),
    ).toEqual({
      path: 'facebookConnectionId',
      message: 'INSTAGRAM_FEED jobs must not reference a Facebook connection',
    });
  });
});

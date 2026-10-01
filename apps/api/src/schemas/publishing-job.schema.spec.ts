import {
  PublishingTargetType,
  resolvePublishingTargetType,
  validatePublishingTarget,
} from './publishing-target';

describe('PublishingJob target validation', () => {
  it('treats a missing target type as a legacy GROUP job', () => {
    expect(resolvePublishingTargetType()).toBe(PublishingTargetType.GROUP);
    expect(validatePublishingTarget({ groupId: 'group-id' })).toBeNull();
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
});

import { PublishingTargetType } from '../schemas/publishing-target';
import {
  isVerifiedInstagramConnection,
  isVerifiedProfileConnection,
  normalizeCreatePostTargets,
} from './create-post-targets';

describe('normalizeCreatePostTargets', () => {
  const groupId = '64b000000000000000000001';
  const connectionId = '64b000000000000000000002';

  it('normalizes typed Group and profile targets in request order', () => {
    expect(
      normalizeCreatePostTargets(
        [
          { type: 'PROFILE_FEED', facebookConnectionId: connectionId },
          { type: 'GROUP', groupId },
        ],
        undefined,
      ),
    ).toEqual([
      {
        type: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: connectionId,
      },
      { type: PublishingTargetType.GROUP, groupId },
    ]);
  });

  it('normalizes Instagram Feed and Reel targets', () => {
    expect(
      normalizeCreatePostTargets(
        [
          { type: 'INSTAGRAM_FEED', platformConnectionId: connectionId },
          { type: 'INSTAGRAM_REEL', platformConnectionId: '64b000000000000000000003' },
        ],
        undefined,
      ),
    ).toEqual([
      { type: PublishingTargetType.INSTAGRAM_FEED, platformConnectionId: connectionId },
      { type: PublishingTargetType.INSTAGRAM_REEL, platformConnectionId: '64b000000000000000000003' },
    ]);
  });

  it('converts legacy targetGroupIds to Group targets', () => {
    expect(normalizeCreatePostTargets(undefined, [groupId])).toEqual([
      { type: PublishingTargetType.GROUP, groupId },
    ]);
  });

  it('canonicalizes object IDs for stable ownership lookup', () => {
    expect(
      normalizeCreatePostTargets(undefined, [groupId.toUpperCase()]),
    ).toEqual([{ type: PublishingTargetType.GROUP, groupId }]);
  });

  it('combines typed and legacy targets', () => {
    expect(
      normalizeCreatePostTargets(
        [{ type: 'PROFILE_FEED', facebookConnectionId: connectionId }],
        [groupId],
      ),
    ).toHaveLength(2);
  });

  it('requires at least one target', () => {
    expect(() => normalizeCreatePostTargets([], [])).toThrow(
      'At least one publishing target must be selected',
    );
  });

  it('rejects invalid database IDs', () => {
    expect(() =>
      normalizeCreatePostTargets(
        [{ type: 'PROFILE_FEED', facebookConnectionId: 'not-an-id' }],
        undefined,
      ),
    ).toThrow('A valid Facebook connection ID is required');
  });

  it('rejects duplicate targets across typed and legacy inputs', () => {
    expect(() =>
      normalizeCreatePostTargets([{ type: 'GROUP', groupId }], [groupId]),
    ).toThrow('Duplicate publishing targets are not allowed');
  });

  it('rejects duplicate profile destinations', () => {
    expect(() =>
      normalizeCreatePostTargets(
        [
          { type: 'PROFILE_FEED', facebookConnectionId: connectionId },
          { type: 'PROFILE_FEED', facebookConnectionId: connectionId },
        ],
        undefined,
      ),
    ).toThrow('Duplicate publishing targets are not allowed');
  });

  it('rejects fields belonging to another target type', () => {
    expect(() =>
      normalizeCreatePostTargets(
        [
          {
            type: 'PROFILE_FEED',
            facebookConnectionId: connectionId,
            groupId,
          },
        ],
        undefined,
      ),
    ).toThrow('PROFILE_FEED targets must not include a group');
  });

  it('rejects unsupported target types', () => {
    expect(() =>
      normalizeCreatePostTargets(
        [{ type: 'PAGE', facebookConnectionId: connectionId }],
        undefined,
      ),
    ).toThrow('Unsupported publishing target type');
  });

  it('accepts an identity-matched connected Facebook session', () => {
    expect(
      isVerifiedProfileConnection({
        status: 'CONNECTED',
        facebookSessionDetected: true,
        facebookUserId: 'facebook-user-1',
        detectedFacebookUserId: 'facebook-user-1',
      }),
    ).toBe(true);
  });

  it('accepts an identity-matched connected Instagram session by username', () => {
    expect(
      isVerifiedInstagramConnection({
        platform: 'INSTAGRAM',
        status: 'CONNECTED',
        sessionDetected: true,
        externalUsername: 'brand.account',
        detectedExternalUsername: 'Brand.Account',
      }),
    ).toBe(true);
  });

  it.each([
    {
      status: 'DISCONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    },
    {
      status: 'CONNECTED',
      facebookSessionDetected: false,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    },
    {
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-2',
    },
  ])('rejects an unverified Facebook connection: %#', (connection) => {
    expect(isVerifiedProfileConnection(connection)).toBe(false);
  });
});

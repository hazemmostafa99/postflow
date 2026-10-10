jest.mock('@nestjs/mongoose', () => ({
  InjectModel: () => () => undefined,
  Prop: () => () => undefined,
  Schema: () => (target: unknown) => target,
  SchemaFactory: {
    createForClass: () => ({
      index: jest.fn(),
      pre: jest.fn(),
    }),
  },
}));

import { ForbiddenException } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import {
  FacebookSubmissionStatus,
  MaintenanceClaimType,
  PublishingJobStatus,
  PublishingTargetType,
} from '../schemas/publishing-job.schema';
import { PublishingPlatform } from '../schemas/publishing-platform';
import { hashJobMediaAccessToken } from './job-media-delivery';
import * as tikTokPolicy from './tiktok-publishing-policy';

describe('JobsController.getJobMedia', () => {
  const accessToken = 'a'.repeat(43);

  function createMediaHarness(overrides: Record<string, unknown> = {}) {
    const job = {
      status: PublishingJobStatus.RUNNING,
      claimedByExtensionInstanceId: 'extension-1',
      claimExpiresAt: new Date(Date.now() + 60_000),
      mediaAccessTokenHash: hashJobMediaAccessToken(accessToken),
      mediaAccessExpiresAt: new Date(Date.now() + 60_000),
      postId: { mediaUrls: ['data:video/mp4;base64,SGVsbG8='] },
      ...overrides,
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(job),
    };
    const jobModel = { findById: jest.fn().mockReturnValue(query) };
    const controller = new JobsController(
      jobModel as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = {
      setHeader: jest.fn(),
      end: jest.fn(),
    };
    return { controller, jobModel, query, response };
  }

  it('streams bytes only for a valid token on an active job lease', async () => {
    const { controller, query, response } = createMediaHarness();

    await controller.getJobMedia(
      'job-1',
      '0',
      `Bearer ${accessToken}`,
      response as never,
    );

    expect(query.select).toHaveBeenCalledWith('+mediaAccessTokenHash');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'video/mp4',
    );
    expect(response.end).toHaveBeenCalledWith(Buffer.from('Hello'));
  });

  it('rejects a token after cancellation or lease expiry', async () => {
    const canceled = createMediaHarness({
      status: PublishingJobStatus.CANCEL_REQUESTED,
    });
    await expect(
      canceled.controller.getJobMedia(
        'job-1',
        '0',
        `Bearer ${accessToken}`,
        canceled.response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const expired = createMediaHarness({
      claimExpiresAt: new Date(Date.now() - 1),
    });
    await expect(
      expired.controller.getJobMedia(
        'job-1',
        '0',
        `Bearer ${accessToken}`,
        expired.response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a bearer token issued for another job', async () => {
    const { controller, response } = createMediaHarness();
    await expect(
      controller.getJobMedia(
        'job-1',
        '0',
        `Bearer ${'b'.repeat(43)}`,
        response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('JobsController.getNextJob', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const postObjectId = { toString: () => 'post-1' };
  const connectionObjectId = { toString: () => 'connection-1' };
  type ClaimQuery = {
    facebookConnectionId?: unknown;
    postId?: unknown;
    $and: Array<unknown>;
    $or: Array<{
      status: PublishingJobStatus;
      claimExpiresAt?: {
        $lte?: Date;
        $exists?: boolean;
      };
    }>;
  };
  type ClaimUpdate = {
    $set: {
      status: PublishingJobStatus;
      claimedByExtensionInstanceId: string;
      startedAt: Date;
      claimExpiresAt: Date;
    };
  };
  type ClaimOptions = {
    new: boolean;
    sort: Record<string, number>;
  };

  function queryChain<T>(result: T) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
    return chain;
  }

  function populatedJobChain<T>(result: T) {
    const chain = {
      populate: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
    return chain;
  }

  function createHarness(options?: {
    connection?: Record<string, unknown> | null;
    connectionExtensionInstanceId?: string;
    profileJob?: boolean;
  }) {
    const connectionExtensionInstanceId =
      options?.connectionExtensionInstanceId ?? extensionInstanceId;
    const connection =
      options?.connection === undefined
        ? {
            _id: connectionObjectId,
            extensionInstanceId: connectionExtensionInstanceId,
            status: 'CONNECTED',
            facebookSessionDetected: true,
            facebookUserId: 'facebook-user-1',
            detectedFacebookUserId: 'facebook-user-1',
          }
        : options.connection;

    const postModel = {
      find: jest.fn().mockReturnValue(queryChain([{ _id: postObjectId }])),
    };
    const job = {
      _id: { toString: () => 'job-1' },
      targetType: options?.profileJob
        ? PublishingTargetType.PROFILE_FEED
        : PublishingTargetType.GROUP,
      postId: {
        content: 'Hello',
        mediaUrls: ['https://cdn.example/image.jpg'],
      },
      ...(options?.profileJob
        ? {
            facebookConnectionId: {
              _id: connectionObjectId,
              displayName: 'Personal profile',
              facebookUserId: 'facebook-user-1',
              detectedFacebookUserId: 'facebook-user-1',
            },
          }
        : {
            groupId: {
              _id: { toString: () => 'group-1' },
              name: 'Group One',
              externalId: 'group-one',
              url: 'https://www.facebook.com/groups/group-one/',
            },
            facebookConnectionId: connectionObjectId,
          }),
    };
    const jobChain = populatedJobChain(job);
    const findOneAndUpdate = jest.fn(
      (query: ClaimQuery, update: ClaimUpdate, options: ClaimOptions) => {
        void query;
        void update;
        void options;
        return jobChain;
      },
    );
    const jobModel = {
      findOneAndUpdate,
      findOne: jest.fn().mockReturnValue(populatedJobChain(job)),
    };
    const connectionModel = {
      findOne: jest.fn((query: { extensionInstanceId?: string }) =>
        query.extensionInstanceId === connectionExtensionInstanceId
          ? queryChain(connection)
          : queryChain(null)),
      updateOne: jest.fn(),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerkUserId: string, extensionInstanceId?: string) => {
          const normalized = extensionInstanceId?.trim();
          if (!normalized) {
            throw new Error('x-extension-instance-id header is required');
          }
          return {
            _id: { toString: () => 'installation-1' },
            clerkUserId,
            extensionInstanceId: normalized,
            status: 'ACTIVE',
          };
        },
      ),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerkUserId: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return found ?? null;
        },
      ),
    };
    const controller = new JobsController(
      jobModel as never,
      postModel as never,
      connectionModel as never,
      extensionsService as never,
    );

    return {
      controller,
      jobModel,
      jobChain,
      connectionModel,
      extensionsService,
    };
  }

  it('returns a normalized group payload while preserving legacy fields', async () => {
    const { controller } = createHarness();

    const result = await controller.getNextJob(
      clerkUserId,
      extensionInstanceId,
    );

    expect(result).toMatchObject({
      id: 'job-1',
      _id: 'job-1',
      targetType: PublishingTargetType.GROUP,
      post: {
        content: 'Hello',
        mediaUrls: ['https://cdn.example/image.jpg'],
      },
      postId: {
        content: 'Hello',
        mediaUrls: ['https://cdn.example/image.jpg'],
      },
      target: {
        type: PublishingTargetType.GROUP,
        groupId: 'group-1',
        name: 'Group One',
        externalId: 'group-one',
        url: 'https://www.facebook.com/groups/group-one/',
      },
    });
  });

  it('claims only jobs assigned to the verified worker connection', async () => {
    const { controller, jobModel, jobChain } = createHarness();

    await controller.getNextJob(clerkUserId, extensionInstanceId);

    const [query, update] = jobModel.findOneAndUpdate.mock.calls[0];
    expect(query.facebookConnectionId).toBe(connectionObjectId);
    expect(query.postId).toEqual({ $in: ['post-1'] });
    expect(query.$and[0]).toEqual({
      $or: [
        { targetType: PublishingTargetType.GROUP },
        { targetType: PublishingTargetType.PROFILE_FEED },
        { targetType: { $exists: false } },
        { targetType: null },
      ],
    });
    expect(query.$or[0]).toEqual({ status: PublishingJobStatus.PENDING });
    expect(query.$or[1].status).toBe(PublishingJobStatus.RUNNING);
    expect(query.$or[1].claimExpiresAt?.$lte).toBeInstanceOf(Date);
    expect(query.$or[2]).toEqual({
      status: PublishingJobStatus.RUNNING,
      claimExpiresAt: { $exists: false },
    });
    expect(update.$set.status).toBe(PublishingJobStatus.RUNNING);
    expect(update.$set.claimedByExtensionInstanceId).toBe(extensionInstanceId);
    expect(update.$set.startedAt).toBeInstanceOf(Date);
    expect(update.$set.claimExpiresAt).toBeInstanceOf(Date);
    expect(jobChain.populate).toHaveBeenCalledWith(
      'facebookConnectionId',
      'displayName facebookUserId detectedFacebookUserId',
    );
  });

  it('claims and returns a verified profile feed job', async () => {
    const { controller, jobModel } = createHarness({ profileJob: true });

    const result = await controller.getNextJob(
      clerkUserId,
      extensionInstanceId,
    );

    expect(result).toMatchObject({
      targetType: PublishingTargetType.PROFILE_FEED,
      target: {
        type: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: 'connection-1',
        facebookUserId: 'facebook-user-1',
        url: 'https://www.facebook.com/profile.php?id=facebook-user-1',
      },
    });
    const [query] = jobModel.findOneAndUpdate.mock.calls[0];
    expect(query.$and[0]).toEqual({
      $or: [
        { targetType: PublishingTargetType.GROUP },
        { targetType: PublishingTargetType.PROFILE_FEED },
        { targetType: { $exists: false } },
        { targetType: null },
      ],
    });
  });

  it.each(['false', 'true'])('claims only jobs owned by the installation platform connections (TikTok enabled=%s)', async (enabled) => {
    const previousFlag = process.env.TIKTOK_EXTENSION_PUBLISHING_ENABLED;
    process.env.TIKTOK_EXTENSION_PUBLISHING_ENABLED = enabled;
    const instagramConnectionId = { toString: () => 'instagram-connection-1' };
    const platformConnectionModel = {
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { _id: instagramConnectionId, platform: 'INSTAGRAM' },
        ]),
      })),
    };
    const postModel = {
      find: jest.fn(() => queryChain([{ _id: postObjectId }])),
    };
    const jobModel = {
      findOneAndUpdate: jest.fn(() => populatedJobChain(null)),
    };
    const connectionModel = { findOne: jest.fn(() => queryChain(null)) };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn().mockResolvedValue({
        _id: { toString: () => 'installation-1' },
        clerkUserId,
        extensionInstanceId,
        status: 'ACTIVE',
      }),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(),
    };
    const controller = new JobsController(
      jobModel as never,
      postModel as never,
      connectionModel as never,
      extensionsService as never,
      platformConnectionModel as never,
    );

    await controller.getNextJob(clerkUserId, extensionInstanceId);

    const [claimQuery] = jobModel.findOneAndUpdate.mock.calls[0];
    expect(claimQuery.$and[0]).toEqual({
      $or: [{ platformConnectionId: { $in: [instagramConnectionId] } }],
    });
    expect(claimQuery.$and[1]).toEqual(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ platform: 'INSTAGRAM' }),
        ]),
      }),
    );
    expect(claimQuery.$and[1].$or.some((branch: { platform?: string }) => branch.platform === 'TIKTOK')).toBe(enabled === 'true');
    expect(claimQuery.$and[2]).toEqual({ $or: [
      { platform: { $ne: 'TIKTOK' }, targetType: { $nin: ['TIKTOK_VIDEO', 'TIKTOK_PHOTO'] } },
      { submittedAt: { $exists: false }, submissionStatus: { $nin: ['UNKNOWN', 'PROCESSING', 'PUBLISHED'] } },
    ] });
    if (previousFlag === undefined) delete process.env.TIKTOK_EXTENSION_PUBLISHING_ENABLED;
    else process.env.TIKTOK_EXTENSION_PUBLISHING_ENABLED = previousFlag;
  });

  it('keeps legacy Facebook jobs claimable beside an Instagram connection', async () => {
    const instagramConnectionId = { toString: () => 'instagram-connection-1' };
    const platformConnectionModel = {
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { _id: instagramConnectionId, platform: 'INSTAGRAM' },
        ]),
      })),
    };
    const postModel = {
      find: jest.fn(() => queryChain([{ _id: postObjectId }])),
    };
    const jobModel = {
      findOneAndUpdate: jest.fn(() => populatedJobChain(null)),
    };
    const legacyFacebookConnection = {
      _id: connectionObjectId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn().mockResolvedValue({
        _id: { toString: () => 'installation-1' },
        clerkUserId,
        extensionInstanceId,
        status: 'ACTIVE',
      }),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn().mockResolvedValue(
        legacyFacebookConnection,
      ),
    };
    const controller = new JobsController(
      jobModel as never,
      postModel as never,
      { findOne: jest.fn() } as never,
      extensionsService as never,
      platformConnectionModel as never,
    );

    await controller.getNextJob(clerkUserId, extensionInstanceId);

    const [claimQuery] = jobModel.findOneAndUpdate.mock.calls[0];
    expect(claimQuery.$and[0]).toEqual({
      $or: [
        { platformConnectionId: { $in: [instagramConnectionId] } },
        { facebookConnectionId: { $in: [connectionObjectId] } },
      ],
    });
  });

  it('does not claim a job for an unverified extension connection', async () => {
    const { controller, jobModel } = createHarness({
      connection: {
        _id: connectionObjectId,
        status: 'CONNECTED',
        facebookSessionDetected: true,
        facebookUserId: 'facebook-user-1',
        detectedFacebookUserId: 'different-user',
      },
    });

    await expect(
      controller.getNextJob(clerkUserId, extensionInstanceId),
    ).resolves.toBeNull();
    expect(jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not claim a job from another extension instance', async () => {
    const { controller, jobModel } = createHarness({
      connectionExtensionInstanceId: 'another-extension',
    });

    await expect(
      controller.getNextJob(clerkUserId, extensionInstanceId),
    ).resolves.toBeNull();
    expect(jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a missing extension instance ID', async () => {
    const { controller, jobModel } = createHarness();

    await expect(controller.getNextJob(clerkUserId)).rejects.toThrow(
      'x-extension-instance-id header is required',
    );
    expect(jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('requires an extension instance for maintenance queues', async () => {
    const { controller } = createHarness();

    await expect(
      controller.getPendingPosts(clerkUserId, undefined),
    ).rejects.toThrow('x-extension-instance-id header is required');
    await expect(
      controller.getEngagementPendingPosts(clerkUserId, undefined),
    ).rejects.toThrow('x-extension-instance-id header is required');
  });
});

describe('JobsController target-specific sync guards', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionObjectId = { toString: () => 'connection-1' };

  function createProfileController(options?: {
    claimed?: boolean;
    engagement?: { reactionCount?: number; commentCount?: number; favoriteCount?: number; shareCount?: number };
    claimExpiresAt?: Date;
  }) {
    const profileJob = {
      targetType: PublishingTargetType.PROFILE_FEED,
      facebookConnectionId: connectionObjectId,
      postId: { clerkUserId: 'clerk-user-1' },
      submissionStatus: 'PUBLISHED',
      postUrl: 'https://www.facebook.com/reel/1490054189671164/',
      engagementSyncAttempts: 0,
      ...(options?.engagement ? { engagement: options.engagement } : {}),
      ...(options?.claimed
        ? {
            maintenanceClaimedByExtensionInstanceId: extensionInstanceId,
            maintenanceClaimType: MaintenanceClaimType.ENGAGEMENT,
            maintenanceClaimToken: 'claim-token',
            maintenanceClaimExpiresAt:
              options.claimExpiresAt ?? new Date(Date.now() + 60_000),
          }
        : {}),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const jobModel = {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(profileJob),
      }),
    };
    const verifiedConnection = {
      _id: connectionObjectId,
      extensionInstanceId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    };
    const connectionModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(verifiedConnection),
      }),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerk: string, instanceId?: string) => {
          const normalized = instanceId?.trim();
          if (!normalized) {
            throw new Error('x-extension-instance-id header is required');
          }
          return {
            _id: { toString: () => 'installation-1' },
            clerkUserId,
            extensionInstanceId: normalized,
            status: 'ACTIVE',
          };
        },
      ),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerk: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return (found as Record<string, unknown> | null) ?? null;
        },
      ),
    };
    return {
      controller: new JobsController(
        jobModel as never,
        {} as never,
        connectionModel as never,
        extensionsService as never,
      ),
      profileJob,
    };
  }

  it('persists engagement sync for a published profile job', async () => {
    const { controller, profileJob } = createProfileController({ claimed: true });

    await expect(
      controller.updateEngagement('clerk-user-1', extensionInstanceId, 'job-1', {
        status: 'SUCCESS',
        reactionCount: 1,
        commentCount: 2,
        claimToken: 'claim-token',
      }),
    ).resolves.toBe(profileJob);
    expect((profileJob as { engagement?: unknown }).engagement).toMatchObject({
      reactionCount: 1,
      commentCount: 2,
    });
    expect(profileJob.save).toHaveBeenCalled();
  });

  it('preserves the previous known counter when an analytics result is partial', async () => {
    const { controller, profileJob } = createProfileController({
      claimed: true,
      engagement: { reactionCount: 5, commentCount: 7 },
    });

    await controller.updateEngagement(
      'clerk-user-1',
      extensionInstanceId,
      'job-1',
      {
        status: 'PARTIAL',
        reactionCount: 9,
        reason: 'Comment count was not detected',
        claimToken: 'claim-token',
      },
    );

    expect((profileJob as { engagement?: unknown }).engagement).toMatchObject({
      reactionCount: 9,
      commentCount: 7,
    });
  });

  it('persists TikTok favorite/share counts and preserves counters omitted by a partial result', async () => {
    const previous = { reactionCount: 5, commentCount: 7, favoriteCount: 2, shareCount: 3 };
    const { controller, profileJob } = createProfileController({ claimed: true, engagement: previous });

    await controller.updateEngagement('clerk-user-1', extensionInstanceId, 'job-1', {
      status: 'PARTIAL',
      reactionCount: 9,
      favoriteCount: 4,
      reason: 'TikTok did not expose every engagement counter',
      claimToken: 'claim-token',
    });

    expect((profileJob as { engagement?: unknown }).engagement).toMatchObject({
      reactionCount: 9,
      commentCount: 7,
      favoriteCount: 4,
      shareCount: 3,
    });
  });

  it('preserves all previous counters when an analytics check fails', async () => {
    const engagement = { reactionCount: 5, commentCount: 7 };
    const { controller, profileJob } = createProfileController({
      claimed: true,
      engagement,
    });

    await controller.updateEngagement(
      'clerk-user-1',
      extensionInstanceId,
      'job-1',
      {
        status: 'CHECK_FAILED',
        reason: 'Background surface was empty',
        claimToken: 'claim-token',
      },
    );

    expect((profileJob as { engagement?: unknown }).engagement).toBe(
      engagement,
    );
    expect(
      (profileJob as { lastEngagementSyncError?: string })
        .lastEngagementSyncError,
    ).toBe('Background surface was empty');
  });

  it('rejects pending-approval sync for profile jobs', async () => {
    const { controller } = createProfileController();

    await expect(
      controller.updatePendingSync('clerk-user-1', extensionInstanceId, 'job-1', {
        status: 'STILL_PENDING',
      }),
    ).rejects.toThrow(
      'Pending-approval sync is only supported for Group jobs',
    );
  });

  it('rejects engagement results without an extension instance', async () => {
    const { controller } = createProfileController();

    await expect(
      controller.updateEngagement('clerk-user-1', undefined, 'job-1', {
        status: 'SUCCESS',
      }),
    ).rejects.toThrow('x-extension-instance-id header is required');
  });

  it('rejects a stale maintenance claim token', async () => {
    const { controller } = createProfileController({ claimed: true });

    await expect(
      controller.updateEngagement('clerk-user-1', extensionInstanceId, 'job-1', {
        status: 'SUCCESS',
        claimToken: 'wrong-token',
      }),
    ).rejects.toThrow('Invalid or expired maintenance claim');
  });

  it('rejects and records an expired maintenance claim', async () => {
    const { controller } = createProfileController({
      claimed: true,
      claimExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(
      controller.updateEngagement('clerk-user-1', extensionInstanceId, 'job-1', {
        status: 'SUCCESS',
        claimToken: 'claim-token',
      }),
    ).rejects.toThrow('Invalid or expired maintenance claim');
  });
});

describe('JobsController platform connection ownership', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const jobConnectionId = { toString: () => 'instagram-connection-job' };
  const installationId = { toString: () => 'installation-1' };

  it('verifies the exact platform connection bound to the job', async () => {
    const profileJob = {
      _id: { toString: () => 'instagram-job-1' },
      platform: PublishingPlatform.INSTAGRAM,
      platformConnectionId: jobConnectionId,
      postId: { clerkUserId },
      submissionStatus: FacebookSubmissionStatus.PUBLISHED,
      postUrl: 'https://www.instagram.com/p/DeOiAoDDRUC/',
      maintenanceClaimedByExtensionInstanceId: extensionInstanceId,
      maintenanceClaimType: MaintenanceClaimType.ENGAGEMENT,
      maintenanceClaimToken: 'claim-token',
      maintenanceClaimExpiresAt: new Date(Date.now() + 60_000),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const platformConnection = {
      _id: jobConnectionId,
      clerkUserId,
      platform: PublishingPlatform.INSTAGRAM,
      activeExtensionInstallationId: installationId,
      status: 'CONNECTED',
      sessionDetected: true,
      externalUsername: 'ema.d1852',
      detectedExternalUsername: 'ema.d1852',
    };
    const findOne = jest.fn((query: Record<string, unknown>) => ({
      exec: jest.fn().mockResolvedValue(
        query._id === jobConnectionId ? platformConnection : null,
      ),
    }));
    const controller = new JobsController(
      {
        findById: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(profileJob),
        }),
      } as never,
      {} as never,
      {} as never,
      {
        verifyWorkerIdentity: jest.fn().mockResolvedValue({
          _id: installationId,
          clerkUserId,
          extensionInstanceId,
          status: 'ACTIVE',
        }),
        assertInstallationActive: jest.fn(),
        // The old implementation used this platform-level lookup. Keep it
        // deliberately different to prove the job-bound lookup is used.
        resolveActivePlatformConnection: jest.fn().mockResolvedValue({
          _id: { toString: () => 'stale-instagram-connection' },
        }),
      } as never,
      { findOne } as never,
    );

    await expect(
      controller.updateEngagement(clerkUserId, extensionInstanceId, 'instagram-job-1', {
        status: 'SUCCESS',
        reactionCount: 0,
        commentCount: 0,
        claimToken: 'claim-token',
      }),
    ).resolves.toBe(profileJob);

    expect(findOne).toHaveBeenCalledWith({
      _id: jobConnectionId,
      clerkUserId,
      platform: PublishingPlatform.INSTAGRAM,
      activeExtensionInstallationId: installationId,
      archivedAt: { $exists: false },
    });
    expect(profileJob.save).toHaveBeenCalled();
  });
});

describe('JobsController maintenance claims', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionObjectId = { toString: () => 'connection-1' };
  const postObjectId = { toString: () => 'post-1' };

  function resultChain<T>(result: T) {
    return {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  function createController(claimedJob: Record<string, unknown> | null) {
    const connection = {
      _id: connectionObjectId,
      extensionInstanceId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    };
    const postModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([{ _id: postObjectId }]),
      }),
    };
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValueOnce(resultChain(claimedJob))
      .mockReturnValueOnce(resultChain(null));
    const jobModel = { findOneAndUpdate };
    const connectionModel = {
      findOne: jest.fn().mockReturnValue(resultChain(connection)),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerk: string, instanceId?: string) => ({
          _id: { toString: () => 'installation-1' },
          clerkUserId,
          extensionInstanceId: instanceId?.trim(),
          status: 'ACTIVE',
        }),
      ),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerk: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return (found as Record<string, unknown> | null) ?? null;
        },
      ),
    };
    return {
      controller: new JobsController(
        jobModel as never,
        postModel as never,
        connectionModel as never,
        extensionsService as never,
      ),
      findOneAndUpdate,
    };
  }

  it('atomically claims pending work and returns the claim token', async () => {
    const claimedJob = {
      _id: { toString: () => 'job-1' },
      postId: { content: 'Pending content', mediaUrls: [] },
      groupId: {
        _id: { toString: () => 'group-1' },
        externalId: 'group-1',
        url: 'https://www.facebook.com/groups/group-1/',
      },
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      maintenanceClaimToken: 'claim-pending',
    };
    const { controller, findOneAndUpdate } = createController(claimedJob);

    const result = await controller.getPendingPosts(
      clerkUserId,
      extensionInstanceId,
      '1',
    );

    expect(result[0]).toMatchObject({ id: 'job-1', claimToken: 'claim-pending' });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      maintenanceClaimedByExtensionInstanceId: extensionInstanceId,
      maintenanceClaimType: MaintenanceClaimType.PENDING_APPROVAL,
    });
    expect(findOneAndUpdate.mock.calls[0][1].$set.maintenanceClaimToken).toEqual(
      expect.any(String),
    );
  });

  it('atomically claims engagement work for the owning connection', async () => {
    const claimedJob = {
      _id: { toString: () => 'job-1' },
      targetType: PublishingTargetType.GROUP,
      postUrl: 'https://www.facebook.com/groups/group-1/posts/1/',
      save: jest.fn().mockResolvedValue(undefined),
      maintenanceClaimToken: 'claim-engagement',
    };
    const { controller, findOneAndUpdate } = createController(claimedJob);

    const result = await controller.getEngagementPendingPosts(
      clerkUserId,
      extensionInstanceId,
      '1',
    );

    expect(result[0]).toMatchObject({
      id: 'job-1',
      status: FacebookSubmissionStatus.PUBLISHED,
      claimToken: 'claim-engagement',
    });
    expect(findOneAndUpdate.mock.calls[0][0].facebookConnectionId).toBe(
      connectionObjectId,
    );
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      maintenanceClaimedByExtensionInstanceId: extensionInstanceId,
      maintenanceClaimType: MaintenanceClaimType.ENGAGEMENT,
    });
  });

  it.each([
    { manualOnly: undefined, excludeTikTok: undefined, includesTikTok: true },
    { manualOnly: undefined, excludeTikTok: 'true', includesTikTok: false },
    { manualOnly: 'true', excludeTikTok: 'true', includesTikTok: true },
  ])(
    'applies TikTok analytics rollout filtering (manualOnly=$manualOnly, excludeTikTok=$excludeTikTok)',
    async ({ manualOnly, excludeTikTok, includesTikTok }) => {
      const installationId = { toString: () => 'installation-1' };
      const tiktokConnectionId = { toString: () => 'tiktok-connection-1' };
      const platformConnectionModel = {
        find: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([{
            _id: tiktokConnectionId,
            platform: PublishingPlatform.TIKTOK,
          }]),
        })),
      };
      const postModel = {
        find: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([{ _id: postObjectId }]),
        })),
      };
      const findOneAndUpdate = jest.fn().mockReturnValue(resultChain(null));
      const controller = new JobsController(
        { findOneAndUpdate } as never,
        postModel as never,
        { findOne: jest.fn().mockReturnValue(resultChain(null)) } as never,
        {
          verifyWorkerIdentity: jest.fn().mockResolvedValue({
            _id: installationId,
            clerkUserId,
            extensionInstanceId,
            status: 'ACTIVE',
          }),
          assertInstallationActive: jest.fn(),
          resolveActiveWorkerConnection: jest.fn().mockResolvedValue(null),
        } as never,
        platformConnectionModel as never,
      );

      await controller.getEngagementPendingPosts(
        clerkUserId,
        extensionInstanceId,
        '1',
        manualOnly,
        excludeTikTok,
      );

      const [claimFilter] = findOneAndUpdate.mock.calls[0];
      expect(claimFilter.$or.some((branch: { platform?: string }) =>
        branch.platform === PublishingPlatform.TIKTOK,
      )).toBe(includesTikTok);
    },
  );
});

describe('JobsController concurrent maintenance lease recovery', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionObjectId = { toString: () => 'connection-1' };
  const postObjectId = { toString: () => 'post-1' };

  function createAtomicController(initialLeaseExpiresAt?: Date) {
    let leaseExpiresAt = initialLeaseExpiresAt;
    let activeClaimToken = initialLeaseExpiresAt ? 'old-claim-token' : undefined;
    const claimedJob = {
      _id: { toString: () => 'job-1' },
      postId: { content: 'Pending content', mediaUrls: [] },
      groupId: {
        _id: { toString: () => 'group-1' },
        externalId: 'group-1',
        url: 'https://www.facebook.com/groups/group-1/',
      },
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const findOneAndUpdate = jest.fn(
      (_query: unknown, update: { $set: Record<string, unknown> }) => ({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn(async () => {
          await Promise.resolve();
          if (leaseExpiresAt && leaseExpiresAt.getTime() > Date.now()) {
            return null;
          }
          leaseExpiresAt = update.$set.maintenanceClaimExpiresAt as Date;
          activeClaimToken = update.$set.maintenanceClaimToken as string;
          return {
            ...claimedJob,
            maintenanceClaimToken: activeClaimToken,
          };
        }),
      }),
    );
    const connection = {
      _id: connectionObjectId,
      extensionInstanceId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    };
    const connectionModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(connection),
      }),
    };
    const postModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([{ _id: postObjectId }]),
      }),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerk: string, instanceId?: string) => ({
          _id: { toString: () => 'installation-1' },
          clerkUserId,
          extensionInstanceId: instanceId?.trim(),
          status: 'ACTIVE',
        }),
      ),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerk: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return (found as Record<string, unknown> | null) ?? null;
        },
      ),
    };
    const controller = new JobsController(
      { findOneAndUpdate } as never,
      postModel as never,
      connectionModel as never,
      extensionsService as never,
    );
    return {
      controller,
      getActiveClaimToken: () => activeClaimToken,
    };
  }

  it('allows only one of two simultaneous requests to claim the same job', async () => {
    const { controller } = createAtomicController();

    const [first, second] = await Promise.all([
      controller.getPendingPosts(clerkUserId, extensionInstanceId, '1'),
      controller.getPendingPosts(clerkUserId, extensionInstanceId, '1'),
    ]);

    expect([...first, ...second]).toHaveLength(1);
    expect([...first, ...second][0]).toMatchObject({ id: 'job-1' });
  });

  it('reclaims a job after its previous maintenance lease expires', async () => {
    const { controller, getActiveClaimToken } = createAtomicController(
      new Date(Date.now() - 1_000),
    );

    const result = await controller.getPendingPosts(
      clerkUserId,
      extensionInstanceId,
      '1',
    );

    expect(result).toHaveLength(1);
    expect(result[0].claimToken).toEqual(expect.any(String));
    expect(getActiveClaimToken()).not.toBe('old-claim-token');
  });
});

describe('JobsController manual maintenance claims', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionObjectId = { toString: () => 'connection-1' };

  function chain<T>(result: T) {
    return {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  function createController(connection: Record<string, unknown> | null) {
    const sourceJob = {
      _id: { toString: () => 'job-1' },
      postId: { clerkUserId },
      facebookConnectionId: connectionObjectId,
      status: PublishingJobStatus.SUCCESS,
      submissionStatus: FacebookSubmissionStatus.PUBLISHED,
      targetType: PublishingTargetType.GROUP,
      postUrl: 'https://www.facebook.com/groups/group-1/posts/1/',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const claimedJob = {
      ...sourceJob,
      postId: { content: 'hello', mediaUrls: [] },
      maintenanceClaimToken: 'claim-token',
    };
    const findOneAndUpdate = jest.fn().mockReturnValue(chain(claimedJob));
    const jobModel = {
      findById: jest.fn().mockReturnValue(chain(sourceJob)),
      findOneAndUpdate,
    };
    const connectionModel = {
      findOne: jest.fn().mockReturnValue(chain(connection)),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerk: string, instanceId?: string) => ({
          _id: { toString: () => 'installation-1' },
          clerkUserId,
          extensionInstanceId: instanceId?.trim(),
          status: 'ACTIVE',
        }),
      ),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerk: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return (found as Record<string, unknown> | null) ?? null;
        },
      ),
    };
    return {
      controller: new JobsController(
        jobModel as never,
        {} as never,
        connectionModel as never,
        extensionsService as never,
      ),
      findOneAndUpdate,
    };
  }

  it('returns authoritative engagement data after an owner claim', async () => {
    const { controller, findOneAndUpdate } = createController({
      _id: connectionObjectId,
      extensionInstanceId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    });

    await expect(
      controller.claimMaintenanceJob(
        clerkUserId,
        extensionInstanceId,
        'job-1',
        { type: MaintenanceClaimType.ENGAGEMENT },
      ),
    ).resolves.toMatchObject({
      id: 'job-1',
      postUrl: 'https://www.facebook.com/groups/group-1/posts/1/',
      claimToken: expect.any(String),
    });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.anything(), facebookConnectionId: connectionObjectId }),
      expect.objectContaining({ $set: expect.objectContaining({
        maintenanceClaimType: MaintenanceClaimType.ENGAGEMENT,
      }) }),
      { new: true },
    );
  });

  it('queues a dashboard maintenance request without an extension header', async () => {
    const { controller } = createController({
      _id: connectionObjectId,
      extensionInstanceId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    });

    await expect(
      controller.requestMaintenance(
        clerkUserId,
        'job-1',
        { type: MaintenanceClaimType.ENGAGEMENT },
      ),
    ).resolves.toMatchObject({
      id: 'job-1',
      type: MaintenanceClaimType.ENGAGEMENT,
      status: 'QUEUED',
      requestedAt: expect.any(String),
    });
  });

  it('rejects a foreign connection before attempting a claim', async () => {
    const { controller, findOneAndUpdate } = createController({
      _id: { toString: () => 'connection-2' },
      extensionInstanceId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-2',
      detectedFacebookUserId: 'facebook-user-2',
    });

    await expect(
      controller.claimMaintenanceJob(
        clerkUserId,
        extensionInstanceId,
        'job-1',
        { type: MaintenanceClaimType.ENGAGEMENT },
      ),
    ).rejects.toThrow('Job is assigned to another Facebook connection');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reports an unverified current extension separately', async () => {
    const { controller, findOneAndUpdate } = createController(null);

    await expect(
      controller.claimMaintenanceJob(
        clerkUserId,
        extensionInstanceId,
        'job-1',
        { type: MaintenanceClaimType.ENGAGEMENT },
      ),
    ).rejects.toThrow(
      'Extension instance is not linked to a verified Facebook connection',
    );
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('JobsController.updateJobStatus lifecycle gating', () => {
  afterEach(() => jest.restoreAllMocks());
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionObjectId = { toString: () => 'connection-1' };
  const postObjectId = { toString: () => 'post-1' };

  function createStatusController(options?: {
    platform?: PublishingPlatform;
    installationStatus?: string;
    claimedBy?: string;
    claimExpiresAt?: Date;
    previousStatus?: string;
    verifyIdentityThrows?: unknown;
    connection?: Record<string, unknown> | null;
  }) {
    const job = {
      _id: { toString: () => 'job-1' },
      platform: options?.platform,
      postId: { clerkUserId, _id: postObjectId },
      facebookConnectionId: connectionObjectId,
      status: options?.previousStatus ?? PublishingJobStatus.RUNNING,
      claimedByExtensionInstanceId: options?.claimedBy ?? extensionInstanceId,
      claimExpiresAt:
        options?.claimExpiresAt ?? new Date(Date.now() + 60_000),
      attempts: 1,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const jobModel = {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(job),
      }),
      find: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          equals: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }),
    };
    const connection =
      options?.connection === undefined
        ? {
            _id: connectionObjectId,
            extensionInstanceId,
            status: 'CONNECTED',
            facebookSessionDetected: true,
            facebookUserId: 'facebook-user-1',
            detectedFacebookUserId: 'facebook-user-1',
          }
        : options.connection;
    const connectionModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(connection),
      }),
      updateOne: jest.fn(),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerk: string, instanceId?: string) => {
          if (options?.verifyIdentityThrows) throw options.verifyIdentityThrows;
          return {
            _id: { toString: () => 'installation-1' },
            clerkUserId,
            extensionInstanceId: instanceId?.trim(),
            status: options?.installationStatus ?? 'ACTIVE',
          };
        },
      ),
      assertInstallationActive: jest.fn(),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerk: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return (found as Record<string, unknown> | null) ?? null;
        },
      ),
    };
    const controller = new JobsController(
      jobModel as never,
      {} as never,
      connectionModel as never,
      extensionsService as never,
    );
    return { controller, job, jobModel, extensionsService };
  }

  it('allows an ACTIVE installation to advance a claimed job to SUCCESS', async () => {
    const { controller, job } = createStatusController();

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.SUCCESS,
      }),
    ).resolves.toBe(job);
    expect(job.save).toHaveBeenCalled();
  });

  it.each([PublishingJobStatus.RUNNING, PublishingJobStatus.PENDING])('blocks disabled TikTok status bypass: %s', async (status) => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(false);
    const { controller, job } = createStatusController({ platform: PublishingPlatform.TIKTOK });
    await expect(controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', { status }))
      .rejects.toThrow('TikTok publishing is disabled for new work');
    expect(job.save).not.toHaveBeenCalled();
  });

  it('allows TikTok terminal reporting after rollback', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(false);
    const { controller, job } = createStatusController({ platform: PublishingPlatform.TIKTOK });
    await expect(controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', { status: PublishingJobStatus.SUCCESS })).resolves.toBe(job);
    expect(job.save).toHaveBeenCalled();
  });

  it('persists TikTok processing as accepted, without marking it published', async () => {
    const { controller, job } = createStatusController({ platform: PublishingPlatform.TIKTOK });
    await controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
      status: PublishingJobStatus.SUCCESS, submissionResult: { status: FacebookSubmissionStatus.PROCESSING, reason: 'Still processing on TikTok' },
    });
    expect(job).toMatchObject({ status: 'SUCCESS', submissionStatus: 'PROCESSING', submissionReason: 'Still processing on TikTok' });
    expect(job).not.toHaveProperty('publishedDetectedAt');
  });

  it('cannot mark TikTok published using an unsupported permalink', async () => {
    const { controller, job } = createStatusController({ platform: PublishingPlatform.TIKTOK });
    await controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
      status: PublishingJobStatus.SUCCESS, submissionResult: { status: FacebookSubmissionStatus.PUBLISHED, postUrl: 'https://www.facebook.com/groups/group/posts/123/' },
    });
    expect(job).toMatchObject({ submissionStatus: 'UNKNOWN' });
    expect((job as any).postUrl).toBeUndefined();
  });

  it('keeps checkpointed TikTok jobs non-retryable after execution is re-enabled', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const { controller, job } = createStatusController({ platform: PublishingPlatform.TIKTOK });
    (job as any).submittedAt = new Date();
    await expect(controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', { status: PublishingJobStatus.PENDING }))
      .rejects.toThrow('cannot be retried automatically');
    expect(job.save).not.toHaveBeenCalled();
  });

  it('rejects a paused installation that holds no valid job lease', async () => {
    const { controller, jobModel } = createStatusController({
      installationStatus: 'PAUSED',
      claimExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.SUCCESS,
      }),
    ).rejects.toThrow('Extension is not active and holds no valid job lease.');
    expect(jobModel.findById).toHaveBeenCalledTimes(1);
  });

  it('allows a paused installation to finish a job claimed before the pause', async () => {
    const { controller, job } = createStatusController({
      installationStatus: 'PAUSED',
    });

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.SUCCESS,
      }),
    ).resolves.toBe(job);
    expect(job.save).toHaveBeenCalled();
  });

  it('forbids a paused installation from pulling a job back into RUNNING', async () => {
    const { controller, job } = createStatusController({
      installationStatus: 'PAUSED',
      previousStatus: PublishingJobStatus.PENDING,
    });

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.RUNNING,
      }),
    ).rejects.toThrow(
      'A paused or disconnecting extension cannot claim new work.',
    );
    expect(job.save).not.toHaveBeenCalled();
  });

  it('allows a REVOKE_PENDING installation to submit a final result under a valid lease', async () => {
    const { controller, job } = createStatusController({
      installationStatus: 'REVOKE_PENDING',
    });

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.FAILED,
      }),
    ).resolves.toBe(job);
    expect(job.save).toHaveBeenCalled();
  });

  it('rejects final results from a revoked installation', async () => {
    const { controller, job } = createStatusController({
      verifyIdentityThrows: new ForbiddenException(
        'Extension installation has been revoked.',
      ),
    });

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.SUCCESS,
      }),
    ).rejects.toThrow('Extension installation has been revoked.');
    expect(job.save).not.toHaveBeenCalled();
  });

  it('rejects a status update from an unverified connection', async () => {
    const { controller, job } = createStatusController({
      connection: null,
    });

    await expect(
      controller.updateJobStatus(clerkUserId, extensionInstanceId, 'job-1', {
        status: PublishingJobStatus.SUCCESS,
      }),
    ).rejects.toThrow(
      'Extension instance is not linked to a verified Facebook connection',
    );
    expect(job.save).not.toHaveBeenCalled();
  });
});

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
    engagement?: { reactionCount?: number; commentCount?: number };
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
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionObjectId = { toString: () => 'connection-1' };
  const postObjectId = { toString: () => 'post-1' };

  function createStatusController(options?: {
    installationStatus?: string;
    claimedBy?: string;
    claimExpiresAt?: Date;
    previousStatus?: string;
    verifyIdentityThrows?: unknown;
    connection?: Record<string, unknown> | null;
  }) {
    const job = {
      _id: { toString: () => 'job-1' },
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

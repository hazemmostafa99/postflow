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

import { JobsController } from './jobs.controller';
import {
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
    };
    const connectionModel = {
      findOne: jest.fn((query: { extensionInstanceId?: string }) =>
        query.extensionInstanceId === connectionExtensionInstanceId
          ? queryChain(connection)
          : queryChain(null)),
      updateOne: jest.fn(),
    };
    const controller = new JobsController(
      jobModel as never,
      postModel as never,
      connectionModel as never,
    );

    return { controller, jobModel, jobChain, connectionModel };
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
});

describe('JobsController target-specific sync guards', () => {
  function createProfileController() {
    const profileJob = {
      targetType: PublishingTargetType.PROFILE_FEED,
      postId: { clerkUserId: 'clerk-user-1' },
      submissionStatus: 'PUBLISHED',
      postUrl: 'https://www.facebook.com/reel/1490054189671164/',
      engagementSyncAttempts: 0,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const jobModel = {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(profileJob),
      }),
    };
    return {
      controller: new JobsController(jobModel as never, {} as never, {} as never),
      profileJob,
    };
  }

  it('persists engagement sync for a published profile job', async () => {
    const { controller, profileJob } = createProfileController();

    await expect(
      controller.updateEngagement('clerk-user-1', undefined, 'job-1', {
        status: 'SUCCESS',
        reactionCount: 1,
        commentCount: 2,
      }),
    ).resolves.toBe(profileJob);
    expect((profileJob as { engagement?: unknown }).engagement).toMatchObject({
      reactionCount: 1,
      commentCount: 2,
    });
    expect(profileJob.save).toHaveBeenCalled();
  });

  it('rejects pending-approval sync for profile jobs', async () => {
    const { controller } = createProfileController();

    await expect(
      controller.updatePendingSync('clerk-user-1', undefined, 'job-1', {
        status: 'STILL_PENDING',
      }),
    ).rejects.toThrow(
      'Pending-approval sync is only supported for Group jobs',
    );
  });
});

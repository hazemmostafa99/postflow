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

import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PublishingTargetType } from '../schemas/publishing-target';
import { UserRole } from '../schemas/user.schema';
import { PostsService } from './posts.service';
import * as tikTokPolicy from './tiktok-publishing-policy';

type InsertedJob = {
  platform?: string;
  targetType: PublishingTargetType;
  groupId?: unknown;
  facebookConnectionId?: unknown;
  platformConnectionId?: unknown;
  scheduledFor?: Date;
};

describe('PostsService.createPost', () => {
  afterEach(() => jest.restoreAllMocks());
  const userId = 'clerk-user-1';
  const postId = '64b000000000000000000010';
  const groupId = '64b000000000000000000001';
  const connectionId = '64b000000000000000000002';

  function createHarness(options?: {
    groups?: Record<string, unknown>[];
    connections?: Record<string, unknown>[];
    platformConnections?: Record<string, unknown>[];
  }) {
    const groups = options?.groups ?? [];
    const connections = options?.connections ?? [];
    const platformConnections = options?.platformConnections ?? [];
    const postDocument = {
      _id: { toString: () => postId },
      toObject: () => ({ clerkUserId: userId, content: 'Hello' }),
    };
    const postModel = {
      create: jest.fn().mockResolvedValue(postDocument),
    };
    const insertedJobs: InsertedJob[][] = [];
    const insertMany = jest.fn((jobs: InsertedJob[]) => {
      insertedJobs.push(jobs);
      return Promise.resolve([]);
    });
    const jobModel = { insertMany };
    const groupModel = {
      find: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(groups),
      }),
    };
    const connectionModel = {
      find: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(connections),
      }),
    };
    const platformConnectionModel = {
      find: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(platformConnections),
      }),
    };
    const service = new PostsService(
      postModel as never,
      jobModel as never,
      groupModel as never,
      connectionModel as never,
      {} as never,
      {} as never,
      platformConnectionModel as never,
    );

    return { service, postModel, jobModel, insertedJobs, platformConnectionModel };
  }

  function verifiedConnection() {
    return {
      _id: { toString: () => connectionId },
      clerkUserId: userId,
      status: 'CONNECTED',
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    };
  }

  function group() {
    return {
      _id: { toString: () => groupId },
      clerkUserId: userId,
      facebookConnectionId: connectionId,
    };
  }

  it('creates a profile job without a group', async () => {
    const connection = verifiedConnection();
    const { service, jobModel, insertedJobs } = createHarness({
      connections: [connection],
    });

    const startedAt = Date.now();
    const result = await service.createPost(userId, {
      content: 'Hello',
      targets: [
        {
          type: PublishingTargetType.PROFILE_FEED,
          facebookConnectionId: connectionId,
        },
      ],
    });
    const finishedAt = Date.now();

    expect(jobModel.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        targetType: PublishingTargetType.PROFILE_FEED,
        facebookConnectionId: connection._id,
        flowOrder: 0,
      }),
    ]);
    const [insertedJob] = insertedJobs[0] ?? [];
    expect(insertedJob).not.toHaveProperty('groupId');
    expect(insertedJob.scheduledFor).toBeInstanceOf(Date);
    expect(insertedJob.scheduledFor!.getTime()).toBeGreaterThanOrEqual(
      startedAt,
    );
    expect(insertedJob.scheduledFor!.getTime()).toBeLessThanOrEqual(finishedAt);
    expect(result.schedule).toEqual([
      expect.objectContaining({
        targetType: PublishingTargetType.PROFILE_FEED,
        targetId: connectionId,
      }),
    ]);
  });

  it('creates a verified Instagram Feed job with one image', async () => {
    const platformConnection = {
      _id: { toString: () => connectionId },
      clerkUserId: userId,
      platform: 'INSTAGRAM',
      status: 'CONNECTED',
      sessionDetected: true,
      externalUsername: 'brand.account',
      detectedExternalUsername: 'brand.account',
    };
    const { service, insertedJobs } = createHarness({
      platformConnections: [platformConnection],
    });

    await service.createPost(userId, {
      content: 'Instagram launch',
      mediaUrls: ['data:image/png;base64,AAAA'],
      targets: [
        {
          type: PublishingTargetType.INSTAGRAM_FEED,
          platformConnectionId: connectionId,
        },
      ],
    });

    expect(insertedJobs[0]).toEqual([
      expect.objectContaining({
        platform: 'INSTAGRAM',
        targetType: PublishingTargetType.INSTAGRAM_FEED,
        platformConnectionId: platformConnection._id,
      }),
    ]);
  });

  it('creates one verified Instagram Feed job for an image carousel', async () => {
    const platformConnection = {
      _id: { toString: () => connectionId },
      clerkUserId: userId,
      platform: 'INSTAGRAM',
      status: 'CONNECTED',
      sessionDetected: true,
      externalUsername: 'brand.account',
      detectedExternalUsername: 'brand.account',
    };
    const { service, insertedJobs } = createHarness({
      platformConnections: [platformConnection],
    });

    await service.createPost(userId, {
      content: 'Carousel launch',
      mediaUrls: [
        'data:image/png;base64,AAAA',
        'data:image/jpeg;base64,BBBB',
        'data:image/png;base64,CCCC',
      ],
      targets: [{
        type: PublishingTargetType.INSTAGRAM_FEED,
        platformConnectionId: connectionId,
      }],
    });

    expect(insertedJobs[0]?.[0]).toEqual(expect.objectContaining({
      platform: 'INSTAGRAM',
      targetType: PublishingTargetType.INSTAGRAM_FEED,
    }));
  });

  it('rejects mixed Instagram Feed media before creating a job', async () => {
    const platformConnection = {
      _id: { toString: () => connectionId },
      clerkUserId: userId,
      platform: 'INSTAGRAM',
      status: 'CONNECTED',
      sessionDetected: true,
      externalUsername: 'brand.account',
      detectedExternalUsername: 'brand.account',
    };
    const { service, insertedJobs } = createHarness({
      platformConnections: [platformConnection],
    });

    await expect(service.createPost(userId, {
      content: 'Mixed media',
      mediaUrls: ['data:image/png;base64,AAAA', 'data:video/mp4;base64,BBBB'],
      targets: [{
        type: PublishingTargetType.INSTAGRAM_FEED,
        platformConnectionId: connectionId,
      }],
    })).rejects.toThrow('Instagram Feed supports images only');
    expect(insertedJobs).toHaveLength(0);
  });

  it('preserves mixed target order and applies random spacing', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const { service, insertedJobs } = createHarness({
      groups: [group()],
      connections: [verifiedConnection()],
    });

    const result = await service.createPost(userId, {
      content: 'Hello',
      targets: [
        {
          type: PublishingTargetType.PROFILE_FEED,
          facebookConnectionId: connectionId,
        },
        { type: PublishingTargetType.GROUP, groupId },
      ],
      startTime: '2026-10-01T10:00:00.000Z',
    });
    random.mockRestore();

    const jobs = insertedJobs[0] ?? [];
    expect(jobs.map((job) => job.targetType)).toEqual([
      PublishingTargetType.PROFILE_FEED,
      PublishingTargetType.GROUP,
    ]);
    expect(jobs.map((job) => job.scheduledFor?.toISOString())).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:00:30.000Z',
    ]);
    expect(result.schedule.map((item) => item.targetId)).toEqual([
      connectionId,
      groupId,
    ]);
  });

  function tikTokConnection(overrides: Record<string, unknown> = {}) {
    return { _id: { toString: () => connectionId }, platform: 'TIKTOK', status: 'CONNECTED', sessionDetected: true,
      externalUsername: 'creator', detectedExternalUsername: 'creator', ...overrides };
  }

  it('blocks disabled TikTok creation before writes', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(false);
    const { service, postModel, jobModel } = createHarness();
    await expect(service.createPost(userId, { content: '', mediaUrls: ['data:video/mp4;base64,AAAA'],
      targets: [{ type: PublishingTargetType.TIKTOK_VIDEO, platformConnectionId: connectionId }] }))
      .rejects.toThrow('TikTok publishing is not available yet');
    expect(postModel.create).not.toHaveBeenCalled();
    expect(jobModel.insertMany).not.toHaveBeenCalled();
  });

  it('creates and schedules a TikTok video job when enabled', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const connection = tikTokConnection();
    const { service, insertedJobs } = createHarness({ platformConnections: [connection] });
    const result = await service.createPost(userId, { content: '', mediaUrls: ['data:video/mp4;base64,AAAA'],
      targets: [{ type: PublishingTargetType.TIKTOK_VIDEO, platformConnectionId: connectionId }], startTime: '2026-10-15T10:00:00Z' });
    expect(insertedJobs[0][0]).toMatchObject({ platform: 'TIKTOK', targetType: 'TIKTOK_VIDEO', platformConnectionId: connection._id,
      scheduledFor: new Date('2026-10-15T10:00:00Z') });
    expect(result.schedule[0].targetType).toBe('TIKTOK_VIDEO');
  });

  it('creates one TikTok photo job for multiple images when enabled', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const connection = tikTokConnection();
    const { service, insertedJobs } = createHarness({ platformConnections: [connection] });
    await service.createPost(userId, { content: 'photos', mediaUrls: [
      'data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA',
    ], targets: [{ type: PublishingTargetType.TIKTOK_PHOTO, platformConnectionId: connectionId }] });
    expect(insertedJobs[0][0]).toMatchObject({ platform: 'TIKTOK', targetType: 'TIKTOK_PHOTO',
      platformConnectionId: connection._id });
  });

  it('rejects mixed TikTok photo media before writes', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const { service, postModel } = createHarness({ platformConnections: [tikTokConnection()] });
    await expect(service.createPost(userId, { content: 'caption', mediaUrls: [
      'data:image/png;base64,AAAA', 'data:video/mp4;base64,AAAA',
    ], targets: [{ type: PublishingTargetType.TIKTOK_PHOTO, platformConnectionId: connectionId }] }))
      .rejects.toThrow('TikTok Photo requires');
    expect(postModel.create).not.toHaveBeenCalled();
  });

  it.each([[], ['data:image/png;base64,AAAA'], ['data:video/mp4;base64,AAAA', 'data:image/png;base64,AAAA']].map((media) => [media]))
    ('rejects incompatible TikTok media before writes: %j', async (mediaUrls) => {
      jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
      const { service, postModel } = createHarness({ platformConnections: [tikTokConnection()] });
      await expect(service.createPost(userId, { content: 'caption', mediaUrls,
        targets: [{ type: PublishingTargetType.TIKTOK_VIDEO, platformConnectionId: connectionId }] })).rejects.toThrow('TikTok Video requires');
      expect(postModel.create).not.toHaveBeenCalled();
    });

  it.each([{ platform: 'INSTAGRAM' }, { detectedExternalUsername: 'wrong.account' }, { status: 'PAUSED' }])
    ('rejects an unverified TikTok destination: %j', async (overrides) => {
      jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
      const { service, postModel } = createHarness({ platformConnections: [tikTokConnection(overrides)] });
      await expect(service.createPost(userId, { content: '', mediaUrls: ['data:video/mp4;base64,AAAA'],
        targets: [{ type: PublishingTargetType.TIKTOK_VIDEO, platformConnectionId: connectionId }] })).rejects.toThrow('verified session');
      expect(postModel.create).not.toHaveBeenCalled();
    });

  it('keeps legacy targetGroupIds compatible', async () => {
    const targetGroup = group();
    const { service, jobModel } = createHarness({ groups: [targetGroup] });

    const result = await service.createPost(userId, {
      content: 'Hello',
      targetGroupIds: [groupId],
    });

    expect(jobModel.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        targetType: PublishingTargetType.GROUP,
        groupId: targetGroup._id,
        flowOrder: 0,
      }),
    ]);
    expect(result.schedule[0]).toEqual(
      expect.objectContaining({
        targetType: PublishingTargetType.GROUP,
        targetId: groupId,
        groupId,
      }),
    );
  });

  it('rejects a connection owned by another user before creating a post', async () => {
    const { service, postModel } = createHarness();

    await expect(
      service.createPost(userId, {
        content: 'Hello',
        targets: [
          {
            type: PublishingTargetType.PROFILE_FEED,
            facebookConnectionId: connectionId,
          },
        ],
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'One or more selected Facebook connections are invalid for this user',
      ),
    );
    expect(postModel.create).not.toHaveBeenCalled();
  });

  it('rejects an unverified connection before creating a post', async () => {
    const connection = {
      ...verifiedConnection(),
      detectedFacebookUserId: 'another-facebook-user',
    };
    const { service, postModel } = createHarness({
      connections: [connection],
    });

    await expect(
      service.createPost(userId, {
        content: 'Hello',
        targets: [
          {
            type: PublishingTargetType.PROFILE_FEED,
            facebookConnectionId: connectionId,
          },
        ],
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Profile feed publishing requires a verified Facebook connection',
      ),
    );
    expect(postModel.create).not.toHaveBeenCalled();
  });
});

describe('PostsService.updatePostSchedule', () => {
  it('rerolls only pending jobs with random 30-second minimum gaps', async () => {
    const postId = '64b000000000000000000010';
    const userId = 'clerk-user-1';
    const post = {
      _id: { toString: () => postId },
      startTime: undefined as Date | undefined,
      spacingMinSeconds: 0,
      spacingMaxSeconds: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toObject: () => ({ _id: postId }),
    };
    const pendingJobs = [0, 1].map((flowOrder) => ({
      _id: { toString: () => `job-${flowOrder}` },
      flowOrder,
      scheduledFor: undefined as Date | undefined,
      save: jest.fn().mockResolvedValue(undefined),
    }));
    const postQuery = {
      exec: jest.fn().mockResolvedValue(post),
    };
    const jobQuery = {
      where: jest.fn().mockReturnThis(),
      equals: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(pendingJobs),
    };
    const jobModel = {
      find: jest.fn().mockReturnValue(jobQuery),
    };
    const service = new PostsService(
      { findOne: jest.fn().mockReturnValue(postQuery) } as never,
      jobModel as never,
      {} as never,
      {} as never,
      {} as never,
      {
        requireActiveUser: jest
          .fn()
          .mockResolvedValue({ role: UserRole.ADMIN }),
      } as never,
    );
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);

    const result = await service.updatePostSchedule(userId, postId, {
      startTime: '2026-10-01T10:00:00.000Z',
    });
    random.mockRestore();

    expect(jobModel.find).toHaveBeenCalledWith({ status: 'PENDING' });
    expect(pendingJobs.map((job) => job.scheduledFor?.toISOString())).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:00:30.000Z',
    ]);
    expect(pendingJobs.every((job) => job.save.mock.calls.length === 1)).toBe(
      true,
    );
    expect(post.spacingMinSeconds).toBe(30);
    expect(post.spacingMaxSeconds).toBe(120);
    expect(result.updatedJobs).toBe(2);
  });
});

describe('PostsService.getPost', () => {
  it('returns profile jobs with their connection populated and no group dependency', async () => {
    const postId = '64b000000000000000000010';
    const connectionId = '64b000000000000000000002';
    const userId = 'clerk-user-1';
    const post = {
      _id: { toString: () => postId },
      clerkUserId: userId,
      content: 'Hello profile',
      mediaUrls: [],
    };
    const profileJob = {
      _id: { toString: () => '64b000000000000000000011' },
      postId: post._id,
      targetType: PublishingTargetType.PROFILE_FEED,
      facebookConnectionId: {
        _id: { toString: () => connectionId },
        displayName: 'Hazem Profile',
        facebookUserId: 'facebook-user-1',
      },
      status: 'SUCCESS',
    };
    const postQuery = {
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(post),
    };
    const jobQuery = {
      where: jest.fn().mockReturnThis(),
      equals: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([profileJob]),
    };
    const userQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const service = new PostsService(
      {
        findOne: jest.fn().mockReturnValue(postQuery),
      } as never,
      {
        find: jest.fn().mockReturnValue(jobQuery),
      } as never,
      {} as never,
      {} as never,
      {
        find: jest.fn().mockReturnValue(userQuery),
      } as never,
      {
        requireActiveUser: jest.fn().mockResolvedValue({ role: UserRole.ADMIN }),
      } as never,
    );

    const result = await service.getPost(userId, postId);

    expect(jobQuery.populate).toHaveBeenCalledWith(
      'groupId',
      'name url externalId',
    );
    expect(jobQuery.populate).toHaveBeenCalledWith(
      'facebookConnectionId',
      'displayName facebookUserId detectedFacebookUserId',
    );
    expect(result.jobs[0]).toEqual(profileJob);
    expect(result.jobs[0].groupId).toBeUndefined();
    expect(result.jobs[0].facebookConnectionId.displayName).toBe('Hazem Profile');
  });
});

describe('PostsService.deletePost', () => {
  it('applies post visibility and deletes the selected post jobs', async () => {
    const clerkUserId = 'clerk-user-1';
    const postId = new Types.ObjectId('64b000000000000000000010');
    const findOneAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: postId }),
    });
    const jobIn = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
    const jobWhere = jest.fn().mockReturnValue({ in: jobIn });
    const service = new PostsService(
      { findOneAndDelete } as never,
      { deleteMany: jest.fn().mockReturnValue({ where: jobWhere }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        requireActiveUser: jest.fn().mockResolvedValue({ role: UserRole.SALES }),
      } as never,
    );

    await service.deletePost(clerkUserId, postId.toString());

    expect(findOneAndDelete).toHaveBeenCalledWith({
      _id: postId.toString(),
      clerkUserId,
    });
    expect(jobWhere).toHaveBeenCalledWith('postId');
    expect(jobIn).toHaveBeenCalledWith([postId]);
  });
});

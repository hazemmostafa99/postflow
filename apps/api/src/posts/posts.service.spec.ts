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

type InsertedJob = {
  targetType: PublishingTargetType;
  groupId?: unknown;
  facebookConnectionId?: unknown;
  scheduledFor?: Date;
};

describe('PostsService.createPost', () => {
  const userId = 'clerk-user-1';
  const postId = '64b000000000000000000010';
  const groupId = '64b000000000000000000001';
  const connectionId = '64b000000000000000000002';

  function createHarness(options?: {
    groups?: Record<string, unknown>[];
    connections?: Record<string, unknown>[];
  }) {
    const groups = options?.groups ?? [];
    const connections = options?.connections ?? [];
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
    const service = new PostsService(
      postModel as never,
      jobModel as never,
      groupModel as never,
      connectionModel as never,
      {} as never,
      {} as never,
    );

    return { service, postModel, jobModel, insertedJobs };
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

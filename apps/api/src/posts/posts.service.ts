import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../schemas/post.schema';
import {
  PublishingJob,
  PublishingJobDocument,
  PublishingJobStatus,
  PublishingTargetType,
} from '../schemas/publishing-job.schema';
import { Group, GroupDocument } from '../schemas/group.schema';
import {
  FacebookConnection,
  FacebookConnectionDocument,
} from '../schemas/facebook-connection.schema';
import {
  PlatformConnection,
  PlatformConnectionDocument,
} from '../schemas/platform-connection.schema';
import { PublishingPlatform } from '../schemas/publishing-platform';
import {
  User,
  UserDocument,
  UserRole,
} from '../schemas/user.schema';
import { AuthorizationService } from '../auth/authorization.service';
import {
  calculatePostSchedule,
  MAX_RANDOM_POST_SPACING_SECONDS,
  MIN_RANDOM_POST_SPACING_SECONDS,
} from './post-flow-time-spacing';
import {
  CreatePostTarget,
  isVerifiedPlatformConnection,
  isVerifiedProfileConnection,
  normalizeCreatePostTargets,
} from './create-post-targets';
import {
  getJobMediaDataUrlMetadata,
  MAX_JOB_IMAGE_BYTES,
  MAX_JOB_MEDIA_BYTES,
} from './job-media-delivery';
import { isTikTokPublishingEnabled } from './tiktok-publishing-policy';

export class CreatePostDto {
  content!: string;
  mediaUrls?: string[];
  targets?: CreatePostTarget[];
  targetGroupIds?: string[];
  startTime?: string;
}

export class UpdatePostScheduleDto {
  startTime?: string | null;
}

export interface ListPostsOptions {
  page?: number;
  limit?: number;
}

type PostControlAction = 'pause' | 'resume' | 'cancel';

type LeanJobSummary = {
  _id: Types.ObjectId;
  postId: Types.ObjectId;
  targetType?: PublishingTargetType;
  groupId?: Types.ObjectId;
  status: string;
  submissionStatus?: string;
  postUrl?: string;
  submissionReason?: string;
  attempts: number;
  error?: string;
  scheduledFor?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

type AggregatedPost = {
  _id: Types.ObjectId;
  clerkUserId: string;
  content: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
  mediaCount: number;
};

type LeanPostWithCreator = {
  _id: Types.ObjectId;
  clerkUserId: string;
};

type PostVisibilityFilter = {
  clerkUserId?: string | { $in: string[] };
};

type ResolvedCreatePostTarget =
  | {
      type: PublishingTargetType.GROUP;
      group: GroupDocument;
      order: number;
    }
  | {
      type: PublishingTargetType.PROFILE_FEED;
      connection: FacebookConnectionDocument;
      order: number;
    }
  | {
      type: PublishingTargetType.INSTAGRAM_FEED | PublishingTargetType.INSTAGRAM_REEL |
        PublishingTargetType.TIKTOK_VIDEO | PublishingTargetType.TIKTOK_PHOTO;
      connection: PlatformConnectionDocument;
      order: number;
    };

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    @InjectModel(FacebookConnection.name)
    private readonly connectionModel: Model<FacebookConnectionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly authorization: AuthorizationService,
    @InjectModel(PlatformConnection.name)
    private readonly platformConnectionModel?: Model<PlatformConnectionDocument>,
  ) {}

  /**
   * Create a post and immediately spawn one PublishingJob per destination.
   */
  async createPost(clerkUserId: string, dto: CreatePostDto) {
    const content = dto.content?.trim() ?? '';
    const mediaUrls = this.validateMediaUrls(dto.mediaUrls);

    if (!content && mediaUrls.length === 0) {
      throw new BadRequestException('Post content or media is required');
    }

    let targets: CreatePostTarget[];
    try {
      targets = normalizeCreatePostTargets(dto.targets, dto.targetGroupIds);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid publishing targets',
      );
    }

    if (targets.some((target) => target.type === PublishingTargetType.TIKTOK_VIDEO ||
      target.type === PublishingTargetType.TIKTOK_PHOTO) && !isTikTokPublishingEnabled()) {
      throw new BadRequestException('TikTok publishing is not available yet');
    }

    const startTime = dto.startTime ? new Date(dto.startTime) : undefined;
    if (dto.startTime && (!startTime || Number.isNaN(startTime.getTime()))) {
      throw new BadRequestException('Start time must be a valid date');
    }

    const groupIds = targets.flatMap((target) =>
      target.type === PublishingTargetType.GROUP ? [target.groupId] : [],
    );
    const connectionIds = targets.flatMap((target) =>
      target.type === PublishingTargetType.PROFILE_FEED
        ? [target.facebookConnectionId]
        : [],
    );
    const platformConnectionIds = [...new Set(targets.flatMap((target) =>
      target.type === PublishingTargetType.INSTAGRAM_FEED ||
      target.type === PublishingTargetType.INSTAGRAM_REEL ||
      target.type === PublishingTargetType.TIKTOK_VIDEO ||
      target.type === PublishingTargetType.TIKTOK_PHOTO
        ? [target.platformConnectionId]
        : [],
    ))];
    const [groups, connections, platformConnections] = await Promise.all([
      groupIds.length
        ? this.groupModel
            .find({
              _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) },
              clerkUserId,
            })
            .exec()
        : [],
      connectionIds.length
        ? this.connectionModel
            .find({
              _id: {
                $in: connectionIds.map((id) => new Types.ObjectId(id)),
              },
              clerkUserId,
            })
            .exec()
        : [],
      platformConnectionIds.length && this.platformConnectionModel
        ? this.platformConnectionModel
            .find({
              _id: {
                $in: platformConnectionIds.map((id) => new Types.ObjectId(id)),
              },
              clerkUserId,
              platform: { $in: [PublishingPlatform.INSTAGRAM, PublishingPlatform.TIKTOK] },
              archivedAt: { $exists: false },
            })
            .exec()
        : [],
    ]);

    if (groups.length !== groupIds.length) {
      throw new BadRequestException(
        'One or more selected groups are invalid for this user',
      );
    }
    if (connections.length !== connectionIds.length) {
      throw new BadRequestException(
        'One or more selected Facebook connections are invalid for this user',
      );
    }

    if (platformConnections.length !== platformConnectionIds.length) {
      throw new BadRequestException(
        'One or more selected platform connections are invalid for this user',
      );
    }

    const groupsById = new Map(
      groups.map((group) => [group._id.toString(), group]),
    );
    const connectionsById = new Map(
      connections.map((connection) => [connection._id.toString(), connection]),
    );
    const platformConnectionsById = new Map(
      platformConnections.map((connection) => [connection._id.toString(), connection]),
    );
    const orderedTargets: ResolvedCreatePostTarget[] = targets.map(
      (target, order) => {
        if (target.type === PublishingTargetType.GROUP) {
          return {
            type: PublishingTargetType.GROUP,
            group: groupsById.get(target.groupId)!,
            order,
          };
        }

        if (target.type === PublishingTargetType.PROFILE_FEED) {
          const connection = connectionsById.get(target.facebookConnectionId)!;
          if (!isVerifiedProfileConnection(connection)) {
            throw new BadRequestException(
              'Profile feed publishing requires a verified Facebook connection',
            );
          }
          return {
            type: PublishingTargetType.PROFILE_FEED,
            connection,
            order,
          };
        }

        const connection = platformConnectionsById.get(target.platformConnectionId)!;
        const platform = target.type === PublishingTargetType.TIKTOK_VIDEO ||
          target.type === PublishingTargetType.TIKTOK_PHOTO ? 'TIKTOK' : 'INSTAGRAM';
        if (!isVerifiedPlatformConnection(connection, platform)) {
          throw new BadRequestException(
            `${platform === 'TIKTOK' ? 'TikTok' : 'Instagram'} publishing requires a connected and verified session`,
          );
        }
        if (target.type === PublishingTargetType.TIKTOK_VIDEO) {
          if (mediaUrls.length !== 1 || !mediaUrls[0].startsWith('data:video/')) {
            throw new BadRequestException('TikTok Video requires exactly one video, 25MB or smaller');
          }
        } else if (target.type === PublishingTargetType.TIKTOK_PHOTO) {
          if (mediaUrls.length < 1 || mediaUrls.length > 4 ||
            mediaUrls.some((url) => !url.startsWith('data:image/'))) {
            throw new BadRequestException('TikTok Photo requires 1 to 4 images, 2MB or smaller each');
          }
        } else {
          this.validateInstagramMedia(target.type, mediaUrls);
        }
        return { type: target.type, connection, order };
      },
    );

    // Create the post
    const post = await this.postModel.create({
      clerkUserId,
      content,
      mediaUrls,
      status: 'PUBLISHING',
      ...(startTime ? { startTime } : {}),
      spacingMinSeconds: MIN_RANDOM_POST_SPACING_SECONDS,
      spacingMaxSeconds: MAX_RANDOM_POST_SPACING_SECONDS,
    });

    const schedule = calculatePostSchedule({
      startTime: startTime ?? new Date(),
      posts: orderedTargets.map((target) => ({
        post: target,
        order: target.order,
      })),
    });

    const scheduledByOrder = new Map(
      schedule.map((item) => [item.order, item.scheduledAt]),
    );
    const jobs = orderedTargets.map((target, flowOrder) => {
      const destination =
        target.type === PublishingTargetType.GROUP
          ? {
              groupId: target.group._id,
              ...(target.group.facebookConnectionId
                ? { facebookConnectionId: target.group.facebookConnectionId }
                : {}),
            }
          : target.type === PublishingTargetType.PROFILE_FEED
            ? { facebookConnectionId: target.connection._id }
            : { platformConnectionId: target.connection._id };
      return {
        postId: post._id,
        platform:
          target.type === PublishingTargetType.GROUP ||
          target.type === PublishingTargetType.PROFILE_FEED
            ? PublishingPlatform.FACEBOOK
            : target.type === PublishingTargetType.TIKTOK_VIDEO ||
              target.type === PublishingTargetType.TIKTOK_PHOTO
              ? PublishingPlatform.TIKTOK
              : PublishingPlatform.INSTAGRAM,
        targetType: target.type,
        ...destination,
        status: PublishingJobStatus.PENDING,
        attempts: 0,
        flowOrder,
        ...(scheduledByOrder.has(target.order)
          ? { scheduledFor: scheduledByOrder.get(target.order) }
          : {}),
      };
    });

    await this.jobModel.insertMany(jobs);

    return {
      post: { ...post.toObject(), _id: post._id.toString() },
      jobsCreated: jobs.length,
      schedule: orderedTargets.map((target, index) => {
        const targetId =
          target.type === PublishingTargetType.GROUP
            ? target.group._id.toString()
            : target.connection._id.toString();
        return {
          targetType: target.type,
          targetId,
          ...(target.type === PublishingTargetType.GROUP
            ? { groupId: targetId }
            : {}),
          ...(jobs[index].scheduledFor
            ? { scheduledFor: jobs[index].scheduledFor }
            : {}),
        };
      }),
    };
  }

  async updatePostSchedule(
    clerkUserId: string,
    postId: string,
    dto: UpdatePostScheduleDto,
  ) {
    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);
    const post = await this.postModel
      .findOne({ _id: postId, ...postVisibilityFilter })
      .exec();
    if (!post) throw new NotFoundException('Post not found');

    const startTime = dto.startTime ? new Date(dto.startTime) : undefined;
    if (dto.startTime && (!startTime || Number.isNaN(startTime.getTime()))) {
      throw new BadRequestException('Start time must be a valid date');
    }

    const pendingJobs = await this.jobModel
      .find({ status: PublishingJobStatus.PENDING })
      .where('postId')
      .equals(post._id)
      .sort({ flowOrder: 1, createdAt: 1, _id: 1 })
      .exec();

    const schedule = calculatePostSchedule({
      startTime: startTime ?? new Date(),
      posts: pendingJobs.map((job, index) => ({
        post: job,
        order: Number.isFinite(job.flowOrder) ? job.flowOrder : index,
      })),
    });

    const scheduledByJobId = new Map(
      schedule.map((item) => [item.post._id.toString(), item.scheduledAt]),
    );
    for (const job of pendingJobs) {
      job.scheduledFor = scheduledByJobId.get(job._id.toString());
      await job.save();
    }

    post.startTime = startTime;
    post.spacingMinSeconds = MIN_RANDOM_POST_SPACING_SECONDS;
    post.spacingMaxSeconds = MAX_RANDOM_POST_SPACING_SECONDS;
    await post.save();

    return {
      post: { ...post.toObject(), _id: post._id.toString() },
      updatedJobs: pendingJobs.length,
      schedule: pendingJobs.map((job) => ({
        jobId: job._id.toString(),
        ...(job.scheduledFor ? { scheduledFor: job.scheduledFor } : {}),
      })),
    };
  }

  private validateMediaUrls(mediaUrls?: string[]) {
    if (!mediaUrls) return [];
    if (!Array.isArray(mediaUrls)) {
      throw new BadRequestException('Media must be an array');
    }
    if (mediaUrls.length > 4) {
      throw new BadRequestException('You can attach up to 4 media files');
    }

    return mediaUrls.map((url) => {
      const media = typeof url === 'string'
        ? getJobMediaDataUrlMetadata(url)
        : null;
      if (!media) {
        throw new BadRequestException(
          'Only image and video attachments are supported',
        );
      }
      const isVideo = media.contentType.startsWith('video/');
      const maxBytes = isVideo ? MAX_JOB_MEDIA_BYTES : MAX_JOB_IMAGE_BYTES;
      if (media.sizeBytes > maxBytes) {
        throw new BadRequestException(
          isVideo
            ? 'Videos must be 25MB or smaller'
            : 'Images must be 2MB or smaller',
        );
      }
      if (
        isVideo &&
        mediaUrls.filter(
          (item) => typeof item === 'string' && item.startsWith('data:video/'),
        ).length > 1
      ) {
        throw new BadRequestException('You can attach one video per post');
      }
      return url;
    });
  }

  private validateInstagramMedia(
    targetType: PublishingTargetType.INSTAGRAM_FEED | PublishingTargetType.INSTAGRAM_REEL,
    mediaUrls: string[],
  ): void {
    const imageCount = mediaUrls.filter((url) => url.startsWith('data:image/')).length;
    const videoCount = mediaUrls.filter((url) => url.startsWith('data:video/')).length;
    if (targetType === PublishingTargetType.INSTAGRAM_REEL) {
      if (mediaUrls.length !== 1 || videoCount !== 1) {
        throw new BadRequestException('Instagram Reel requires exactly one video');
      }
      return;
    }
    if (videoCount > 0) {
      throw new BadRequestException('Instagram Feed supports images only; use one video for a Reel');
    }
    if (imageCount < 1 || imageCount > 4 || imageCount !== mediaUrls.length) {
      throw new BadRequestException('Instagram Feed requires one to four images');
    }
  }

  /**
   * List all posts for the user, newest first, with job counts.
   */
  async getPosts(clerkUserId: string) {
    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);
    const posts = await this.postModel
      .find(postVisibilityFilter)
      .select('-mediaUrls')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // Attach job summary to each post
    const postIds = posts.map((p) => p._id);
    const jobs = (await this.jobModel
      .find()
      .where('postId')
      .in(postIds)
      .lean()
      .exec()) as unknown as LeanJobSummary[];

    const jobsByPost = jobs.reduce<Record<string, LeanJobSummary[]>>(
      (acc, job) => {
        const key = job.postId.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(job);
        return acc;
      },
      {},
    );

    const postsWithCreators = await this.attachCreators(posts);

    return postsWithCreators.map((post) => ({
      ...post,
      _id: post._id.toString(),
      jobs: jobsByPost[post._id.toString()] ?? [],
    }));
  }

  async listPosts(clerkUserId: string, options: ListPostsOptions) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 10));
    const skip = (page - 1) * limit;
    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);

    const [rawPosts, total] = await Promise.all([
      this.postModel
        .aggregate([
          { $match: postVisibilityFilter },
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              content: 1,
              clerkUserId: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              mediaCount: { $size: { $ifNull: ['$mediaUrls', []] } },
            },
          },
        ])
        .exec(),
      this.postModel.countDocuments(postVisibilityFilter),
    ]);
    const posts = rawPosts as unknown as AggregatedPost[];

    const postIds = posts.map((p) => p._id);
    const jobs = (await this.jobModel
      .find()
      .where('postId')
      .in(postIds)
      .lean()
      .exec()) as unknown as LeanJobSummary[];

    const jobsByPost = jobs.reduce<Record<string, LeanJobSummary[]>>(
      (acc, job) => {
        const key = job.postId.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(job);
        return acc;
      },
      {},
    );

    const postsWithCreators = await this.attachCreators(posts);

    return {
      posts: postsWithCreators.map((post) => ({
        ...post,
        _id: post._id.toString(),
        jobs: jobsByPost[post._id.toString()] ?? [],
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Get a single post with its jobs.
   */
  async getPost(clerkUserId: string, postId: string) {
    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);
    const post = await this.postModel
      .findOne({ _id: postId, ...postVisibilityFilter })
      .lean()
      .exec();

    if (!post) throw new NotFoundException('Post not found');

    const jobs = await this.jobModel
      .find()
      .where('postId')
      .equals(post._id)
      .populate('groupId', 'name url externalId')
      .populate(
        'facebookConnectionId',
        'displayName facebookUserId detectedFacebookUserId',
      )
      .lean()
      .exec();

    const [postWithCreator] = await this.attachCreators([post]);

    return {
      ...postWithCreator,
      _id: post._id.toString(),
      jobs,
    };
  }

  async pausePost(clerkUserId: string, postId: string) {
    return this.applyPostControl(clerkUserId, postId, 'pause');
  }

  async resumePost(clerkUserId: string, postId: string) {
    return this.applyPostControl(clerkUserId, postId, 'resume');
  }

  async cancelPost(clerkUserId: string, postId: string) {
    return this.applyPostControl(clerkUserId, postId, 'cancel');
  }

  private async applyPostControl(
    clerkUserId: string,
    postId: string,
    action: PostControlAction,
  ) {
    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);
    const post = await this.postModel
      .findOne({ _id: postId, ...postVisibilityFilter })
      .exec();
    if (!post) throw new NotFoundException('Post not found');
    const postRef = post._id as unknown as Post;

    let updatedJobs = 0;
    if (action === 'pause') {
      const result = await this.jobModel
        .updateMany(
          { postId: postRef, status: PublishingJobStatus.PENDING },
          { $set: { status: PublishingJobStatus.PAUSED } },
        )
        .exec();
      updatedJobs = result.modifiedCount ?? 0;
    } else if (action === 'resume') {
      const result = await this.jobModel
        .updateMany(
          { postId: postRef, status: PublishingJobStatus.PAUSED },
          { $set: { status: PublishingJobStatus.PENDING } },
        )
        .exec();
      updatedJobs = result.modifiedCount ?? 0;
    } else {
      const [queuedResult, runningResult] = await Promise.all([
        this.jobModel
          .updateMany(
            {
              postId: postRef,
              status: {
                $in: [
                  PublishingJobStatus.PENDING,
                  PublishingJobStatus.PAUSED,
                ],
              },
            },
            {
              $set: {
                status: PublishingJobStatus.CANCELED,
                completedAt: new Date(),
              },
              $unset: {
                claimedByExtensionInstanceId: 1,
                claimExpiresAt: 1,
                mediaAccessTokenHash: 1,
                mediaAccessExpiresAt: 1,
              },
            },
          )
          .exec(),
        this.jobModel
          .updateMany(
            { postId: postRef, status: PublishingJobStatus.RUNNING },
            {
              $set: { status: PublishingJobStatus.CANCEL_REQUESTED },
              $unset: {
                mediaAccessTokenHash: 1,
                mediaAccessExpiresAt: 1,
              },
            },
          )
          .exec(),
      ]);
      updatedJobs =
        (queuedResult.modifiedCount ?? 0) + (runningResult.modifiedCount ?? 0);
    }

    await this.updateParentPostStatus(post);

    return {
      post: { ...post.toObject(), _id: post._id.toString() },
      action,
      updatedJobs,
    };
  }

  async deleteAllPosts(clerkUserId: string) {
    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);
    const posts = await this.postModel
      .find(postVisibilityFilter)
      .select('_id')
      .lean()
      .exec();
    const postIds = posts.map((post) => post._id);
    if (postIds.length) {
      await this.jobModel.deleteMany().where('postId').in(postIds).exec();
    }
    await this.postModel.deleteMany(postVisibilityFilter).exec();
  }

  async deletePost(clerkUserId: string, postId: string) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new NotFoundException('Post not found');
    }

    const postVisibilityFilter =
      await this.getPostVisibilityFilter(clerkUserId);
    const post = await this.postModel
      .findOneAndDelete({ _id: postId, ...postVisibilityFilter })
      .exec();
    if (!post) throw new NotFoundException('Post not found');

    await this.jobModel
      .deleteMany()
      .where('postId')
      .in([post._id])
      .exec();
  }

  private async getPostVisibilityFilter(
    clerkUserId: string,
  ): Promise<PostVisibilityFilter> {
    const user = await this.authorization.requireActiveUser(clerkUserId);

    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return {};
    }

    if (user.role === UserRole.TEAM_LEADER) {
      if (!user.teamId) return { clerkUserId: { $in: [] } };
      const teamMembers = await this.userModel
        .find({ teamId: user.teamId })
        .select('clerkUserId')
        .lean()
        .exec();
      return {
        clerkUserId: {
          $in: teamMembers.map((member) => member.clerkUserId),
        },
      };
    }

    return { clerkUserId };
  }

  private async attachCreators<TPost extends LeanPostWithCreator>(
    posts: TPost[],
  ) {
    const creatorClerkIds = [
      ...new Set(posts.map((post) => post.clerkUserId).filter(Boolean)),
    ];
    const creators = creatorClerkIds.length
      ? await this.userModel
          .find({ clerkUserId: { $in: creatorClerkIds } })
          .select('clerkUserId email firstName lastName role status teamId')
          .lean()
          .exec()
      : [];
    const creatorsByClerkId = new Map(
      creators.map((creator) => [creator.clerkUserId, creator]),
    );

    return posts.map((post) => {
      const creator = creatorsByClerkId.get(post.clerkUserId);
      return {
        ...post,
        createdBy: {
          clerkUserId: post.clerkUserId,
          ...(creator
            ? {
                userId: creator._id.toString(),
                firstName: creator.firstName,
                lastName: creator.lastName,
                fullName: getFullName(creator.firstName, creator.lastName),
                email: creator.email,
                role: creator.role,
                status: creator.status,
                teamId: creator.teamId ?? null,
              }
            : {}),
        },
      };
    });
  }

  private async updateParentPostStatus(post: PostDocument) {
    const jobs = await this.jobModel
      .find()
      .where('postId')
      .equals(post._id)
      .select('status')
      .lean()
      .exec();

    if (!jobs.length) return;

    const allSucceeded = jobs.every(
      (job) => job.status === PublishingJobStatus.SUCCESS,
    );
    const anyFailed = jobs.some(
      (job) => job.status === PublishingJobStatus.FAILED,
    );
    const allFinished = jobs.every((job) =>
      [
        PublishingJobStatus.SUCCESS,
        PublishingJobStatus.FAILED,
        PublishingJobStatus.CANCELED,
      ].includes(job.status as PublishingJobStatus),
    );
    const allCanceled = jobs.every(
      (job) => job.status === PublishingJobStatus.CANCELED,
    );
    const anyCanceled = jobs.some(
      (job) => job.status === PublishingJobStatus.CANCELED,
    );
    const anyPaused = jobs.some(
      (job) => job.status === PublishingJobStatus.PAUSED,
    );
    const anyCancelRequested = jobs.some(
      (job) => job.status === PublishingJobStatus.CANCEL_REQUESTED,
    );

    if (allSucceeded) {
      post.status = 'COMPLETED';
    } else if (allCanceled) {
      post.status = 'CANCELED';
    } else if (allFinished && anyFailed) {
      post.status = 'PARTIAL_FAILURE';
    } else if (allFinished && anyCanceled) {
      post.status = 'CANCELED';
    } else if (anyPaused && !anyCancelRequested) {
      post.status = 'PAUSED';
    } else {
      post.status = 'PUBLISHING';
    }

    await post.save();
  }
}

function getFullName(firstName?: string, lastName?: string) {
  const fullName = [firstName, lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || undefined;
}

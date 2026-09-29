import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../schemas/post.schema';
import {
  FacebookSubmissionStatus,
  PublishingJob,
  PublishingJobDocument,
  PublishingJobStatus,
} from '../schemas/publishing-job.schema';
import { User, UserDocument } from '../schemas/user.schema';

export interface AnalyticsListPostsOptions {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
}

type LeanPost = {
  _id: Types.ObjectId;
  clerkUserId: string;
  content: string;
  mediaUrls?: string[];
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
};

type LeanUser = {
  _id: Types.ObjectId;
  clerkUserId: string;
  email?: string;
  role?: string;
  status?: string;
  teamId?: string | null;
};

type LeanGroup = {
  _id: Types.ObjectId;
  name?: string;
  url?: string;
  externalId?: string;
};

type LeanJob = {
  _id: Types.ObjectId;
  postId: Types.ObjectId | { _id: Types.ObjectId };
  groupId?: Types.ObjectId | LeanGroup;
  status: string;
  error?: string;
  submissionStatus?: FacebookSubmissionStatus;
  postUrl?: string;
  submittedAt?: Date;
  publishedDetectedAt?: Date;
  scheduledFor?: Date;
  startedAt?: Date;
  completedAt?: Date;
  engagement?: {
    reactionCount?: number;
    commentCount?: number;
    lastSyncedAt?: Date;
  };
};

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async listPosts(options: AnalyticsListPostsOptions) {
    const page = Math.max(1, safeInteger(options.page, 1));
    const limit = Math.min(500, Math.max(1, safeInteger(options.limit, 100)));
    const skip = (page - 1) * limit;
    const filter = this.buildPostFilter(options);

    const [posts, total] = await Promise.all([
      this.postModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<LeanPost[]>()
        .exec(),
      this.postModel.countDocuments(filter),
    ]);

    return {
      posts: await this.serializePosts(posts),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getPost(postId: string) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new NotFoundException('Post not found');
    }

    const post = await this.postModel
      .findById(postId)
      .lean<LeanPost | null>()
      .exec();
    if (!post) throw new NotFoundException('Post not found');

    const [serialized] = await this.serializePosts([post]);
    return serialized;
  }

  private buildPostFilter(options: AnalyticsListPostsOptions) {
    const filter: Record<string, unknown> = {};
    const createdAt: Record<string, Date> = {};

    if (options.from) {
      createdAt.$gte = parseDateFilter(options.from, 'from');
    }
    if (options.to) {
      createdAt.$lte = parseDateFilter(options.to, 'to');
    }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;

    const status = options.status?.trim();
    if (status) filter.status = status;

    return filter;
  }

  private async serializePosts(posts: LeanPost[]) {
    if (!posts.length) return [];

    const postIds = posts.map((post) => post._id);
    const clerkUserIds = Array.from(
      new Set(posts.map((post) => post.clerkUserId)),
    );

    const [users, jobs] = await Promise.all([
      this.userModel
        .find({ clerkUserId: { $in: clerkUserIds } })
        .select('clerkUserId email role status teamId')
        .lean<LeanUser[]>()
        .exec(),
      this.jobModel
        .find()
        .where('postId')
        .in(postIds)
        .populate<{ groupId?: LeanGroup }>('groupId', 'name url externalId')
        .lean<LeanJob[]>()
        .exec(),
    ]);

    const usersByClerkId = new Map(
      users.map((user) => [user.clerkUserId, user]),
    );
    const jobsByPostId = jobs.reduce<Record<string, LeanJob[]>>((acc, job) => {
      const postId = getObjectIdString(job.postId);
      if (!acc[postId]) acc[postId] = [];
      acc[postId].push(job);
      return acc;
    }, {});

    return posts.map((post) =>
      this.serializePost(
        post,
        usersByClerkId.get(post.clerkUserId),
        jobsByPostId[post._id.toString()] ?? [],
      ),
    );
  }

  private serializePost(
    post: LeanPost,
    user: LeanUser | undefined,
    jobs: LeanJob[],
  ) {
    const targets = jobs.map((job) => serializeTarget(job));
    const reactionCount = jobs.reduce(
      (total, job) => total + (job.engagement?.reactionCount ?? 0),
      0,
    );
    const commentCount = jobs.reduce(
      (total, job) => total + (job.engagement?.commentCount ?? 0),
      0,
    );
    const lastSyncedAt = newestDate(
      jobs.flatMap((job) =>
        job.engagement?.lastSyncedAt ? [job.engagement.lastSyncedAt] : [],
      ),
    );

    return {
      id: post._id.toString(),
      content: post.content,
      mediaCount: Array.isArray(post.mediaUrls) ? post.mediaUrls.length : 0,
      status: post.status,
      ...(post.createdAt ? { createdAt: post.createdAt.toISOString() } : {}),
      ...(post.updatedAt ? { updatedAt: post.updatedAt.toISOString() } : {}),
      createdBy: {
        clerkUserId: post.clerkUserId,
        ...(user
          ? {
              userId: user._id.toString(),
              ...(user.email ? { email: user.email } : {}),
              ...(user.role ? { role: user.role } : {}),
              ...(user.status ? { status: user.status } : {}),
              ...(user.teamId !== undefined ? { teamId: user.teamId } : {}),
            }
          : {}),
      },
      totals: {
        targetCount: jobs.length,
        pendingCount: countJobs(jobs, PublishingJobStatus.PENDING),
        runningCount: countJobs(jobs, PublishingJobStatus.RUNNING),
        successCount: countJobs(jobs, PublishingJobStatus.SUCCESS),
        failedCount: countJobs(jobs, PublishingJobStatus.FAILED),
        canceledCount: jobs.filter((job) =>
          [
            PublishingJobStatus.CANCELED,
            PublishingJobStatus.CANCEL_REQUESTED,
          ].includes(job.status as PublishingJobStatus),
        ).length,
        publishedCount: countSubmissions(
          jobs,
          FacebookSubmissionStatus.PUBLISHED,
        ),
        pendingApprovalCount: countSubmissions(
          jobs,
          FacebookSubmissionStatus.PENDING_APPROVAL,
        ),
        unknownSubmissionCount: countSubmissions(
          jobs,
          FacebookSubmissionStatus.UNKNOWN,
        ),
        reactionCount,
        commentCount,
      },
      engagement: {
        reactionCount,
        commentCount,
        ...(lastSyncedAt ? { lastSyncedAt: lastSyncedAt.toISOString() } : {}),
      },
      targets,
    };
  }
}

function safeInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.floor(value as number) : fallback;
}

function parseDateFilter(value: string, name: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${name} must be a valid date`);
  }
  return date;
}

function getObjectIdString(value: Types.ObjectId | { _id: Types.ObjectId }) {
  return value instanceof Types.ObjectId
    ? value.toString()
    : value._id.toString();
}

function isPopulatedGroup(value: unknown): value is LeanGroup {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '_id' in value &&
    !(value instanceof Types.ObjectId),
  );
}

function serializeTarget(job: LeanJob) {
  const group = isPopulatedGroup(job.groupId) ? job.groupId : undefined;
  const engagement =
    job.engagement &&
    (job.engagement.reactionCount !== undefined ||
      job.engagement.commentCount !== undefined ||
      job.engagement.lastSyncedAt)
      ? {
          ...(job.engagement.reactionCount !== undefined
            ? { reactionCount: job.engagement.reactionCount }
            : {}),
          ...(job.engagement.commentCount !== undefined
            ? { commentCount: job.engagement.commentCount }
            : {}),
          ...(job.engagement.lastSyncedAt
            ? { lastSyncedAt: job.engagement.lastSyncedAt.toISOString() }
            : {}),
        }
      : undefined;

  return {
    jobId: job._id.toString(),
    ...(group
      ? {
          groupId: group._id.toString(),
          ...(group.name ? { groupName: group.name } : {}),
          ...(group.url ? { groupUrl: group.url } : {}),
          ...(group.externalId ? { groupExternalId: group.externalId } : {}),
        }
      : {}),
    status: job.status,
    ...(job.submissionStatus ? { submissionStatus: job.submissionStatus } : {}),
    ...(job.postUrl ? { postUrl: job.postUrl } : {}),
    ...(job.submittedAt ? { submittedAt: job.submittedAt.toISOString() } : {}),
    ...(job.publishedDetectedAt
      ? { publishedDetectedAt: job.publishedDetectedAt.toISOString() }
      : {}),
    ...(job.scheduledFor
      ? { scheduledFor: job.scheduledFor.toISOString() }
      : {}),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(engagement ? { engagement } : {}),
  };
}

function newestDate(dates: Date[]) {
  return dates.reduce<Date | undefined>((newest, date) => {
    if (!newest || date.getTime() > newest.getTime()) return date;
    return newest;
  }, undefined);
}

function countJobs(jobs: LeanJob[], status: PublishingJobStatus) {
  return jobs.filter((job) => job.status === status).length;
}

function countSubmissions(jobs: LeanJob[], status: FacebookSubmissionStatus) {
  return jobs.filter((job) => job.submissionStatus === status).length;
}

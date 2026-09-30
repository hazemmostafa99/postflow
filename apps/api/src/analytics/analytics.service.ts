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
import { Team, TeamDocument } from '../schemas/team.schema';

export interface AnalyticsListPostsOptions {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
  userId?: string;
  teamId?: string;
  role?: string;
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
  firstName?: string;
  lastName?: string;
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

type LeanTeam = {
  _id: Types.ObjectId;
  name: string;
  managerId?: string | null;
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

type AnalyticsPostFilter = Record<string, unknown>;

type MetricBucket = {
  posts: number;
  targets: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  canceled: number;
  published: number;
  pendingApproval: number;
  unknownSubmission: number;
  reactions: number;
  comments: number;
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
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
  ) {}

  async listPosts(options: AnalyticsListPostsOptions) {
    const page = Math.max(1, safeInteger(options.page, 1));
    const limit = Math.min(500, Math.max(1, safeInteger(options.limit, 100)));
    const skip = (page - 1) * limit;
    const filter = await this.buildPostFilter(options);

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

  async summary(options: AnalyticsListPostsOptions) {
    const filter = await this.buildPostFilter(options);
    const posts = await this.postModel
      .find(filter)
      .select('_id clerkUserId status createdAt updatedAt')
      .lean<LeanPost[]>()
      .exec();
    const { usersByClerkId, teamsById, jobsByPostId } =
      await this.getPostRelations(posts);
    const totals = createMetricBucket();
    const byStatus: Record<string, number> = {};
    const creatorBuckets = new Map<
      string,
      {
        user?: LeanUser;
        metrics: MetricBucket;
      }
    >();
    const teamBuckets = new Map<
      string,
      {
        teamId: string | null;
        team?: LeanTeam;
        metrics: MetricBucket;
      }
    >();

    for (const post of posts) {
      const jobs = jobsByPostId[post._id.toString()] ?? [];
      const user = usersByClerkId.get(post.clerkUserId);
      byStatus[post.status] = (byStatus[post.status] ?? 0) + 1;
      addPostMetrics(totals, jobs);

      const creatorKey = user?._id.toString() ?? 'unknown';
      const creatorBucket =
        creatorBuckets.get(creatorKey) ??
        {
          user,
          metrics: createMetricBucket(),
        };
      addPostMetrics(creatorBucket.metrics, jobs);
      creatorBuckets.set(creatorKey, creatorBucket);

      const teamId = user?.teamId ?? null;
      const teamKey = teamId ?? 'unassigned';
      const teamBucket =
        teamBuckets.get(teamKey) ??
        {
          teamId,
          team: teamId ? teamsById.get(teamId) : undefined,
          metrics: createMetricBucket(),
        };
      addPostMetrics(teamBucket.metrics, jobs);
      teamBuckets.set(teamKey, teamBucket);
    }

    return {
      filters: normalizeFilters(options),
      totals,
      byStatus,
      byCreator: Array.from(creatorBuckets.values()).map((bucket) => ({
        ...(bucket.user
          ? {
              id: bucket.user._id.toString(),
              ...(bucket.user.firstName
                ? { firstName: bucket.user.firstName }
                : {}),
              ...(bucket.user.lastName ? { lastName: bucket.user.lastName } : {}),
              ...(getFullName(bucket.user.firstName, bucket.user.lastName)
                ? {
                    fullName: getFullName(
                      bucket.user.firstName,
                      bucket.user.lastName,
                    ),
                  }
                : {}),
              ...(bucket.user.email ? { email: bucket.user.email } : {}),
              ...(bucket.user.role ? { role: bucket.user.role } : {}),
              ...(bucket.user.status ? { status: bucket.user.status } : {}),
              ...(bucket.user.teamId !== undefined
                ? { teamId: bucket.user.teamId }
                : {}),
              ...(bucket.user.teamId && teamsById.has(bucket.user.teamId)
                ? { team: serializeTeam(teamsById.get(bucket.user.teamId)!) }
                : {}),
            }
          : { id: null, name: 'Unknown user', creatorMissing: true }),
        ...bucket.metrics,
      })),
      byTeam: Array.from(teamBuckets.values()).map((bucket) => ({
        teamId: bucket.teamId,
        ...(bucket.team
          ? { team: serializeTeam(bucket.team), teamName: bucket.team.name }
          : { teamName: bucket.teamId ? undefined : 'Unassigned' }),
        ...bucket.metrics,
      })),
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

  async listUsers() {
    const users = await this.userModel
      .find()
      .select('email firstName lastName role status teamId')
      .sort({ firstName: 1, lastName: 1, email: 1, _id: 1 })
      .lean<LeanUser[]>()
      .exec();
    const teamIds = Array.from(
      new Set(
        users
          .map((user) => user.teamId)
          .filter((teamId): teamId is string => Boolean(teamId)),
      ),
    );
    const teams = teamIds.length
      ? await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('name managerId')
          .lean<LeanTeam[]>()
          .exec()
      : [];
    const teamsById = new Map(teams.map((team) => [team._id.toString(), team]));

    return {
      users: users.map((user) => serializeUser(user, teamsById)),
    };
  }

  async listTeams() {
    const [teams, users] = await Promise.all([
      this.teamModel
        .find()
        .select('name managerId')
        .sort({ name: 1, _id: 1 })
        .lean<LeanTeam[]>()
        .exec(),
      this.userModel
        .find()
        .select('email firstName lastName role status teamId')
        .lean<LeanUser[]>()
        .exec(),
    ]);
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    return {
      teams: teams.map((team) => {
        const teamId = team._id.toString();
        const members = users.filter((user) => user.teamId === teamId);
        const manager = team.managerId ? usersById.get(team.managerId) : undefined;
        const teamLeader = members.find((user) => user.role === 'TEAM_LEADER');
        return {
          ...serializeTeam(team),
          ...(manager ? { manager: serializeUserSummary(manager) } : {}),
          memberCount: members.length,
          salesCount: members.filter((user) => user.role === 'SALES').length,
          ...(teamLeader
            ? { teamLeader: serializeUserSummary(teamLeader) }
            : {}),
        };
      }),
    };
  }

  private async buildPostFilter(
    options: AnalyticsListPostsOptions,
  ): Promise<AnalyticsPostFilter> {
    const filter: AnalyticsPostFilter = {};
    const createdAt: Record<string, Date> = {};

    if (options.from) {
      createdAt.$gte = parseDateFilter(options.from, 'from', 'start');
    }
    if (options.to) {
      createdAt.$lte = parseDateFilter(options.to, 'to', 'end');
    }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;

    const status = options.status?.trim();
    if (status) filter.status = status;

    const clerkUserIds = await this.resolveCreatorClerkUserIds(options);
    if (clerkUserIds) filter.clerkUserId = { $in: clerkUserIds };

    return filter;
  }

  private async resolveCreatorClerkUserIds(
    options: AnalyticsListPostsOptions,
  ): Promise<string[] | undefined> {
    const userId = options.userId?.trim();
    const teamId = options.teamId?.trim();
    const role = options.role?.trim();

    if (!userId && !teamId && !role) return undefined;

    const userFilter: Record<string, unknown> = {};
    if (userId) {
      if (!Types.ObjectId.isValid(userId)) return [];
      userFilter._id = userId;
    }
    if (teamId) {
      if (!Types.ObjectId.isValid(teamId)) return [];
      userFilter.teamId = teamId;
    }
    if (role) userFilter.role = role;

    const users = await this.userModel
      .find(userFilter)
      .select('clerkUserId')
      .lean<Pick<LeanUser, 'clerkUserId'>[]>()
      .exec();

    return users.map((user) => user.clerkUserId);
  }

  private async serializePosts(posts: LeanPost[]) {
    if (!posts.length) return [];

    const { usersByClerkId, teamsById, jobsByPostId } =
      await this.getPostRelations(posts);

    return posts.map((post) =>
      this.serializePost(
        post,
        usersByClerkId.get(post.clerkUserId),
        teamsById,
        jobsByPostId[post._id.toString()] ?? [],
      ),
    );
  }

  private async getPostRelations(posts: LeanPost[]) {
    const postIds = posts.map((post) => post._id);
    const clerkUserIds = Array.from(
      new Set(posts.map((post) => post.clerkUserId)),
    );

    const [users, jobs] = await Promise.all([
      this.userModel
        .find({ clerkUserId: { $in: clerkUserIds } })
        .select('clerkUserId email firstName lastName role status teamId')
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
    const teamIds = Array.from(
      new Set(
        users
          .map((user) => user.teamId)
          .filter((teamId): teamId is string => Boolean(teamId)),
      ),
    );
    const teams = teamIds.length
      ? await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('name managerId')
          .lean<LeanTeam[]>()
          .exec()
      : [];

    return {
      usersByClerkId: new Map(users.map((user) => [user.clerkUserId, user])),
      teamsById: new Map(teams.map((team) => [team._id.toString(), team])),
      jobsByPostId: jobs.reduce<Record<string, LeanJob[]>>((acc, job) => {
        const postId = getObjectIdString(job.postId);
        if (!acc[postId]) acc[postId] = [];
        acc[postId].push(job);
        return acc;
      }, {}),
    };
  }

  private serializePost(
    post: LeanPost,
    user: LeanUser | undefined,
    teamsById: Map<string, LeanTeam>,
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
      createdBy: user
        ? {
            id: user._id.toString(),
            ...(user.firstName ? { firstName: user.firstName } : {}),
            ...(user.lastName ? { lastName: user.lastName } : {}),
            ...(getFullName(user.firstName, user.lastName)
              ? { fullName: getFullName(user.firstName, user.lastName) }
              : {}),
            ...(user.email ? { email: user.email } : {}),
            ...(user.role ? { role: user.role } : {}),
            ...(user.status ? { status: user.status } : {}),
            ...(user.teamId !== undefined ? { teamId: user.teamId } : {}),
            ...(user.teamId && teamsById.has(user.teamId)
              ? { team: serializeTeam(teamsById.get(user.teamId)!) }
              : {}),
          }
        : null,
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

function parseDateFilter(
  value: string,
  name: string,
  dateOnlyBoundary: 'start' | 'end',
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${name} must be a valid date`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (dateOnlyBoundary === 'end') {
      date.setUTCHours(23, 59, 59, 999);
    } else {
      date.setUTCHours(0, 0, 0, 0);
    }
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

function serializeTeam(team: LeanTeam) {
  return {
    id: team._id.toString(),
    name: team.name,
    ...(team.managerId ? { managerId: team.managerId } : {}),
  };
}

function serializeUser(user: LeanUser, teamsById: Map<string, LeanTeam>) {
  return {
    ...serializeUserSummary(user),
    ...(user.role ? { role: user.role } : {}),
    ...(user.status ? { status: user.status } : {}),
    ...(user.teamId !== undefined ? { teamId: user.teamId } : {}),
    ...(user.teamId && teamsById.has(user.teamId)
      ? { team: serializeTeam(teamsById.get(user.teamId)!) }
      : {}),
  };
}

function serializeUserSummary(user: LeanUser) {
  return {
    id: user._id.toString(),
    ...(user.firstName ? { firstName: user.firstName } : {}),
    ...(user.lastName ? { lastName: user.lastName } : {}),
    ...(getFullName(user.firstName, user.lastName)
      ? { fullName: getFullName(user.firstName, user.lastName) }
      : {}),
    ...(user.email ? { email: user.email } : {}),
  };
}

function createMetricBucket(): MetricBucket {
  return {
    posts: 0,
    targets: 0,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    canceled: 0,
    published: 0,
    pendingApproval: 0,
    unknownSubmission: 0,
    reactions: 0,
    comments: 0,
  };
}

function addPostMetrics(bucket: MetricBucket, jobs: LeanJob[]) {
  bucket.posts += 1;
  bucket.targets += jobs.length;
  bucket.pending += countJobs(jobs, PublishingJobStatus.PENDING);
  bucket.running += countJobs(jobs, PublishingJobStatus.RUNNING);
  bucket.success += countJobs(jobs, PublishingJobStatus.SUCCESS);
  bucket.failed += countJobs(jobs, PublishingJobStatus.FAILED);
  bucket.canceled += jobs.filter((job) =>
    [
      PublishingJobStatus.CANCELED,
      PublishingJobStatus.CANCEL_REQUESTED,
    ].includes(job.status as PublishingJobStatus),
  ).length;
  bucket.published += countSubmissions(jobs, FacebookSubmissionStatus.PUBLISHED);
  bucket.pendingApproval += countSubmissions(
    jobs,
    FacebookSubmissionStatus.PENDING_APPROVAL,
  );
  bucket.unknownSubmission += countSubmissions(
    jobs,
    FacebookSubmissionStatus.UNKNOWN,
  );
  bucket.reactions += jobs.reduce(
    (total, job) => total + (job.engagement?.reactionCount ?? 0),
    0,
  );
  bucket.comments += jobs.reduce(
    (total, job) => total + (job.engagement?.commentCount ?? 0),
    0,
  );
}

function normalizeFilters(options: AnalyticsListPostsOptions) {
  return {
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.teamId ? { teamId: options.teamId } : {}),
    ...(options.role ? { role: options.role } : {}),
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

function getFullName(firstName?: string, lastName?: string) {
  const fullName = [firstName, lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || undefined;
}

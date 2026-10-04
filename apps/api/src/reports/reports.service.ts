import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { AuthorizationService } from '../auth/authorization.service';
import { Post, PostDocument } from '../schemas/post.schema';
import {
  PublishingJob,
  PublishingJobDocument,
} from '../schemas/publishing-job.schema';
import { Team, TeamDocument } from '../schemas/team.schema';
import { User, UserDocument, UserRole } from '../schemas/user.schema';
import { parseReportRange } from './report-range';

const CACHE_TTL_MS = 30_000;

export interface ReportOverviewOptions {
  from?: string;
  to?: string;
  teamId?: string;
  userId?: string;
  page?: number;
  limit?: number;
  exportAll?: boolean;
}

type LeanReportUser = {
  _id: Types.ObjectId;
  clerkUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  status: string;
  teamId?: string | null;
};

type LeanReportTeam = {
  _id: Types.ObjectId;
  name: string;
  managerId?: string | null;
};

export type ReportMetric = {
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
  totalCompletionMs: number;
  completedWithDuration: number;
};

type ReportAggregate = {
  totals: ReportMetric[];
  byCreator: Array<ReportMetric & { _id: string }>;
};

type CachedReport = { expiresAt: number; value: unknown };

@Injectable()
export class ReportsService {
  private readonly cache = new Map<string, CachedReport>();

  constructor(
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  async overview(clerkUserId: string, options: ReportOverviewOptions) {
    const requester = await this.authorization.requireActiveUser(clerkUserId);
    const range = parseReportRange(options.from, options.to);
    const page = Math.max(1, safeInteger(options.page, 1));
    const limit = options.exportAll
      ? Number.MAX_SAFE_INTEGER
      : Math.min(100, Math.max(1, safeInteger(options.limit, 25)));
    const cacheKey = JSON.stringify({
      clerkUserId,
      role: requester.role,
      range,
      teamId: options.teamId ?? null,
      userId: options.userId ?? null,
      page,
      limit,
      exportAll: options.exportAll === true,
    });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const scope = await this.resolveScope(requester, options);
    const postMatch: Record<string, unknown> = {
      createdAt: { $gte: range.from, $lte: range.to },
    };
    if (scope.restrictPosts) {
      postMatch.clerkUserId = {
        $in: scope.reportUsers.map((user) => user.clerkUserId),
      };
    }

    const previousMatch: Record<string, unknown> = {
      ...postMatch,
      createdAt: { $gte: range.previousFrom, $lte: range.previousTo },
    };

    const [currentAggregate, previousAggregate, teams] = await Promise.all([
      this.runAggregate(postMatch, true),
      this.runAggregate(previousMatch, false),
      this.loadTeams(scope.scopeUsers, requester.role),
    ]);

    const current = currentAggregate.totals[0] ?? emptyMetric();
    const previous = previousAggregate.totals[0] ?? emptyMetric();
    const creatorMetrics = new Map(
      currentAggregate.byCreator.map((bucket) => [
        bucket._id,
        metricOnly(bucket),
      ]),
    );
    const teamById = new Map(teams.map((team) => [team._id.toString(), team]));
    const userByClerkId = new Map(
      scope.scopeUsers.map((user) => [user.clerkUserId, user]),
    );

    const memberRows = scope.reportUsers.map((user) => ({
      id: user._id.toString(),
      name: displayName(user),
      email: user.email,
      role: user.role,
      status: user.status,
      teamId: user.teamId ?? null,
      teamName: user.teamId ? teamById.get(user.teamId)?.name : undefined,
      ...withCalculatedMetrics(
        creatorMetrics.get(user.clerkUserId) ?? emptyMetric(),
      ),
    }));

    for (const bucket of currentAggregate.byCreator) {
      if (userByClerkId.has(bucket._id)) continue;
      memberRows.push({
        id: `unknown:${bucket._id}`,
        name: 'Unknown user',
        email: undefined,
        role: UserRole.SALES,
        status: 'UNKNOWN',
        teamId: null,
        teamName: undefined,
        ...withCalculatedMetrics(metricOnly(bucket)),
      });
    }
    memberRows.sort(
      (a, b) => b.posts - a.posts || a.name.localeCompare(b.name),
    );

    const teamBuckets = new Map<string, ReportMetric>();
    for (const user of scope.reportUsers) {
      const key = user.teamId ?? 'unassigned';
      const metric = creatorMetrics.get(user.clerkUserId) ?? emptyMetric();
      teamBuckets.set(
        key,
        addMetrics(teamBuckets.get(key) ?? emptyMetric(), metric),
      );
    }
    for (const bucket of currentAggregate.byCreator) {
      if (!userByClerkId.has(bucket._id)) {
        teamBuckets.set(
          'unassigned',
          addMetrics(
            teamBuckets.get('unassigned') ?? emptyMetric(),
            metricOnly(bucket),
          ),
        );
      }
    }

    const showAllCompanyTeams =
      (requester.role === UserRole.ADMIN ||
        requester.role === UserRole.MANAGER) &&
      !options.teamId &&
      !options.userId;
    const relevantTeamIds = new Set(
      options.teamId
        ? [options.teamId]
        : showAllCompanyTeams
          ? teams.map((team) => team._id.toString())
          : scope.reportUsers.flatMap((user) =>
              user.teamId ? [user.teamId] : [],
            ),
    );
    const teamRows = teams
      .filter((team) => relevantTeamIds.has(team._id.toString()))
      .map((team) => {
        const teamId = team._id.toString();
        const members = scope.scopeUsers.filter(
          (user) => user.teamId === teamId,
        );
        const leader = members.find(
          (user) => user.role === UserRole.TEAM_LEADER,
        );
        return {
          id: teamId,
          name: team.name,
          managerId: team.managerId ?? null,
          memberCount: members.length,
          teamLeader: leader
            ? { id: leader._id.toString(), name: displayName(leader) }
            : null,
          ...withCalculatedMetrics(teamBuckets.get(teamId) ?? emptyMetric()),
        };
      });
    const unassignedMetric = teamBuckets.get('unassigned');
    if (unassignedMetric && hasActivity(unassignedMetric)) {
      teamRows.push({
        id: 'unassigned',
        name: 'Unassigned',
        managerId: null,
        memberCount: scope.scopeUsers.filter((user) => !user.teamId).length,
        teamLeader: null,
        ...withCalculatedMetrics(unassignedMetric),
      });
    }
    teamRows.sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name));

    const totalMembers = memberRows.length;
    const pagedMembers = options.exportAll
      ? memberRows
      : memberRows.slice((page - 1) * limit, page * limit);
    const value = {
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      scope: {
        role: requester.role,
        level:
          requester.role === UserRole.TEAM_LEADER
            ? 'TEAM'
            : requester.role === UserRole.SALES
              ? 'SELF'
              : 'COMPANY',
        ...(requester.teamId ? { teamId: requester.teamId } : {}),
      },
      filters: {
        from: toDateOnly(range.from),
        to: toDateOnly(range.to),
        ...(options.teamId ? { teamId: options.teamId } : {}),
        ...(options.userId ? { userId: options.userId } : {}),
      },
      totals: withCalculatedMetrics(current),
      previousTotals: withCalculatedMetrics(previous),
      comparison: {
        postsPercent: percentChange(current.posts, previous.posts),
        publishedPercent: percentChange(current.published, previous.published),
        reactionsPercent: percentChange(current.reactions, previous.reactions),
        commentsPercent: percentChange(current.comments, previous.comments),
        successRatePoints:
          calculateSuccessRate(current) - calculateSuccessRate(previous),
      },
      teams: teamRows,
      members: pagedMembers,
      memberPagination: {
        page,
        limit,
        total: totalMembers,
        totalPages: Math.max(1, Math.ceil(totalMembers / limit)),
      },
      options: {
        teams: teams.map((team) => ({
          id: team._id.toString(),
          name: team.name,
        })),
        users: scope.scopeUsers.map((user) => ({
          id: user._id.toString(),
          name: displayName(user),
          role: user.role,
          teamId: user.teamId ?? null,
        })),
      },
    };

    this.pruneCache();
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  async exportCsv(
    clerkUserId: string,
    options: ReportOverviewOptions,
    requestedType?: string,
  ) {
    const exportType = requestedType?.trim() || 'members';
    if (!['members', 'teams'].includes(exportType)) {
      throw new BadRequestException('type must be members or teams');
    }
    const report = (await this.overview(clerkUserId, {
      ...options,
      page: 1,
      exportAll: true,
    })) as {
      scope: { role: UserRole; level: string };
      filters: { from: string; to: string };
      teams: Array<{
        name: string;
        memberCount: number;
        teamLeader?: { name: string } | null;
        posts: number;
        targets: number;
        published: number;
        success: number;
        failed: number;
        successRate: number;
        reactions: number;
        comments: number;
        pendingApproval: number;
        unknownSubmission: number;
        averageCompletionSeconds: number;
      }>;
      members: Array<{
        name: string;
        email?: string;
        role: string;
        status: string;
        teamName?: string;
        posts: number;
        targets: number;
        published: number;
        success: number;
        failed: number;
        successRate: number;
        reactions: number;
        comments: number;
        pendingApproval: number;
        unknownSubmission: number;
        averageCompletionSeconds: number;
      }>;
    };
    if (exportType === 'teams' && report.scope.role === UserRole.SALES) {
      throw new ForbiddenException(
        'Sales users can only export their own member performance',
      );
    }

    const sharedTail = ['Report From', 'Report To', 'Report Scope'];
    const memberHeaders = [
      'Name',
      'Email',
      'Role',
      'Status',
      'Team',
      'Posts',
      'Targets',
      'Confirmed Published',
      'Successful Jobs',
      'Failed Jobs',
      'Success Rate (%)',
      'Reactions',
      'Comments',
      'Pending Approval',
      'Unknown Submission',
      'Average Completion (seconds)',
      ...sharedTail,
    ];
    const memberRows = report.members.map((member) => [
      member.name,
      member.email ?? '',
      member.role,
      member.status,
      member.teamName ?? 'Unassigned',
      member.posts,
      member.targets,
      member.published,
      member.success,
      member.failed,
      member.successRate,
      member.reactions,
      member.comments,
      member.pendingApproval,
      member.unknownSubmission,
      member.averageCompletionSeconds,
      report.filters.from,
      report.filters.to,
      report.scope.level,
    ]);
    const teamHeaders = [
      'Team',
      'Members',
      'Team Leader',
      'Posts',
      'Targets',
      'Confirmed Published',
      'Successful Jobs',
      'Failed Jobs',
      'Success Rate (%)',
      'Reactions',
      'Comments',
      'Pending Approval',
      'Unknown Submission',
      'Average Completion (seconds)',
      ...sharedTail,
    ];
    const teamRows = report.teams.map((team) => [
      team.name,
      team.memberCount,
      team.teamLeader?.name ?? '',
      team.posts,
      team.targets,
      team.published,
      team.success,
      team.failed,
      team.successRate,
      team.reactions,
      team.comments,
      team.pendingApproval,
      team.unknownSubmission,
      team.averageCompletionSeconds,
      report.filters.from,
      report.filters.to,
      report.scope.level,
    ]);
    const exportingTeams = exportType === 'teams';
    const rows = exportingTeams ? teamRows : memberRows;
    const headers = exportingTeams ? teamHeaders : memberHeaders;
    const csv = `\uFEFF${[headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')}\r\n`;
    return {
      csv,
      filename: `postflow-${exportingTeams ? 'team' : 'member'}-performance-${report.filters.from}-to-${report.filters.to}.csv`,
    };
  }

  private async resolveScope(
    requester: UserDocument,
    options: ReportOverviewOptions,
  ) {
    const baseFilter: Record<string, unknown> = {};
    if (requester.role === UserRole.TEAM_LEADER) {
      if (!requester.teamId) {
        return { scopeUsers: [], reportUsers: [], restrictPosts: true };
      }
      baseFilter.teamId = requester.teamId;
      if (options.teamId && options.teamId !== requester.teamId) {
        throw new ForbiddenException('This team is outside your report scope');
      }
    } else if (requester.role === UserRole.SALES) {
      baseFilter._id = requester._id;
      if (options.teamId) {
        throw new ForbiddenException(
          'Sales reports are limited to your own performance',
        );
      }
      if (options.userId && options.userId !== requester._id.toString()) {
        throw new ForbiddenException('This user is outside your report scope');
      }
    }

    const scopeUsers = await this.userModel
      .find(baseFilter)
      .select('clerkUserId email firstName lastName role status teamId')
      .lean<LeanReportUser[]>()
      .exec();
    let reportUsers = scopeUsers;

    if (options.teamId) {
      if (!Types.ObjectId.isValid(options.teamId)) {
        throw new BadRequestException('teamId must be a valid id');
      }
      reportUsers = reportUsers.filter(
        (user) => user.teamId === options.teamId,
      );
    }
    if (options.userId) {
      if (!Types.ObjectId.isValid(options.userId)) {
        throw new BadRequestException('userId must be a valid id');
      }
      const selectedUser = scopeUsers.find(
        (user) => user._id.toString() === options.userId,
      );
      if (!selectedUser) {
        throw new ForbiddenException('This user is outside your report scope');
      }
      reportUsers = reportUsers.filter(
        (user) => user._id.toString() === options.userId,
      );
    }

    return {
      scopeUsers,
      reportUsers,
      restrictPosts:
        requester.role === UserRole.TEAM_LEADER ||
        requester.role === UserRole.SALES ||
        Boolean(options.teamId) ||
        Boolean(options.userId),
    };
  }

  private async loadTeams(users: LeanReportUser[], role: UserRole) {
    if (role === UserRole.ADMIN || role === UserRole.MANAGER) {
      return this.teamModel
        .find()
        .select('name managerId')
        .sort({ name: 1 })
        .lean<LeanReportTeam[]>()
        .exec();
    }
    const teamIds = Array.from(
      new Set(users.flatMap((user) => (user.teamId ? [user.teamId] : []))),
    );
    if (!teamIds.length) return [];
    return this.teamModel
      .find({ _id: { $in: teamIds } })
      .select('name managerId')
      .sort({ name: 1 })
      .lean<LeanReportTeam[]>()
      .exec();
  }

  private async runAggregate(
    match: Record<string, unknown>,
    detailed: boolean,
  ) {
    const metricsProjection = createMetricsProjection();
    const totalsGroup = createMetricsGroup(null);
    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: this.jobModel.collection.name,
          localField: '_id',
          foreignField: 'postId',
          as: 'jobs',
        },
      },
      {
        $project: {
          clerkUserId: 1,
          ...metricsProjection,
        },
      },
      {
        $facet: {
          totals: [{ $group: totalsGroup }],
          byCreator: detailed
            ? [{ $group: createMetricsGroup('$clerkUserId') }]
            : [{ $match: { _id: { $exists: false } } }],
        },
      },
    ];
    const [result] = await this.postModel
      .aggregate<ReportAggregate>(pipeline)
      .exec();
    return result ?? { totals: [], byCreator: [] };
  }

  private pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > 500) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }
}

function createMetricsProjection() {
  const countStatus = (status: string | string[], field = 'status') => ({
    $size: {
      $filter: {
        input: '$jobs',
        as: 'job',
        cond: Array.isArray(status)
          ? { $in: [`$$job.${field}`, status] }
          : { $eq: [`$$job.${field}`, status] },
      },
    },
  });
  const sumJobField = (field: string) => ({
    $sum: {
      $map: {
        input: '$jobs',
        as: 'job',
        in: { $ifNull: [`$$job.${field}`, 0] },
      },
    },
  });
  const hasDuration = {
    $and: [
      { $ne: [{ $ifNull: ['$$job.startedAt', null] }, null] },
      { $ne: [{ $ifNull: ['$$job.completedAt', null] }, null] },
    ],
  };

  return {
    posts: { $literal: 1 },
    targets: { $size: '$jobs' },
    pending: countStatus('PENDING'),
    running: countStatus('RUNNING'),
    success: countStatus('SUCCESS'),
    failed: countStatus('FAILED'),
    canceled: countStatus(['CANCELED', 'CANCEL_REQUESTED']),
    published: countStatus('PUBLISHED', 'submissionStatus'),
    pendingApproval: countStatus('PENDING_APPROVAL', 'submissionStatus'),
    unknownSubmission: countStatus('UNKNOWN', 'submissionStatus'),
    reactions: sumJobField('engagement.reactionCount'),
    comments: sumJobField('engagement.commentCount'),
    totalCompletionMs: {
      $sum: {
        $map: {
          input: '$jobs',
          as: 'job',
          in: {
            $cond: [
              hasDuration,
              { $subtract: ['$$job.completedAt', '$$job.startedAt'] },
              0,
            ],
          },
        },
      },
    },
    completedWithDuration: {
      $size: { $filter: { input: '$jobs', as: 'job', cond: hasDuration } },
    },
  };
}

function createMetricsGroup(id: unknown) {
  return {
    _id: id,
    posts: { $sum: '$posts' },
    targets: { $sum: '$targets' },
    pending: { $sum: '$pending' },
    running: { $sum: '$running' },
    success: { $sum: '$success' },
    failed: { $sum: '$failed' },
    canceled: { $sum: '$canceled' },
    published: { $sum: '$published' },
    pendingApproval: { $sum: '$pendingApproval' },
    unknownSubmission: { $sum: '$unknownSubmission' },
    reactions: { $sum: '$reactions' },
    comments: { $sum: '$comments' },
    totalCompletionMs: { $sum: '$totalCompletionMs' },
    completedWithDuration: { $sum: '$completedWithDuration' },
  };
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function safeInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.floor(value as number) : fallback;
}

function emptyMetric(): ReportMetric {
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
    totalCompletionMs: 0,
    completedWithDuration: 0,
  };
}

function metricOnly(value: ReportMetric): ReportMetric {
  return Object.fromEntries(
    Object.keys(emptyMetric()).map((key) => [
      key,
      Number(value[key as keyof ReportMetric] ?? 0),
    ]),
  ) as unknown as ReportMetric;
}

function addMetrics(left: ReportMetric, right: ReportMetric) {
  return Object.fromEntries(
    Object.keys(left).map((key) => [
      key,
      left[key as keyof ReportMetric] + right[key as keyof ReportMetric],
    ]),
  ) as unknown as ReportMetric;
}

function calculateSuccessRate(metric: ReportMetric) {
  const completed = metric.success + metric.failed;
  return completed ? round((metric.success / completed) * 100) : 0;
}

function withCalculatedMetrics(metric: ReportMetric) {
  return {
    ...metric,
    engagement: metric.reactions + metric.comments,
    successRate: calculateSuccessRate(metric),
    averageCompletionSeconds: metric.completedWithDuration
      ? Math.round(
          metric.totalCompletionMs / metric.completedWithDuration / 1000,
        )
      : 0,
  };
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return round(((current - previous) / previous) * 100);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function hasActivity(metric: ReportMetric) {
  return metric.posts > 0 || metric.targets > 0;
}

function displayName(user: LeanReportUser) {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.email ||
    'Unknown user'
  );
}

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

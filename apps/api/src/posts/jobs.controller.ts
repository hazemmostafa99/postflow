import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FacebookSubmissionStatus,
  PublishingJob,
  PublishingJobDocument,
} from '../schemas/publishing-job.schema';
import { Post as PostSchema, PostDocument } from '../schemas/post.schema';
import { getNextPendingPostCheckAt } from './pending-sync-schedule';
import { getNextEngagementSyncAt } from './engagement-sync-schedule';
import { getEngagementQueueFilter } from './engagement-eligibility';
import {
  FacebookConnection,
  FacebookConnectionDocument,
  FacebookConnectionStatus,
  FacebookConnectionWorkerStatus,
} from '../schemas/facebook-connection.schema';

type PostEngagementSyncResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
  reactionCount?: number;
  commentCount?: number;
  reason?: string;
};

type LeanId = {
  _id: {
    toString(): string;
  };
};

type PendingJobLean = {
  _id: {
    toString(): string;
  };
  postId: {
    content?: string;
    mediaUrls?: string[];
  };
  groupId: {
    _id: {
      toString(): string;
    };
    externalId?: string;
    url?: string;
  };
  postUrl?: string;
  submittedAt?: Date;
  lastCheckedAt?: Date;
  nextCheckAt?: Date;
  syncAttempts?: number;
  lastSyncError?: string;
  createdAt?: Date;
};

type TimestampedDocument = {
  createdAt?: Date;
};

function getCreatedAt(value: unknown): Date | undefined {
  const record = value as TimestampedDocument;
  return record.createdAt instanceof Date ? record.createdAt : undefined;
}

function isPendingFacebookPostUrl(value?: string): boolean {
  if (!value) return false;
  try {
    return /^\/groups\/[^/]+\/pending_posts\/[A-Za-z0-9_-]+/i.test(
      new URL(value).pathname,
    );
  } catch {
    return false;
  }
}

function normalizeFacebookGroupPostUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== 'facebook.com' && !host.endsWith('.facebook.com'))
      return value;
    const match = url.pathname.match(
      /^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)/i,
    );
    if (!match) return value;
    return `https://www.facebook.com/groups/${match[1]}/${match[2]}/${match[3]}/`;
  } catch {
    return value;
  }
}

function getFacebookPostIdentity(value?: string): string | undefined {
  const normalized = normalizeFacebookGroupPostUrl(value);
  if (!normalized) return undefined;
  try {
    return new URL(normalized).pathname.match(
      /^\/groups\/[^/]+\/(?:posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)/i,
    )?.[1];
  } catch {
    return undefined;
  }
}

@Controller('api/jobs')
export class JobsController {
  private static readonly JOB_CLAIM_LEASE_MS = 15 * 60 * 1000;

  constructor(
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(PostSchema.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(FacebookConnection.name)
    private readonly connectionModel: Model<FacebookConnectionDocument>,
  ) {}

  private async getVerifiedWorkerConnection(
    clerkUserId: string,
    extensionInstanceId?: string,
  ): Promise<FacebookConnectionDocument | null> {
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId) return null;
    const connection = await this.connectionModel
      .findOne({ clerkUserId, extensionInstanceId: normalizedInstanceId })
      .lean()
      .exec();
    const verified = Boolean(
      connection?.status === FacebookConnectionStatus.CONNECTED &&
      connection.facebookSessionDetected &&
      connection.facebookUserId &&
      connection.detectedFacebookUserId &&
      connection.facebookUserId === connection.detectedFacebookUserId,
    );
    return verified ? (connection as FacebookConnectionDocument) : null;
  }

  private async assertWorkerOwnsJob(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    job: PublishingJobDocument,
  ) {
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId) return;
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
    );
    if (
      !connection ||
      String(job.facebookConnectionId) !== String(connection._id)
    ) {
      throw new UnauthorizedException(
        'Job is assigned to another Facebook connection',
      );
    }
  }

  /** GET /api/jobs/next — fetch the next pending job for the extension */
  @Get('next')
  async getNextJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');

    const normalizedInstanceId = extensionInstanceId?.trim();
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
    );
    if (normalizedInstanceId && !connection) return null;
    const connectionId = connection?._id;

    // First find all posts belonging to this user
    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean<LeanId[]>()
      .exec();
    const postIds = posts.map((p) => p._id.toString());

    const now = new Date();
    const ownershipFilter = connectionId
      ? { facebookConnectionId: connectionId }
      : {};

    let job: PublishingJobDocument | null;
    if (normalizedInstanceId && connectionId) {
      const leaseExpiresAt = new Date(
        now.getTime() + JobsController.JOB_CLAIM_LEASE_MS,
      );
      job = (await this.jobModel
        .findOneAndUpdate(
          {
            ...ownershipFilter,
            postId: { $in: postIds },
            $and: [
              {
                $or: [
                  { scheduledFor: { $exists: false } },
                  { scheduledFor: null },
                  { scheduledFor: { $lte: now } },
                ],
              },
            ],
            $or: [
              { status: 'PENDING' },
              { status: 'RUNNING', claimExpiresAt: { $lte: now } },
              { status: 'RUNNING', claimExpiresAt: { $exists: false } },
            ],
          } as any,
          {
            $set: {
              status: 'RUNNING',
              claimedByExtensionInstanceId: normalizedInstanceId,
              claimExpiresAt: leaseExpiresAt,
              startedAt: now,
            },
          },
          {
            new: true,
            sort: { scheduledFor: 1, flowOrder: 1, createdAt: 1 },
          },
        )
        .populate('postId', 'content mediaUrls')
        .populate('groupId', 'name url externalId')
        .exec()) as PublishingJobDocument | null;
    } else {
      job = await this.jobModel
        .findOne({
          ...ownershipFilter,
          status: 'PENDING',
          $or: [
            { scheduledFor: { $exists: false } },
            { scheduledFor: null },
            { scheduledFor: { $lte: now } },
          ],
        })
        .where('postId')
        .in(postIds)
        .sort({ scheduledFor: 1, flowOrder: 1, createdAt: 1 })
        .populate('postId', 'content mediaUrls')
        .populate('groupId', 'name url externalId')
        .exec();
    }

    if (!job) return null;

    return job;
  }

  /**
   * GET /api/jobs/pending — fetch a small batch of due Facebook posts that
   * are awaiting group approval.
   */
  @Get('pending')
  async getPendingPosts(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Query('limit') limit?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      extensionInstanceId,
    );
    if (extensionInstanceId?.trim() && !connection) return [];

    const parsedLimit = limit ? Number(limit) : 10;
    const batchLimit = Number.isFinite(parsedLimit)
      ? Math.min(50, Math.max(1, Math.floor(parsedLimit)))
      : 10;
    const now = new Date();

    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean<LeanId[]>()
      .exec();
    const postIds = posts.map((post) => post._id.toString());

    if (!postIds.length) return [];

    const pendingFilter = {
      status: 'SUCCESS',
      submissionStatus: FacebookSubmissionStatus.PENDING_APPROVAL,
      ...(connection ? { facebookConnectionId: connection._id } : {}),
      $or: [
        { nextCheckAt: { $exists: false } },
        { nextCheckAt: null },
        { nextCheckAt: { $lte: now } },
      ],
    };

    const jobs = await this.jobModel
      .find(pendingFilter)
      .where('postId')
      .in(postIds)
      .sort({ submittedAt: 1, createdAt: 1, _id: 1 })
      .limit(batchLimit)
      .populate('postId', 'content mediaUrls')
      .populate('groupId', 'url externalId')
      .lean<PendingJobLean[]>()
      .exec();

    return jobs.map((job) => {
      const post = job.postId;
      const group = job.groupId;
      const submittedAt = job.submittedAt ?? job.createdAt;

      return {
        id: job._id.toString(),
        groupId: group._id.toString(),
        groupExternalId: group.externalId,
        groupUrl: group.url ?? '',
        status: FacebookSubmissionStatus.PENDING_APPROVAL,
        ...(job.postUrl ? { postUrl: job.postUrl } : {}),
        content: post.content,
        submittedAt: submittedAt?.toISOString() ?? new Date().toISOString(),
        mediaCount: Array.isArray(post.mediaUrls) ? post.mediaUrls.length : 0,
        ...(job.lastCheckedAt
          ? { lastCheckedAt: job.lastCheckedAt.toISOString() }
          : {}),
        ...(job.nextCheckAt
          ? { nextCheckAt: job.nextCheckAt.toISOString() }
          : {}),
        syncAttempts: job.syncAttempts ?? 0,
        ...(job.lastSyncError ? { lastSyncError: job.lastSyncError } : {}),
      };
    });
  }

  /** GET /api/jobs/engagement-pending — published jobs with a usable permalink. */
  @Get('engagement-pending')
  async getEngagementPendingPosts(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Query('limit') limit?: string,
    @Query('postId') postId?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      extensionInstanceId,
    );
    if (extensionInstanceId?.trim() && !connection) return [];
    const parsedLimit = limit ? Number(limit) : 10;
    const batchLimit = Number.isFinite(parsedLimit)
      ? Math.min(50, Math.max(1, Math.floor(parsedLimit)))
      : 10;
    const now = new Date();

    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean<LeanId[]>()
      .exec();
    const postIds = posts.map((post) => post._id);
    if (!postIds.length) return [];
    if (postId && !postIds.some((id) => id.toString() === postId)) return [];

    const requestedPostId = postId
      ? postIds.find((id) => id.toString() === postId)
      : undefined;
    const engagementQuery = this.jobModel.find({
      ...getEngagementQueueFilter(now),
      submissionStatus: FacebookSubmissionStatus.PUBLISHED,
      ...(connection ? { facebookConnectionId: connection._id } : {}),
    });
    const jobsQuery = requestedPostId
      ? engagementQuery.where('postId').equals(requestedPostId)
      : engagementQuery.where('postId').in(postIds);

    const jobs = await jobsQuery
      .sort({
        lastEngagementSyncAt: 1,
        publishedDetectedAt: 1,
        createdAt: 1,
        _id: 1,
      })
      .limit(batchLimit)
      .lean()
      .exec();

    return jobs.map((job) => ({
      id: job._id.toString(),
      status: FacebookSubmissionStatus.PUBLISHED,
      postUrl: job.postUrl!,
      ...(job.lastEngagementSyncAt
        ? { lastEngagementSyncAt: job.lastEngagementSyncAt.toISOString() }
        : {}),
      ...(job.nextEngagementSyncAt
        ? { nextEngagementSyncAt: job.nextEngagementSyncAt.toISOString() }
        : {}),
    }));
  }

  /** POST /api/jobs/:id/engagement — persist counters extracted by the extension. */
  @Post(':id/engagement')
  @HttpCode(HttpStatus.OK)
  async updateEngagement(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Param('id') id: string,
    @Body() body: PostEngagementSyncResult,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    if (!['SUCCESS', 'PARTIAL', 'CHECK_FAILED'].includes(body.status)) {
      throw new BadRequestException('Invalid engagement sync result');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId)
      throw new UnauthorizedException('Not your job');
    await this.assertWorkerOwnsJob(clerkUserId, extensionInstanceId, job);
    if (
      job.submissionStatus !== FacebookSubmissionStatus.PUBLISHED ||
      !job.postUrl
    ) {
      throw new BadRequestException('Job is not a published Facebook post');
    }

    const syncedAt = new Date();
    job.engagementSyncAttempts = (job.engagementSyncAttempts ?? 0) + 1;
    job.lastEngagementSyncAt = syncedAt;
    const publishedAt =
      job.publishedDetectedAt ?? getCreatedAt(job) ?? syncedAt;
    job.nextEngagementSyncAt = getNextEngagementSyncAt(
      publishedAt,
      syncedAt,
      body.status === 'CHECK_FAILED',
    );
    if (body.status === 'CHECK_FAILED') {
      job.lastEngagementSyncError =
        body.reason?.slice(0, 500) || 'Engagement check failed';
    } else {
      const previous =
        (job.engagement as
          | Partial<NonNullable<PublishingJobDocument['engagement']>>
          | undefined) ?? {};
      if (body.reactionCount !== undefined || body.commentCount !== undefined) {
        job.engagement = {
          ...(previous.reactionCount !== undefined ||
          body.reactionCount !== undefined
            ? { reactionCount: body.reactionCount ?? previous.reactionCount }
            : {}),
          ...(previous.commentCount !== undefined ||
          body.commentCount !== undefined
            ? { commentCount: body.commentCount ?? previous.commentCount }
            : {}),
          lastSyncedAt: syncedAt,
        };
      }
      job.lastEngagementSyncError =
        body.status === 'PARTIAL'
          ? body.reason?.slice(0, 500) ||
            'One engagement counter was not detected'
          : undefined;
    }
    await job.save();
    return job;
  }

  /**
   * POST /api/jobs/:id/pending-sync — persist one pending-post check result.
   * Facebook is checked by the extension; this endpoint only applies the
   * confirmed result to the authenticated user's job.
   */
  @Post(':id/pending-sync')
  @HttpCode(HttpStatus.OK)
  async updatePendingSync(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      status: 'PUBLISHED' | 'STILL_PENDING' | 'CHECK_FAILED';
      postUrl?: string;
      reason?: string;
    },
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    if (!['PUBLISHED', 'STILL_PENDING', 'CHECK_FAILED'].includes(body.status)) {
      throw new BadRequestException('Invalid pending sync result');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    await this.assertWorkerOwnsJob(clerkUserId, extensionInstanceId, job);
    const normalizedBodyPostUrl = normalizeFacebookGroupPostUrl(body.postUrl);
    if (job.postUrl) {
      const normalizedExistingPostUrl = normalizeFacebookGroupPostUrl(
        job.postUrl,
      );
      if (
        normalizedExistingPostUrl &&
        normalizedExistingPostUrl !== job.postUrl
      ) {
        job.postUrl = normalizedExistingPostUrl;
      }
    }

    if (job.submissionStatus === FacebookSubmissionStatus.PUBLISHED) {
      if (
        isPendingFacebookPostUrl(job.postUrl) &&
        (body.status === 'STILL_PENDING' ||
          isPendingFacebookPostUrl(normalizedBodyPostUrl))
      ) {
        const checkedAt = new Date();
        job.submissionStatus = FacebookSubmissionStatus.PENDING_APPROVAL;
        if (normalizedBodyPostUrl) job.postUrl = normalizedBodyPostUrl;
        job.lastCheckedAt = checkedAt;
        job.syncAttempts = (job.syncAttempts ?? 0) + 1;
        job.lastSyncError = undefined;
        job.nextCheckAt = getNextPendingPostCheckAt(
          job.submittedAt ?? getCreatedAt(job) ?? checkedAt,
          checkedAt,
        );
        await job.save();
        return job;
      }
      if (
        body.status === 'PUBLISHED' &&
        normalizedBodyPostUrl &&
        (!job.postUrl ||
          getFacebookPostIdentity(job.postUrl) ===
            getFacebookPostIdentity(normalizedBodyPostUrl))
      ) {
        const checkedAt = new Date();
        job.postUrl = normalizedBodyPostUrl;
        job.publishedDetectedAt ??= checkedAt;
        job.lastCheckedAt = checkedAt;
        job.syncAttempts = (job.syncAttempts ?? 0) + 1;
        job.lastSyncError = undefined;
        job.nextCheckAt = undefined;
        await job.save();
      }
      return job;
    }
    if (
      job.submissionStatus === FacebookSubmissionStatus.UNKNOWN &&
      body.status === 'PUBLISHED' &&
      normalizedBodyPostUrl
    ) {
      const checkedAt = new Date();
      job.submissionStatus = FacebookSubmissionStatus.PUBLISHED;
      job.postUrl = normalizedBodyPostUrl;
      job.publishedDetectedAt ??= checkedAt;
      job.lastCheckedAt = checkedAt;
      job.syncAttempts = (job.syncAttempts ?? 0) + 1;
      job.lastSyncError = undefined;
      job.nextCheckAt = undefined;
      await job.save();
      return job;
    }
    if (
      job.submissionStatus === FacebookSubmissionStatus.UNKNOWN &&
      body.status === 'STILL_PENDING' &&
      normalizedBodyPostUrl
    ) {
      const checkedAt = new Date();
      job.submissionStatus = FacebookSubmissionStatus.PENDING_APPROVAL;
      if (normalizedBodyPostUrl) job.postUrl = normalizedBodyPostUrl;
      job.submittedAt ??= checkedAt;
      job.lastCheckedAt = checkedAt;
      job.syncAttempts = (job.syncAttempts ?? 0) + 1;
      job.lastSyncError = undefined;
      job.nextCheckAt = getNextPendingPostCheckAt(
        job.submittedAt ?? getCreatedAt(job) ?? checkedAt,
        checkedAt,
      );
      await job.save();
      return job;
    }
    if (job.submissionStatus !== FacebookSubmissionStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Job is not awaiting Facebook approval');
    }

    const checkedAt = new Date();
    job.lastCheckedAt = checkedAt;
    job.syncAttempts = (job.syncAttempts ?? 0) + 1;

    if (body.status === 'PUBLISHED') {
      job.submissionStatus = FacebookSubmissionStatus.PUBLISHED;
      if (normalizedBodyPostUrl) job.postUrl = normalizedBodyPostUrl;
      job.publishedDetectedAt ??= checkedAt;
      job.lastSyncError = undefined;
      job.nextCheckAt = undefined;
    } else if (body.status === 'STILL_PENDING') {
      if (normalizedBodyPostUrl) job.postUrl = normalizedBodyPostUrl;
      job.lastSyncError = undefined;
      job.nextCheckAt = getNextPendingPostCheckAt(
        job.submittedAt ?? getCreatedAt(job) ?? checkedAt,
        checkedAt,
      );
    } else {
      job.lastSyncError =
        body.reason?.slice(0, 500) || 'Pending post check failed';
      job.nextCheckAt = getNextPendingPostCheckAt(
        job.submittedAt ?? getCreatedAt(job) ?? checkedAt,
        checkedAt,
        true,
      );
    }

    await job.save();
    return job;
  }

  /** POST /api/jobs/:id/status — update a job's status */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateJobStatus(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      status: string;
      error?: string;
      submissionResult?: {
        status: FacebookSubmissionStatus;
        postUrl?: string;
        reason?: string;
      };
    },
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const allowedStatuses = new Set([
      'PENDING',
      'RUNNING',
      'SUCCESS',
      'FAILED',
    ]);
    if (!allowedStatuses.has(body.status)) {
      throw new BadRequestException('Invalid job status');
    }
    if (
      body.submissionResult &&
      !Object.values(FacebookSubmissionStatus).includes(
        body.submissionResult.status,
      )
    ) {
      throw new BadRequestException('Invalid Facebook submission status');
    }

    // Make sure the job actually belongs to the user by populating the post
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }

    const normalizedInstanceId = extensionInstanceId?.trim();
    let workerConnectionId: unknown;
    if (normalizedInstanceId) {
      const connection = await this.connectionModel
        .findOne({ clerkUserId, extensionInstanceId: normalizedInstanceId })
        .lean()
        .exec();
      const verified = Boolean(
        connection?.status === FacebookConnectionStatus.CONNECTED &&
        connection.facebookSessionDetected &&
        connection.facebookUserId &&
        connection.detectedFacebookUserId &&
        connection.facebookUserId === connection.detectedFacebookUserId,
      );
      if (
        !connection ||
        !verified ||
        String(job.facebookConnectionId) !== String(connection._id)
      ) {
        throw new UnauthorizedException('Job is assigned to another Facebook connection');
      }
      workerConnectionId = connection._id;
    }

    const previousStatus = job.status;
    if (
      body.submissionResult &&
      job.submissionStatus === FacebookSubmissionStatus.PUBLISHED &&
      body.submissionResult.status !== FacebookSubmissionStatus.PUBLISHED
    ) {
      throw new BadRequestException(
        'Published Facebook posts cannot be downgraded',
      );
    }
    job.status = body.status;
    job.error = body.status === 'FAILED' ? body.error : undefined;
    if (normalizedInstanceId && body.status === 'RUNNING') {
      job.claimedByExtensionInstanceId = normalizedInstanceId;
      job.claimExpiresAt = new Date(Date.now() + JobsController.JOB_CLAIM_LEASE_MS);
    } else if (
      normalizedInstanceId &&
      (body.status === 'SUCCESS' || body.status === 'FAILED')
    ) {
      job.claimedByExtensionInstanceId = undefined;
      job.claimExpiresAt = undefined;
    }
    if (workerConnectionId && body.status === 'RUNNING') {
      await this.connectionModel.updateOne(
        { _id: workerConnectionId },
        {
          $set: {
            workerStatus: FacebookConnectionWorkerStatus.PUBLISHING,
            lastSeenAt: new Date(),
          },
        },
      );
    } else if (
      workerConnectionId &&
      (body.status === 'SUCCESS' || body.status === 'FAILED')
    ) {
      await this.connectionModel.updateOne(
        { _id: workerConnectionId },
        {
          $set: {
            workerStatus: FacebookConnectionWorkerStatus.IDLE,
            lastSeenAt: new Date(),
          },
        },
      );
    }
    if (body.submissionResult) {
      const normalizedSubmissionPostUrl = normalizeFacebookGroupPostUrl(
        body.submissionResult.postUrl,
      );
      let duplicatePermalink = false;
      if (
        normalizedSubmissionPostUrl &&
        (body.submissionResult.status === FacebookSubmissionStatus.PUBLISHED ||
          body.submissionResult.status === FacebookSubmissionStatus.PENDING_APPROVAL)
      ) {
        const existingJobWithPermalink = await this.jobModel
          .findOne({
            _id: { $ne: job._id },
            groupId: job.groupId,
            postUrl: normalizedSubmissionPostUrl,
          })
          .select('_id')
          .lean()
          .exec();
        duplicatePermalink = Boolean(existingJobWithPermalink);
      }

      job.submissionStatus = duplicatePermalink
        ? FacebookSubmissionStatus.UNKNOWN
        : body.submissionResult.status;
      // A later retry may report the status without repeating the permalink.
      // Never erase a URL that was already captured successfully.
      if (
        !duplicatePermalink &&
        (body.submissionResult.status === FacebookSubmissionStatus.PUBLISHED ||
          body.submissionResult.status ===
            FacebookSubmissionStatus.PENDING_APPROVAL) &&
        normalizedSubmissionPostUrl
      ) {
        job.postUrl = normalizedSubmissionPostUrl;
      }
      if (body.submissionResult.status === FacebookSubmissionStatus.UNKNOWN) {
        job.postUrl = undefined;
      }
      job.submissionReason =
        duplicatePermalink
          ? 'Facebook returned a permalink already assigned to another job in this group'
          : body.submissionResult.status === FacebookSubmissionStatus.UNKNOWN
          ? body.submissionResult.reason
          : undefined;

      if (
        !duplicatePermalink &&
        body.submissionResult.status ===
          FacebookSubmissionStatus.PENDING_APPROVAL &&
        !job.submittedAt
      ) {
        job.submittedAt = new Date();
        job.syncAttempts = 0;
        job.lastCheckedAt = undefined;
        job.nextCheckAt = undefined;
        job.lastSyncError = undefined;
      }

      if (
        !duplicatePermalink &&
        body.submissionResult.status === FacebookSubmissionStatus.PUBLISHED
      ) {
        job.publishedDetectedAt ??= new Date();
      }
    }

    // Increment attempts if it just finished (success or fail)
    if (
      (body.status === 'SUCCESS' || body.status === 'FAILED') &&
      previousStatus !== 'SUCCESS' &&
      previousStatus !== 'FAILED'
    ) {
      job.attempts = (job.attempts || 0) + 1;
      job.completedAt = new Date();
    } else if (body.status === 'RUNNING') {
      job.startedAt = new Date();
    }

    await job.save();
    await this.updateParentPostStatus(post);

    return job;
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

    const allSucceeded = jobs.every((job) => job.status === 'SUCCESS');
    const anyFailed = jobs.some((job) => job.status === 'FAILED');
    const allFinished = jobs.every(
      (job) => job.status === 'SUCCESS' || job.status === 'FAILED',
    );

    if (allSucceeded) {
      post.status = 'COMPLETED';
    } else if (allFinished && anyFailed) {
      post.status = 'PARTIAL_FAILURE';
    } else {
      post.status = 'PUBLISHING';
    }

    await post.save();
  }
}

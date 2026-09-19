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
import { FacebookSubmissionStatus, PublishingJob, PublishingJobDocument } from '../schemas/publishing-job.schema';
import { Post as PostSchema, PostDocument } from '../schemas/post.schema';
import { getNextPendingPostCheckAt } from './pending-sync-schedule';
import { getNextEngagementSyncAt } from './engagement-sync-schedule';
import { getEngagementQueueFilter } from './engagement-eligibility';

type PostEngagementSyncResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
  reactionCount?: number;
  commentCount?: number;
  reason?: string;
};

function isPendingFacebookPostUrl(value?: string): boolean {
  if (!value) return false;
  try {
    return /^\/groups\/[^/]+\/pending_posts\/\d+/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

@Controller('api/jobs')
export class JobsController {
  constructor(
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(PostSchema.name)
    private readonly postModel: Model<PostDocument>,
  ) {}

  /** GET /api/jobs/next — fetch the next pending job for the extension */
  @Get('next')
  async getNextJob(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');

    // First find all posts belonging to this user
    const posts = await this.postModel.find({ clerkUserId }).select('_id').lean().exec();
    const postIds = posts.map(p => p._id);

    // Find the oldest pending job for any of these posts
    const job = await this.jobModel
      .findOne({
        postId: { $in: postIds } as any,
        status: 'PENDING',
      })
      .sort({ createdAt: 1 })
      .populate('postId', 'content mediaUrls')
      .populate('groupId', 'name url externalId')
      .exec();

    if (!job) return null;

    // Optional: mark it as RUNNING right away or let the extension do it?
    // Let's let the extension do it when it actually starts.

    return job;
  }

  /**
   * GET /api/jobs/pending — fetch a small batch of due Facebook posts that
   * are awaiting group approval.
   */
  @Get('pending')
  async getPendingPosts(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('limit') limit?: string,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');

    const parsedLimit = limit ? Number(limit) : 10;
    const batchLimit = Number.isFinite(parsedLimit)
      ? Math.min(50, Math.max(1, Math.floor(parsedLimit)))
      : 10;
    const now = new Date();

    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean()
      .exec();
    const postIds = posts.map((post) => post._id);

    if (!postIds.length) return [];

    const jobs = await this.jobModel
      .find({
        postId: { $in: postIds } as any,
        status: 'SUCCESS',
        submissionStatus: FacebookSubmissionStatus.PENDING_APPROVAL,
        $or: [
          { nextCheckAt: { $exists: false } },
          { nextCheckAt: null },
          { nextCheckAt: { $lte: now } },
        ],
      })
      .sort({ submittedAt: 1, createdAt: 1, _id: 1 })
      .limit(batchLimit)
      .populate('postId', 'content mediaUrls')
      .populate('groupId', 'url externalId')
      .lean()
      .exec();

    return jobs.map((job) => {
      const post = job.postId as any;
      const group = job.groupId as any;
      const submittedAt = job.submittedAt ?? (job as any).createdAt;

      return {
        id: job._id.toString(),
        groupId: group._id.toString(),
        groupExternalId: group.externalId,
        groupUrl: group.url,
        status: FacebookSubmissionStatus.PENDING_APPROVAL,
        ...(job.postUrl ? { postUrl: job.postUrl } : {}),
        content: post.content,
        submittedAt: submittedAt?.toISOString() ?? new Date().toISOString(),
        mediaCount: Array.isArray(post.mediaUrls) ? post.mediaUrls.length : 0,
        ...(job.lastCheckedAt ? { lastCheckedAt: job.lastCheckedAt.toISOString() } : {}),
        ...(job.nextCheckAt ? { nextCheckAt: job.nextCheckAt.toISOString() } : {}),
        syncAttempts: job.syncAttempts ?? 0,
        ...(job.lastSyncError ? { lastSyncError: job.lastSyncError } : {}),
      };
    });
  }

  /** GET /api/jobs/engagement-pending — published jobs with a usable permalink. */
  @Get('engagement-pending')
  async getEngagementPendingPosts(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('limit') limit?: string,
    @Query('postId') postId?: string,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    const parsedLimit = limit ? Number(limit) : 10;
    const batchLimit = Number.isFinite(parsedLimit)
      ? Math.min(50, Math.max(1, Math.floor(parsedLimit)))
      : 10;
    const now = new Date();

    const posts = await this.postModel.find({ clerkUserId }).select('_id').lean().exec();
    const postIds = posts.map((post) => post._id);
    if (!postIds.length) return [];
    if (postId && !postIds.some((id) => id.toString() === postId)) return [];

    const jobs = await this.jobModel
      .find({ postId: postId ? postId : { $in: postIds }, ...getEngagementQueueFilter(now) } as any)
      .sort({ lastEngagementSyncAt: 1, publishedDetectedAt: 1, createdAt: 1, _id: 1 })
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
    @Param('id') id: string,
    @Body() body: PostEngagementSyncResult,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    if (!['SUCCESS', 'PARTIAL', 'CHECK_FAILED'].includes(body.status)) {
      throw new BadRequestException('Invalid engagement sync result');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) throw new UnauthorizedException('Not your job');
    if (job.submissionStatus !== FacebookSubmissionStatus.PUBLISHED || !job.postUrl) {
      throw new BadRequestException('Job is not a published Facebook post');
    }

    const syncedAt = new Date();
    job.engagementSyncAttempts = (job.engagementSyncAttempts ?? 0) + 1;
    job.lastEngagementSyncAt = syncedAt;
    const publishedAt = job.publishedDetectedAt ?? (job as any).createdAt ?? syncedAt;
    job.nextEngagementSyncAt = getNextEngagementSyncAt(
      publishedAt,
      syncedAt,
      body.status === 'CHECK_FAILED',
    );
    if (body.status === 'CHECK_FAILED') {
      job.lastEngagementSyncError = body.reason?.slice(0, 500) || 'Engagement check failed';
    } else {
      const previous = (job.engagement as Partial<NonNullable<PublishingJobDocument['engagement']>> | undefined) ?? {};
      if (body.reactionCount !== undefined || body.commentCount !== undefined) {
        job.engagement = {
          ...(previous.reactionCount !== undefined || body.reactionCount !== undefined
            ? { reactionCount: body.reactionCount ?? previous.reactionCount }
            : {}),
          ...(previous.commentCount !== undefined || body.commentCount !== undefined
            ? { commentCount: body.commentCount ?? previous.commentCount }
            : {}),
          lastSyncedAt: syncedAt,
        };
      }
      job.lastEngagementSyncError = body.status === 'PARTIAL'
        ? body.reason?.slice(0, 500) || 'One engagement counter was not detected'
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
    @Param('id') id: string,
    @Body() body: {
      status: 'PUBLISHED' | 'STILL_PENDING' | 'CHECK_FAILED';
      postUrl?: string;
      reason?: string;
    },
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    if (!['PUBLISHED', 'STILL_PENDING', 'CHECK_FAILED'].includes(body.status)) {
      throw new BadRequestException('Invalid pending sync result');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    if (job.submissionStatus === FacebookSubmissionStatus.PUBLISHED) {
      if (isPendingFacebookPostUrl(job.postUrl) && (body.status === 'STILL_PENDING' || isPendingFacebookPostUrl(body.postUrl))) {
        const checkedAt = new Date();
        job.submissionStatus = FacebookSubmissionStatus.PENDING_APPROVAL;
        if (body.postUrl) job.postUrl = body.postUrl;
        job.lastCheckedAt = checkedAt;
        job.syncAttempts = (job.syncAttempts ?? 0) + 1;
        job.lastSyncError = undefined;
        job.nextCheckAt = getNextPendingPostCheckAt(
          job.submittedAt ?? (job as any).createdAt ?? checkedAt,
          checkedAt,
        );
        await job.save();
        return job;
      }
      if (body.status === 'PUBLISHED' && body.postUrl && !job.postUrl) {
        const checkedAt = new Date();
        job.postUrl = body.postUrl;
        job.publishedDetectedAt ??= checkedAt;
        job.lastCheckedAt = checkedAt;
        job.syncAttempts = (job.syncAttempts ?? 0) + 1;
        job.lastSyncError = undefined;
        job.nextCheckAt = undefined;
        await job.save();
      }
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
      if (body.postUrl) job.postUrl = body.postUrl;
      job.publishedDetectedAt ??= checkedAt;
      job.lastSyncError = undefined;
      job.nextCheckAt = undefined;
    } else if (body.status === 'STILL_PENDING') {
      job.lastSyncError = undefined;
      job.nextCheckAt = getNextPendingPostCheckAt(
        job.submittedAt ?? (job as any).createdAt ?? checkedAt,
        checkedAt,
      );
    } else {
      job.lastSyncError = body.reason?.slice(0, 500) || 'Pending post check failed';
      job.nextCheckAt = getNextPendingPostCheckAt(
        job.submittedAt ?? (job as any).createdAt ?? checkedAt,
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
    @Param('id') id: string,
    @Body() body: {
      status: string;
      error?: string;
      submissionResult?: {
        status: FacebookSubmissionStatus;
        postUrl?: string;
        reason?: string;
      };
    },
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    const allowedStatuses = new Set(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']);
    if (!allowedStatuses.has(body.status)) {
      throw new BadRequestException('Invalid job status');
    }
    if (body.submissionResult && !Object.values(FacebookSubmissionStatus).includes(body.submissionResult.status)) {
      throw new BadRequestException('Invalid Facebook submission status');
    }

    // Make sure the job actually belongs to the user by populating the post
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }

    const previousStatus = job.status;
    if (
      body.submissionResult &&
      job.submissionStatus === FacebookSubmissionStatus.PUBLISHED &&
      body.submissionResult.status !== FacebookSubmissionStatus.PUBLISHED
    ) {
      throw new BadRequestException('Published Facebook posts cannot be downgraded');
    }
    job.status = body.status;
    job.error = body.status === 'FAILED' ? body.error : undefined;
    if (body.submissionResult) {
      job.submissionStatus = body.submissionResult.status;
      // A later retry may report the status without repeating the permalink.
      // Never erase a URL that was already captured successfully.
      if (
        (body.submissionResult.status === FacebookSubmissionStatus.PUBLISHED ||
          body.submissionResult.status === FacebookSubmissionStatus.PENDING_APPROVAL) &&
        body.submissionResult.postUrl
      ) {
        job.postUrl = body.submissionResult.postUrl;
      }
      if (body.submissionResult.status === FacebookSubmissionStatus.UNKNOWN) {
        job.postUrl = undefined;
      }
      job.submissionReason = body.submissionResult.status === FacebookSubmissionStatus.UNKNOWN
        ? body.submissionResult.reason
        : undefined;

      if (body.submissionResult.status === FacebookSubmissionStatus.PENDING_APPROVAL && !job.submittedAt) {
        job.submittedAt = new Date();
        job.syncAttempts = 0;
        job.lastCheckedAt = undefined;
        job.nextCheckAt = undefined;
        job.lastSyncError = undefined;
      }

      if (body.submissionResult.status === FacebookSubmissionStatus.PUBLISHED) {
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
      .find({ postId: post._id } as any)
      .select('status')
      .lean()
      .exec();

    if (!jobs.length) return;

    const allSucceeded = jobs.every((job) => job.status === 'SUCCESS');
    const anyFailed = jobs.some((job) => job.status === 'FAILED');
    const allFinished = jobs.every((job) => job.status === 'SUCCESS' || job.status === 'FAILED');

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

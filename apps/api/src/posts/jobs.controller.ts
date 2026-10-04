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
  randomUUID,
} from 'node:crypto';
import {
  FacebookSubmissionStatus,
  MaintenanceClaimType,
  PublishingJob,
  PublishingJobDocument,
  PublishingJobStatus,
  PublishingTargetType,
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
import { toPublishJobPayload } from './publish-job-payload';

type PostEngagementSyncResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
  reactionCount?: number;
  commentCount?: number;
  reason?: string;
  claimToken?: string;
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
  groupId?: {
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
  maintenanceClaimToken?: string;
  createdAt?: Date;
};

type EngagementJobLean = {
  _id: { toString(): string };
  targetType?: PublishingTargetType;
  postUrl?: string;
  lastEngagementSyncAt?: Date;
  nextEngagementSyncAt?: Date;
  maintenanceClaimToken?: string;
};

const groupOrLegacyTargetFilter = {
  $or: [
    { targetType: PublishingTargetType.GROUP },
    { targetType: { $exists: false } },
    { targetType: null },
  ],
};

const publishableTargetFilter = {
  $or: [
    { targetType: PublishingTargetType.GROUP },
    { targetType: PublishingTargetType.PROFILE_FEED },
    { targetType: { $exists: false } },
    { targetType: null },
  ],
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
  private static readonly MAINTENANCE_CLAIM_LEASE_MS = 5 * 60 * 1000;

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

  private requireExtensionInstanceId(extensionInstanceId?: string): string {
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId) {
      throw new UnauthorizedException(
        'x-extension-instance-id header is required',
      );
    }
    return normalizedInstanceId;
  }

  private async assertWorkerOwnsJob(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    job: PublishingJobDocument,
  ): Promise<FacebookConnectionDocument> {
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
    );
    if (!connection) {
      throw new UnauthorizedException(
        'Extension instance is not linked to a verified Facebook connection',
      );
    }
    if (String(job.facebookConnectionId) !== String(connection._id)) {
      throw new UnauthorizedException(
        'Job is assigned to another Facebook connection',
      );
    }
    return connection;
  }

  private maintenanceClaimAvailableFilter(now: Date) {
    return {
      $or: [
        { maintenanceClaimExpiresAt: { $exists: false } },
        { maintenanceClaimExpiresAt: null },
        { maintenanceClaimExpiresAt: { $lte: now } },
      ],
    };
  }

  private releaseMaintenanceClaim(
    job: PublishingJobDocument,
    claimType?: MaintenanceClaimType,
  ) {
    job.maintenanceClaimedByExtensionInstanceId = undefined;
    job.maintenanceClaimType = undefined;
    job.maintenanceClaimToken = undefined;
    job.maintenanceClaimExpiresAt = undefined;
    if (claimType) this.clearManualMaintenanceRequest(job, claimType);
  }

  private clearManualMaintenanceRequest(
    job: PublishingJobDocument,
    claimType: MaintenanceClaimType,
  ) {
    if (claimType === MaintenanceClaimType.PENDING_APPROVAL) {
      job.manualPendingSyncRequestedAt = undefined;
    } else {
      job.manualEngagementSyncRequestedAt = undefined;
    }
  }

  private manualMaintenanceRequestFilter(claimType: MaintenanceClaimType) {
    return claimType === MaintenanceClaimType.PENDING_APPROVAL
      ? { manualPendingSyncRequestedAt: { $exists: true, $ne: null } }
      : { manualEngagementSyncRequestedAt: { $exists: true, $ne: null } };
  }

  private async assertMaintenanceClaim(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    job: PublishingJobDocument,
    claimType: MaintenanceClaimType,
    claimToken?: string,
  ) {
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const connection = await this.assertWorkerOwnsJob(
      clerkUserId,
      normalizedInstanceId,
      job,
    );

    const hasClaim = Boolean(
      job.maintenanceClaimType ||
        job.maintenanceClaimToken ||
        job.maintenanceClaimExpiresAt,
    );
    if (!hasClaim) {
      throw new UnauthorizedException('Maintenance claim required');
    }

    if (
      job.maintenanceClaimType !== claimType ||
      job.maintenanceClaimedByExtensionInstanceId !== normalizedInstanceId ||
      !claimToken ||
      claimToken !== job.maintenanceClaimToken ||
      !job.maintenanceClaimExpiresAt ||
      job.maintenanceClaimExpiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired maintenance claim');
    }
    return connection;
  }

  private async claimSpecificMaintenanceJob(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    id: string,
    claimType: MaintenanceClaimType,
  ) {
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    const connection = await this.assertWorkerOwnsJob(
      clerkUserId,
      extensionInstanceId,
      job,
    );
    const now = new Date();
    const eligibility =
      claimType === MaintenanceClaimType.PENDING_APPROVAL
        ? {
            status: PublishingJobStatus.SUCCESS,
            $or: [
              {
                submissionStatus: FacebookSubmissionStatus.PENDING_APPROVAL,
              },
              {
                submissionStatus: FacebookSubmissionStatus.PUBLISHED,
                postUrl: { $regex: /\/pending_posts\//i },
              },
            ],
            $and: [
              {
                $or: [
                  { targetType: PublishingTargetType.GROUP },
                  { targetType: { $exists: false } },
                  { targetType: null },
                ],
              },
              { groupId: { $exists: true, $ne: null } },
            ],
          }
        : {
            status: PublishingJobStatus.SUCCESS,
            submissionStatus: FacebookSubmissionStatus.PUBLISHED,
            postUrl: { $exists: true, $ne: '' },
          };
    const maintenanceClaimToken = randomUUID();
    const claimedJob = await this.jobModel
      .findOneAndUpdate(
        {
          _id: job._id,
          facebookConnectionId: connection._id,
          ...eligibility,
          $and: [
            ...(Array.isArray(eligibility.$and) ? eligibility.$and : []),
            this.maintenanceClaimAvailableFilter(now),
          ],
        } as any,
        {
          $set: {
            maintenanceClaimedByExtensionInstanceId:
              this.requireExtensionInstanceId(extensionInstanceId),
            maintenanceClaimType: claimType,
            maintenanceClaimToken,
            maintenanceClaimExpiresAt: new Date(
              now.getTime() + JobsController.MAINTENANCE_CLAIM_LEASE_MS,
            ),
          },
        },
        { new: true },
      )
      .populate('postId', 'content mediaUrls')
      .populate('groupId', 'url externalId')
      .lean()
      .exec();

    if (!claimedJob) {
      throw new UnauthorizedException(
        'Job is unavailable or already claimed by another worker',
      );
    }

    if (claimType === MaintenanceClaimType.ENGAGEMENT) {
      return {
        id: claimedJob._id.toString(),
        status: FacebookSubmissionStatus.PUBLISHED,
        targetType: claimedJob.targetType ?? PublishingTargetType.GROUP,
        postUrl: claimedJob.postUrl!,
        claimToken: maintenanceClaimToken,
      };
    }

    const claimedPost = claimedJob.postId as {
      content?: string;
      mediaUrls?: string[];
    };
    const claimedGroup = claimedJob.groupId as {
      _id: { toString(): string };
      externalId?: string;
      url?: string;
    } | undefined;
    if (!claimedGroup) {
      throw new BadRequestException('Pending job has no Facebook group');
    }
    const submittedAt = claimedJob.submittedAt ?? getCreatedAt(claimedJob);
    return {
      id: claimedJob._id.toString(),
      groupId: claimedGroup._id.toString(),
      groupExternalId: claimedGroup.externalId,
      groupUrl: claimedGroup.url ?? '',
      status: FacebookSubmissionStatus.PENDING_APPROVAL,
      ...(claimedJob.postUrl ? { postUrl: claimedJob.postUrl } : {}),
      content: claimedPost.content,
      submittedAt: submittedAt?.toISOString() ?? new Date().toISOString(),
      mediaCount: Array.isArray(claimedPost.mediaUrls)
        ? claimedPost.mediaUrls.length
        : 0,
      claimToken: maintenanceClaimToken,
    };
  }

  /** GET /api/jobs/next — fetch the next pending job for the extension */
  @Get('next')
  async getNextJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');

    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
    );
    if (!connection) return null;
    const connectionId = connection?._id;

    // First find all posts belonging to this user
    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean<LeanId[]>()
      .exec();
    const postIds = posts.map((p) => p._id.toString());

    const now = new Date();
    const ownershipFilter = { facebookConnectionId: connectionId };
    const supportedTargetFilter = publishableTargetFilter;

    const leaseExpiresAt = new Date(
      now.getTime() + JobsController.JOB_CLAIM_LEASE_MS,
    );
    const job = (await this.jobModel
      .findOneAndUpdate(
        {
          ...ownershipFilter,
          postId: { $in: postIds },
          $and: [
            supportedTargetFilter,
            {
              $or: [
                { scheduledFor: { $exists: false } },
                { scheduledFor: null },
                { scheduledFor: { $lte: now } },
              ],
            },
          ],
          $or: [
            { status: PublishingJobStatus.PENDING },
            {
              status: PublishingJobStatus.RUNNING,
              claimExpiresAt: { $lte: now },
            },
            {
              status: PublishingJobStatus.RUNNING,
              claimExpiresAt: { $exists: false },
            },
          ],
        } as any,
        {
          $set: {
            status: PublishingJobStatus.RUNNING,
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
      .populate(
        'facebookConnectionId',
        'displayName facebookUserId detectedFacebookUserId',
      )
      .exec()) as PublishingJobDocument | null;

    if (!job) return null;

    return toPublishJobPayload(job);
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
    @Query('manualOnly') manualOnly?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
    );
    if (!connection) return [];

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

    const manualOnlyRequested = manualOnly === 'true';
    const pendingFilter = {
      status: 'SUCCESS',
      facebookConnectionId: connection._id,
      $and: [
        groupOrLegacyTargetFilter,
        { groupId: { $exists: true, $ne: null } },
        {
          $or: [
            { submissionStatus: FacebookSubmissionStatus.PENDING_APPROVAL },
            {
              submissionStatus: FacebookSubmissionStatus.PUBLISHED,
              postUrl: { $regex: /\/pending_posts\//i },
            },
          ],
        },
        manualOnlyRequested
          ? this.manualMaintenanceRequestFilter(
              MaintenanceClaimType.PENDING_APPROVAL,
            )
          : {
              $or: [
                this.manualMaintenanceRequestFilter(
                  MaintenanceClaimType.PENDING_APPROVAL,
                ),
                { nextCheckAt: { $exists: false } },
                { nextCheckAt: null },
                { nextCheckAt: { $lte: now } },
              ],
            },
        this.maintenanceClaimAvailableFilter(now),
      ],
    };

    const jobs: PendingJobLean[] = [];
    for (let index = 0; index < batchLimit; index += 1) {
      const maintenanceClaimToken = randomUUID();
      const claimedJob = await this.jobModel
        .findOneAndUpdate(
          {
            ...pendingFilter,
            postId: { $in: postIds },
          } as any,
          {
            $set: {
              maintenanceClaimedByExtensionInstanceId:
                normalizedInstanceId,
              maintenanceClaimType: MaintenanceClaimType.PENDING_APPROVAL,
              maintenanceClaimToken,
              maintenanceClaimExpiresAt: new Date(
                now.getTime() + JobsController.MAINTENANCE_CLAIM_LEASE_MS,
              ),
            },
          },
          {
            new: true,
            sort: { submittedAt: 1, createdAt: 1, _id: 1 },
          },
        )
        .populate('postId', 'content mediaUrls')
        .populate('groupId', 'url externalId')
        .lean<PendingJobLean>()
        .exec();
      if (!claimedJob) break;
      jobs.push(claimedJob);
    }

    return jobs.flatMap((job) => {
      const post = job.postId;
      const group = job.groupId;
      if (!group) return [];
      const submittedAt = job.submittedAt ?? job.createdAt;

      return [
        {
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
          ...(job.maintenanceClaimToken
            ? { claimToken: job.maintenanceClaimToken }
            : {}),
        },
      ];
    });
  }

  /** GET /api/jobs/engagement-pending — published jobs with a usable permalink. */
  @Get('engagement-pending')
  async getEngagementPendingPosts(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Query('limit') limit?: string,
    @Query('postId') postId?: string,
    @Query('manualOnly') manualOnly?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
    );
    if (!connection) return [];
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
    const manualOnlyRequested = manualOnly === 'true';
    const engagementFilter = {
      status: 'SUCCESS',
      submissionStatus: FacebookSubmissionStatus.PUBLISHED,
      postUrl: { $exists: true, $ne: '' },
      facebookConnectionId: connection._id,
      $and: [
        publishableTargetFilter,
        manualOnlyRequested
          ? this.manualMaintenanceRequestFilter(MaintenanceClaimType.ENGAGEMENT)
          : {
              $or: [
                this.manualMaintenanceRequestFilter(
                  MaintenanceClaimType.ENGAGEMENT,
                ),
                ...getEngagementQueueFilter(now).$or,
              ],
            },
        this.maintenanceClaimAvailableFilter(now),
      ],
      ...(requestedPostId
        ? { postId: requestedPostId }
        : { postId: { $in: postIds } }),
    };

    const jobs: EngagementJobLean[] = [];
    for (let index = 0; index < batchLimit; index += 1) {
      const maintenanceClaimToken = randomUUID();
      const claimedJob = await this.jobModel
        .findOneAndUpdate(
          engagementFilter as any,
          {
            $set: {
              maintenanceClaimedByExtensionInstanceId:
                normalizedInstanceId,
              maintenanceClaimType: MaintenanceClaimType.ENGAGEMENT,
              maintenanceClaimToken,
              maintenanceClaimExpiresAt: new Date(
                now.getTime() + JobsController.MAINTENANCE_CLAIM_LEASE_MS,
              ),
            },
          },
          {
            new: true,
            sort: {
              lastEngagementSyncAt: 1,
              publishedDetectedAt: 1,
              createdAt: 1,
              _id: 1,
            },
          },
        )
        .lean<EngagementJobLean>()
        .exec();
      if (!claimedJob) break;
      jobs.push(claimedJob);
    }

    return jobs.map((job) => ({
      id: job._id.toString(),
      status: FacebookSubmissionStatus.PUBLISHED,
      targetType: job.targetType ?? PublishingTargetType.GROUP,
      postUrl: job.postUrl!,
      ...(job.lastEngagementSyncAt
        ? { lastEngagementSyncAt: job.lastEngagementSyncAt.toISOString() }
        : {}),
      ...(job.nextEngagementSyncAt
        ? { nextEngagementSyncAt: job.nextEngagementSyncAt.toISOString() }
        : {}),
      ...(job.maintenanceClaimToken
        ? { claimToken: job.maintenanceClaimToken }
        : {}),
    }));
  }

  /** POST /api/jobs/:id/maintenance-claim — claim one manual maintenance job before opening Facebook. */
  @Post(':id/maintenance-request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestMaintenance(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
    @Body() body: { type?: MaintenanceClaimType },
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    if (
      body?.type !== MaintenanceClaimType.PENDING_APPROVAL &&
      body?.type !== MaintenanceClaimType.ENGAGEMENT
    ) {
      throw new BadRequestException('Invalid maintenance request type');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    if (!job.facebookConnectionId) {
      throw new BadRequestException(
        'Job is not assigned to a Facebook connection',
      );
    }
    if (job.status !== PublishingJobStatus.SUCCESS) {
      throw new BadRequestException('Job is not ready for maintenance refresh');
    }

    const requestedAt = new Date();
    if (body.type === MaintenanceClaimType.PENDING_APPROVAL) {
      const pendingEligible =
        job.targetType !== PublishingTargetType.PROFILE_FEED &&
        Boolean(job.groupId) &&
        (job.submissionStatus === FacebookSubmissionStatus.PENDING_APPROVAL ||
          (job.submissionStatus === FacebookSubmissionStatus.PUBLISHED &&
            isPendingFacebookPostUrl(job.postUrl)));
      if (!pendingEligible) {
        throw new BadRequestException(
          'Job is not awaiting Facebook approval',
        );
      }
      job.manualPendingSyncRequestedAt = requestedAt;
    } else {
      if (
        job.submissionStatus !== FacebookSubmissionStatus.PUBLISHED ||
        !job.postUrl
      ) {
        throw new BadRequestException('Job is not a published Facebook post');
      }
      job.manualEngagementSyncRequestedAt = requestedAt;
    }

    await job.save();
    return {
      id: job._id.toString(),
      type: body.type,
      status: 'QUEUED',
      requestedAt: requestedAt.toISOString(),
    };
  }

  /** POST /api/jobs/:id/maintenance-claim — claim one manual maintenance job before opening Facebook. */
  @Post(':id/maintenance-claim')
  @HttpCode(HttpStatus.OK)
  async claimMaintenanceJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Param('id') id: string,
    @Body() body: { type?: MaintenanceClaimType },
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    if (
      body?.type !== MaintenanceClaimType.PENDING_APPROVAL &&
      body?.type !== MaintenanceClaimType.ENGAGEMENT
    ) {
      throw new BadRequestException('Invalid maintenance claim type');
    }
    return this.claimSpecificMaintenanceJob(
      clerkUserId,
      extensionInstanceId,
      id,
      body.type,
    );
  }

  @Get(':id')
  async getJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    await this.assertWorkerOwnsJob(clerkUserId, extensionInstanceId, job);
    return {
      id: job._id.toString(),
      status: job.status,
    };
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
    await this.assertMaintenanceClaim(
      clerkUserId,
      extensionInstanceId,
      job,
      MaintenanceClaimType.ENGAGEMENT,
      body.claimToken,
    );
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
    this.releaseMaintenanceClaim(job, MaintenanceClaimType.ENGAGEMENT);
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
      status:
        | 'PUBLISHED'
        | 'STILL_PENDING'
        | 'CHECK_FAILED'
        | 'CONTENT_MATCHED';
      postUrl?: string;
      reason?: string;
      claimToken?: string;
    },
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    if (
      !['PUBLISHED', 'STILL_PENDING', 'CHECK_FAILED', 'CONTENT_MATCHED'].includes(
        body.status,
      )
    ) {
      throw new BadRequestException('Invalid pending sync result');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    if (job.targetType === PublishingTargetType.PROFILE_FEED) {
      throw new BadRequestException(
        'Pending-approval sync is only supported for Group jobs',
      );
    }
    await this.assertMaintenanceClaim(
      clerkUserId,
      extensionInstanceId,
      job,
      MaintenanceClaimType.PENDING_APPROVAL,
      body.claimToken,
    );
    if (body.status === 'CONTENT_MATCHED') {
      this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
      await job.save();
      return job;
    }
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
        this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
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
        this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
        await job.save();
      } else {
        this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
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
      this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
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
      this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
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

    this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
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
    const allowedStatuses = new Set<string>([
      PublishingJobStatus.PENDING,
      PublishingJobStatus.RUNNING,
      PublishingJobStatus.SUCCESS,
      PublishingJobStatus.FAILED,
      PublishingJobStatus.CANCELED,
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

    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const workerConnection = await this.assertWorkerOwnsJob(
      clerkUserId,
      normalizedInstanceId,
      job,
    );
    const workerConnectionId = workerConnection._id;

    const previousStatus = job.status;
    if (
      body.status === PublishingJobStatus.CANCELED &&
      previousStatus !== PublishingJobStatus.CANCEL_REQUESTED
    ) {
      throw new BadRequestException(
        'Only cancel-requested jobs can be canceled',
      );
    }
    if (
      previousStatus === PublishingJobStatus.CANCEL_REQUESTED &&
      body.status !== PublishingJobStatus.SUCCESS &&
      body.status !== PublishingJobStatus.FAILED &&
      body.status !== PublishingJobStatus.CANCELED
    ) {
      throw new BadRequestException('Job cancellation was requested');
    }
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
    job.error =
      body.status === PublishingJobStatus.FAILED ? body.error : undefined;
    if (normalizedInstanceId && body.status === PublishingJobStatus.RUNNING) {
      job.claimedByExtensionInstanceId = normalizedInstanceId;
      job.claimExpiresAt = new Date(
        Date.now() + JobsController.JOB_CLAIM_LEASE_MS,
      );
    } else if (
      normalizedInstanceId &&
      (body.status === PublishingJobStatus.SUCCESS ||
        body.status === PublishingJobStatus.FAILED ||
        body.status === PublishingJobStatus.CANCELED)
    ) {
      job.claimedByExtensionInstanceId = undefined;
      job.claimExpiresAt = undefined;
    }
    if (workerConnectionId && body.status === PublishingJobStatus.RUNNING) {
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
      (body.status === PublishingJobStatus.SUCCESS ||
        body.status === PublishingJobStatus.FAILED ||
        body.status === PublishingJobStatus.CANCELED)
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
      const effectiveSubmissionStatus =
        normalizedSubmissionPostUrl &&
        isPendingFacebookPostUrl(normalizedSubmissionPostUrl)
          ? FacebookSubmissionStatus.PENDING_APPROVAL
          : body.submissionResult.status;
      let duplicatePermalink = false;
      if (
        normalizedSubmissionPostUrl &&
        (effectiveSubmissionStatus === FacebookSubmissionStatus.PUBLISHED ||
          effectiveSubmissionStatus ===
            FacebookSubmissionStatus.PENDING_APPROVAL)
      ) {
        const duplicateTargetFilter =
          job.targetType === PublishingTargetType.PROFILE_FEED
            ? {
                targetType: PublishingTargetType.PROFILE_FEED,
                facebookConnectionId: job.facebookConnectionId,
              }
            : {
                ...groupOrLegacyTargetFilter,
                groupId: job.groupId,
              };
        const existingJobWithPermalink = await this.jobModel
          .findOne({
            _id: { $ne: job._id },
            ...duplicateTargetFilter,
            postUrl: normalizedSubmissionPostUrl,
          })
          .select('_id')
          .lean()
          .exec();
        duplicatePermalink = Boolean(existingJobWithPermalink);
      }

      job.submissionStatus = duplicatePermalink
        ? FacebookSubmissionStatus.UNKNOWN
        : effectiveSubmissionStatus;
      // A later retry may report the status without repeating the permalink.
      // Never erase a URL that was already captured successfully.
      if (
        !duplicatePermalink &&
        (effectiveSubmissionStatus === FacebookSubmissionStatus.PUBLISHED ||
          effectiveSubmissionStatus ===
            FacebookSubmissionStatus.PENDING_APPROVAL) &&
        normalizedSubmissionPostUrl
      ) {
        job.postUrl = normalizedSubmissionPostUrl;
      }
      if (effectiveSubmissionStatus === FacebookSubmissionStatus.UNKNOWN) {
        job.postUrl = undefined;
      }
      job.submissionReason = duplicatePermalink
        ? `Facebook returned a permalink already assigned to another job in this ${
            job.targetType === PublishingTargetType.PROFILE_FEED
              ? 'profile feed'
              : 'group'
          }`
        : effectiveSubmissionStatus === FacebookSubmissionStatus.UNKNOWN
          ? body.submissionResult.reason
          : undefined;

      if (
        !duplicatePermalink &&
        effectiveSubmissionStatus === FacebookSubmissionStatus.PENDING_APPROVAL &&
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
        effectiveSubmissionStatus === FacebookSubmissionStatus.PUBLISHED
      ) {
        job.publishedDetectedAt ??= new Date();
      }
    }

    // Increment attempts if it just finished (success or fail)
    if (
      (body.status === PublishingJobStatus.SUCCESS ||
        body.status === PublishingJobStatus.FAILED) &&
      previousStatus !== PublishingJobStatus.SUCCESS &&
      previousStatus !== PublishingJobStatus.FAILED
    ) {
      job.attempts = (job.attempts || 0) + 1;
      job.completedAt = new Date();
    } else if (body.status === PublishingJobStatus.CANCELED) {
      job.completedAt = new Date();
    } else if (body.status === PublishingJobStatus.RUNNING) {
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

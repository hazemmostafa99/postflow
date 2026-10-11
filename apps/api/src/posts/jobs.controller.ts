import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import {
  FACEBOOK_ENGAGEMENT_PERMALINK_PATTERN,
  INSTAGRAM_ENGAGEMENT_PERMALINK_PATTERN,
  getEngagementQueueFilter,
  getPlatformEngagementQueueFilter,
  isInstagramEngagementPermalink,
  isTikTokEngagementPermalink,
} from './engagement-eligibility';
import {
  FacebookConnection,
  FacebookConnectionDocument,
  FacebookConnectionStatus,
  FacebookConnectionWorkerStatus,
} from '../schemas/facebook-connection.schema';
import {
  PlatformConnection,
  PlatformConnectionDocument,
  PlatformConnectionStatus,
  PlatformConnectionWorkerStatus,
} from '../schemas/platform-connection.schema';
import { PublishingPlatform } from '../schemas/publishing-platform';
import {
  ExtensionInstallationDocument,
  ExtensionLifecycleStatus,
} from '../schemas/extension-installation.schema';
import { ExtensionsService } from '../extensions/extensions.service';
import { toPublishJobPayload } from './publish-job-payload';
import {
  createJobMediaAccessGrant,
  decodeJobMediaDataUrl,
  verifyJobMediaAccessToken,
} from './job-media-delivery';
import { isTikTokPublishingEnabled } from './tiktok-publishing-policy';

type PostEngagementSyncResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
  reactionCount?: number;
  commentCount?: number;
  favoriteCount?: number;
  shareCount?: number;
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
  platform?: PublishingPlatform;
  platformConnectionId?: { toString(): string };
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

const platformPublishableTargetFilter = {
  $or: [
    {
      platform: PublishingPlatform.FACEBOOK,
      targetType: {
        $in: [PublishingTargetType.GROUP, PublishingTargetType.PROFILE_FEED],
      },
    },
    {
      platform: PublishingPlatform.INSTAGRAM,
      targetType: {
        $in: [
          PublishingTargetType.INSTAGRAM_FEED,
          PublishingTargetType.INSTAGRAM_REEL,
        ],
      },
    },
    {
      platform: PublishingPlatform.TIKTOK,
      targetType: { $in: [PublishingTargetType.TIKTOK_VIDEO, PublishingTargetType.TIKTOK_PHOTO] },
    },
    {
      platform: { $exists: false },
      $or: publishableTargetFilter.$or,
    },
    {
      platform: null,
      $or: publishableTargetFilter.$or,
    },
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

function normalizeInstagramPostUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return undefined;
    const match = url.pathname.match(/^\/(?:[^/]+\/)?(p|reels?)\/([^/]+)\/?$/i);
    if (!match) return undefined;
    const kind = match[1].toLowerCase() === 'p' ? 'p' : 'reel';
    return `https://www.instagram.com/${kind}/${match[2]}/`;
  } catch {
    return undefined;
  }
}

function normalizeSubmissionPostUrl(
  platform: PublishingPlatform,
  value?: string,
): string | undefined {
  if (platform === PublishingPlatform.TIKTOK) {
    try {
      const url = new URL(value ?? '');
      const match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d+)\/?$/);
      return url.protocol === 'https:' && !url.username && !url.password && ['tiktok.com', 'www.tiktok.com'].includes(url.hostname) && match
        ? `https://www.tiktok.com/@${match[1]}/${match[2].toLowerCase()}/${match[3]}` : undefined;
    } catch { return undefined; }
  }
  return platform === PublishingPlatform.INSTAGRAM
    ? normalizeInstagramPostUrl(value)
    : normalizeFacebookGroupPostUrl(value);
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

function maskExtensionInstanceId(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) return 'missing';
  if (normalized.length <= 8)
    return `${normalized.slice(0, 2)}…${normalized.slice(-2)}`;
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

function parseBearerToken(value?: string): string | null {
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/);
  return match?.[1] ?? null;
}

@Controller('api/jobs')
export class JobsController {
  private static readonly JOB_CLAIM_LEASE_MS = 15 * 60 * 1000;
  private static readonly MAINTENANCE_CLAIM_LEASE_MS = 5 * 60 * 1000;
  private readonly logger = new Logger(JobsController.name);

  constructor(
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(PostSchema.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(FacebookConnection.name)
    private readonly connectionModel: Model<FacebookConnectionDocument>,
    private readonly extensionsService: ExtensionsService,
    @InjectModel(PlatformConnection.name)
    private readonly platformConnectionModel?: Model<PlatformConnectionDocument>,
  ) {}

  private logMaintenanceEvent(
    event: string,
    details: Record<string, string | number | boolean | null | undefined>,
    level: 'log' | 'warn' = 'log',
  ) {
    const payload = JSON.stringify({ event, ...details });
    if (level === 'warn') this.logger.warn(payload);
    else this.logger.log(payload);
  }

  private logMaintenanceResult(
    job: PublishingJobDocument,
    workType: MaintenanceClaimType,
    resultStatus: string,
    extensionInstanceId?: string,
    receivedEngagement?: Pick<PostEngagementSyncResult, 'reactionCount' | 'commentCount' | 'favoriteCount' | 'shareCount'>,
  ) {
    const retryAt =
      workType === MaintenanceClaimType.PENDING_APPROVAL
        ? job.nextCheckAt
        : job.nextEngagementSyncAt;
    this.logMaintenanceEvent('maintenance.result.accepted', {
      jobId: String(job._id ?? 'unknown'),
      workType,
      connectionId: String(job.platformConnectionId ?? job.facebookConnectionId),
      extensionInstanceId: maskExtensionInstanceId(extensionInstanceId),
      resultStatus,
      ...(workType === MaintenanceClaimType.ENGAGEMENT ? {
        receivedReactionCount: receivedEngagement?.reactionCount,
        receivedCommentCount: receivedEngagement?.commentCount,
        receivedFavoriteCount: receivedEngagement?.favoriteCount,
        receivedShareCount: receivedEngagement?.shareCount,
        storedReactionCount: job.engagement?.reactionCount,
        storedCommentCount: job.engagement?.commentCount,
        storedFavoriteCount: job.engagement?.favoriteCount,
        storedShareCount: job.engagement?.shareCount,
      } : {}),
      retryAt: retryAt?.toISOString(),
    });
  }

  /**
   * Resolves the worker's verified connection for a worker action.
   *
   * Gate order is strict and fails closed:
   *  1. The installation must exist, not be revoked, and present a valid
   *     installation credential (verifyWorkerIdentity).
   *  2. New claims additionally require an ACTIVE lifecycle.
   *  3. The connection must come from the installation resolution (owned by
   *     the user, unarchived, and the active binding of this installation).
   *  4. The Facebook session identity must still be verified.
   */
  private async getVerifiedWorkerConnection(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    credential: string | undefined,
    options: { requireActive: boolean } = { requireActive: true },
  ): Promise<FacebookConnectionDocument | null> {
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId) return null;
    const installation = await this.extensionsService.verifyWorkerIdentity(
      clerkUserId,
      normalizedInstanceId,
      credential,
    );
    if (options.requireActive) {
      this.extensionsService.assertInstallationActive(installation);
    }
    const connection = await this.extensionsService.resolveActiveWorkerConnection(
      clerkUserId,
      installation,
    );
    if (!connection) return null;
    const verified = Boolean(
      connection.status === FacebookConnectionStatus.CONNECTED &&
      connection.facebookSessionDetected &&
      connection.facebookUserId &&
      connection.detectedFacebookUserId &&
      connection.facebookUserId === connection.detectedFacebookUserId,
    );
    return verified ? connection : null;
  }

  /**
   * Platform-aware version of getVerifiedWorkerConnection.
   * Resolves the active PlatformConnection for a job's platform.
   * Supports both legacy Facebook jobs (using facebookConnectionId) and new
   * platform jobs (using platformConnectionId).
   */
  private async getVerifiedPlatformConnection(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    credential: string | undefined,
    platform: PublishingPlatform,
    platformConnectionId?: Types.ObjectId,
    facebookConnectionId?: Types.ObjectId,
    options: { requireActive: boolean } = { requireActive: true },
  ): Promise<{ platformConnection: PlatformConnectionDocument | null; facebookConnection: FacebookConnectionDocument | null }> {
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId) return { platformConnection: null, facebookConnection: null };

    const installation = await this.extensionsService.verifyWorkerIdentity(
      clerkUserId,
      normalizedInstanceId,
      credential,
    );
    if (options.requireActive) {
      this.extensionsService.assertInstallationActive(installation);
    }

    // For Facebook jobs with legacy facebookConnectionId, verify via Facebook connection
    if (platform === PublishingPlatform.FACEBOOK && facebookConnectionId) {
      const fbConnection = await this.connectionModel.findById(facebookConnectionId).exec();
      if (!fbConnection) return { platformConnection: null, facebookConnection: null };

      // Verify this installation owns the connection
      if (
        fbConnection.activeExtensionInstallationId &&
        String(fbConnection.activeExtensionInstallationId) !== String(installation._id)
      ) {
        return { platformConnection: null, facebookConnection: null };
      }

      const verified = Boolean(
        fbConnection.status === FacebookConnectionStatus.CONNECTED &&
        fbConnection.facebookSessionDetected &&
        fbConnection.facebookUserId &&
        fbConnection.detectedFacebookUserId &&
        fbConnection.facebookUserId === fbConnection.detectedFacebookUserId,
      );

      // Also get the platform connection for status updates
      const pc = fbConnection._id && this.platformConnectionModel
        ? await this.platformConnectionModel
            .findOne({ legacyFacebookConnectionId: fbConnection._id })
            .exec()
        : null;

      return verified ? { platformConnection: pc, facebookConnection: fbConnection } : { platformConnection: null, facebookConnection: null };
    }

    // For new platform jobs (Instagram, TikTok, or migrated Facebook), use platformConnectionId
    if (platformConnectionId) {
      // A job is bound to one concrete connection record. Do not resolve by
      // platform here: an installation can have more than one active/recreated
      // connection for the same platform, and a platform-level lookup may pick
      // a different record than the one used when the job was claimed.
      const pc = this.platformConnectionModel
        ? await this.platformConnectionModel
            .findOne({
              _id: platformConnectionId,
              clerkUserId,
              platform,
              activeExtensionInstallationId: installation._id,
              archivedAt: { $exists: false },
            })
            .exec()
        : null;
      if (!pc) {
        return { platformConnection: null, facebookConnection: null };
      }

      // Verify platform connection status
      const identityVerified = platform === PublishingPlatform.INSTAGRAM
        ? Boolean(
            (pc.externalAccountId && pc.detectedExternalAccountId &&
              pc.externalAccountId === pc.detectedExternalAccountId) ||
            (!pc.externalAccountId && (!pc.externalUsername || Boolean(
              pc.detectedExternalUsername &&
                pc.externalUsername.toLowerCase() === pc.detectedExternalUsername.toLowerCase(),
            )))
          )
        : !pc.externalUsername || Boolean(
            pc.detectedExternalUsername &&
              pc.externalUsername.toLowerCase() ===
                pc.detectedExternalUsername.toLowerCase(),
          );
      const verified = pc.status === PlatformConnectionStatus.CONNECTED &&
        pc.sessionDetected &&
        identityVerified;

      return verified ? { platformConnection: pc, facebookConnection: null } : { platformConnection: null, facebookConnection: null };
    }

    return { platformConnection: null, facebookConnection: null };
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
    credential: string | undefined,
    job: PublishingJobDocument,
    options: { requireActive: boolean } = { requireActive: true },
  ): Promise<FacebookConnectionDocument | PlatformConnectionDocument> {
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );

    // New platform jobs are owned by a generic PlatformConnection. Keep the
    // legacy Facebook branch below intact for older jobs and maintenance work.
    if (job.platformConnectionId && this.platformConnectionModel) {
      const resolved = await this.getVerifiedPlatformConnection(
        clerkUserId,
        normalizedInstanceId,
        credential,
        job.platform ?? PublishingPlatform.FACEBOOK,
        job.platformConnectionId,
        job.facebookConnectionId,
        options,
      );
      // Legacy Facebook jobs still use their FacebookConnection for
      // maintenance/status updates even when a compatibility PlatformConnection
      // is linked alongside them.
      const connection = resolved.facebookConnection ?? resolved.platformConnection;
      if (!connection) {
        this.logger.warn('[TikTok] publishing ownership rejected', {
          jobId: String(job._id ?? 'unknown'),
          platformConnectionId: String(job.platformConnectionId),
          platform: job.platform ?? PublishingPlatform.FACEBOOK,
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'INSTALLATION_NOT_LINKED_OR_IDENTITY_UNVERIFIED',
        });
        throw new UnauthorizedException(
          'Extension instance is not linked to the verified platform connection for this job',
        );
      }
      return connection;
    }

    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
      credential,
      options,
    );
    if (!connection) {
      this.logMaintenanceEvent(
        'maintenance.ownership.rejected',
        {
          jobId: String(job._id ?? 'unknown'),
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'UNVERIFIED_CONNECTION',
        },
        'warn',
      );
      throw new UnauthorizedException(
        'Extension instance is not linked to a verified Facebook connection',
      );
    }
    if (String(job.facebookConnectionId) !== String(connection._id)) {
      this.logMaintenanceEvent(
        'maintenance.ownership.rejected',
        {
          jobId: String(job._id ?? 'unknown'),
          connectionId: String(connection._id),
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'CONNECTION_MISMATCH',
        },
        'warn',
      );
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
    credential: string | undefined,
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
      credential,
      job,
      { requireActive: false },
    );

    const hasClaim = Boolean(
      job.maintenanceClaimType ||
        job.maintenanceClaimToken ||
        job.maintenanceClaimExpiresAt,
    );
    if (!hasClaim) {
      this.logMaintenanceEvent(
        'maintenance.lease.conflict',
        {
          jobId: String(job._id ?? 'unknown'),
          workType: claimType,
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'CLAIM_MISSING',
        },
        'warn',
      );
      throw new UnauthorizedException('Maintenance claim required');
    }

    const claimExpired = Boolean(
      job.maintenanceClaimExpiresAt &&
        job.maintenanceClaimExpiresAt.getTime() <= Date.now(),
    );
    if (claimExpired) {
      this.logMaintenanceEvent(
        'maintenance.lease.expired',
        {
          jobId: String(job._id ?? 'unknown'),
          workType: claimType,
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'CLAIM_EXPIRED',
        },
        'warn',
      );
      throw new UnauthorizedException('Invalid or expired maintenance claim');
    }

    if (
      job.maintenanceClaimType !== claimType ||
      job.maintenanceClaimedByExtensionInstanceId !== normalizedInstanceId ||
      !claimToken ||
      claimToken !== job.maintenanceClaimToken ||
      !job.maintenanceClaimExpiresAt
    ) {
      this.logMaintenanceEvent(
        'maintenance.lease.conflict',
        {
          jobId: String(job._id ?? 'unknown'),
          workType: claimType,
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'CLAIM_MISMATCH',
        },
        'warn',
      );
      throw new UnauthorizedException('Invalid or expired maintenance claim');
    }
    return connection;
  }

  private async claimSpecificMaintenanceJob(
    clerkUserId: string,
    extensionInstanceId: string | undefined,
    credential: string | undefined,
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
      credential,
      job,
    );
    const now = new Date();
    const instagramJob = job.platform === PublishingPlatform.INSTAGRAM ||
      job.targetType === PublishingTargetType.INSTAGRAM_FEED ||
      job.targetType === PublishingTargetType.INSTAGRAM_REEL;
    const tiktokJob = job.platform === PublishingPlatform.TIKTOK ||
      job.targetType === PublishingTargetType.TIKTOK_VIDEO ||
      job.targetType === PublishingTargetType.TIKTOK_PHOTO;
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
            postUrl: {
              $regex: instagramJob
                ? INSTAGRAM_ENGAGEMENT_PERMALINK_PATTERN
                : FACEBOOK_ENGAGEMENT_PERMALINK_PATTERN,
            },
          };
    const ownershipFilter = job.platformConnectionId && this.platformConnectionModel
      ? { platformConnectionId: job.platformConnectionId }
      : { facebookConnectionId: connection._id };
    const maintenanceClaimToken = randomUUID();
    const claimedJob = await this.jobModel
      .findOneAndUpdate(
        {
          _id: job._id,
          ...ownershipFilter,
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
      this.logMaintenanceEvent(
        'maintenance.lease.conflict',
        {
          jobId: id,
          workType: claimType,
          connectionId: String(connection._id),
          extensionInstanceId: maskExtensionInstanceId(extensionInstanceId),
          reasonCode: 'JOB_UNAVAILABLE_OR_CLAIMED',
        },
        'warn',
      );
      throw new UnauthorizedException(
        'Job is unavailable or already claimed by another worker',
      );
    }

    this.logMaintenanceEvent('maintenance.claim.created', {
      jobId: claimedJob._id.toString(),
      workType: claimType,
      connectionId: String(connection._id),
      extensionInstanceId: maskExtensionInstanceId(extensionInstanceId),
      manualOnly: true,
    });

    if (claimType === MaintenanceClaimType.ENGAGEMENT) {
      return {
        id: claimedJob._id.toString(),
        status: FacebookSubmissionStatus.PUBLISHED,
        ...(claimedJob.platform ? { platform: claimedJob.platform } : {}),
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
  @Post(':id/submission-intent')
  async armTikTokSubmission(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string,
    @Headers('x-extension-credential') credential: string,
    @Param('id') id: string,
  ) {
    if (!isTikTokPublishingEnabled()) throw new ForbiddenException('TikTok publishing is disabled');
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    if ((job.postId as unknown as PostDocument).clerkUserId !== clerkUserId || job.platform !== PublishingPlatform.TIKTOK) {
      throw new UnauthorizedException('Not an owned TikTok job');
    }
    await this.assertWorkerOwnsJob(clerkUserId, extensionInstanceId, credential, job);
    const now = new Date();
    // Atomic, single-use permission. Persist before Post, never after it.
    const armed = await this.jobModel.findOneAndUpdate({
      _id: job._id, platform: PublishingPlatform.TIKTOK, status: PublishingJobStatus.RUNNING,
      claimedByExtensionInstanceId: extensionInstanceId, claimExpiresAt: { $gt: now },
      submittedAt: { $exists: false }, submissionStatus: { $nin: ['UNKNOWN', 'PROCESSING', 'PUBLISHED'] },
    } as any, { $set: { submittedAt: now, submissionStatus: FacebookSubmissionStatus.UNKNOWN,
      submissionReason: 'Post submission armed; reconcile manually if the worker result is lost' } }, { new: true }).exec();
    return { allowed: Boolean(armed) };
  }

  @Get('next')
  async getNextJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Query('manualRetry') manualRetry?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');

    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const manualRetryOnly = manualRetry === 'true';

    // Keep the legacy unit-test/consumer contract safe while the generic model
    // is rolled out. The application modules always provide this model; an
    // older direct controller harness may not.
    if (!this.platformConnectionModel) {
      const connection = await this.getVerifiedWorkerConnection(
        clerkUserId,
        normalizedInstanceId,
        credential,
      );
      if (!connection) return null;
      return this.claimLegacyFacebookJob(
        clerkUserId,
        normalizedInstanceId,
        connection._id,
        manualRetryOnly,
      );
    }

    // Verify installation identity first
    const installation = await this.extensionsService.verifyWorkerIdentity(
      clerkUserId,
      normalizedInstanceId,
      credential,
    );
    this.extensionsService.assertInstallationActive(installation);

    // Find all platform connections owned by this installation. A PUBLISHING
    // worker flag is only a valid queue lock while its job lease is active;
    // interrupted extension flows can otherwise leave the connection hidden
    // forever even though the queued job is still PENDING.
    const platformConnections = await this.platformConnectionModel
      .find({
        clerkUserId,
        activeExtensionInstallationId: installation._id,
        archivedAt: { $exists: false },
        status: PlatformConnectionStatus.CONNECTED,
      })
      .select('_id platform legacyFacebookConnectionId workerStatus')
      .lean()
      .exec();

    // A single installation can own a legacy Facebook connection and a newer
    // Instagram platform connection. Resolve Facebook independently instead
    // of deriving it only from platformConnections; otherwise adding
    // Instagram makes legacy Facebook jobs invisible to the worker.
    const legacyFacebookConnection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
      credential,
    );

    const now = new Date();
    const publishingConnectionIds = platformConnections
      .filter((pc) => pc.workerStatus === PlatformConnectionWorkerStatus.PUBLISHING)
      .map((pc) => pc._id as Types.ObjectId);
    const activePublishingConnectionIds = publishingConnectionIds.length > 0
      ? await this.jobModel.distinct('platformConnectionId', {
        platformConnectionId: { $in: publishingConnectionIds },
        status: PublishingJobStatus.RUNNING,
        claimExpiresAt: { $gt: now },
      })
      : [];
    const activePublishingConnectionIdSet = new Set(
      activePublishingConnectionIds.map((id: Types.ObjectId) => String(id)),
    );
    const stalePublishingConnections = platformConnections.filter((pc) =>
      pc.workerStatus === PlatformConnectionWorkerStatus.PUBLISHING &&
      !activePublishingConnectionIdSet.has(String(pc._id)),
    );
    if (stalePublishingConnections.length > 0) {
      const staleIds = stalePublishingConnections.map((pc) => pc._id as Types.ObjectId);
      await this.platformConnectionModel.updateMany(
        {
          _id: { $in: staleIds },
          activeExtensionInstallationId: installation._id,
          status: PlatformConnectionStatus.CONNECTED,
          workerStatus: PlatformConnectionWorkerStatus.PUBLISHING,
        },
        { $set: { workerStatus: PlatformConnectionWorkerStatus.IDLE, lastSeenAt: now } },
      ).exec();
      this.logger.warn('[Publishing] cleared stale PUBLISHING worker status', {
        platformConnectionIds: staleIds.map(String),
        reason: 'NO_ACTIVE_JOB_LEASE',
      });
    }
    const claimablePlatformConnections = platformConnections.filter((pc) =>
      !activePublishingConnectionIdSet.has(String(pc._id)),
    );

    if (claimablePlatformConnections.length === 0) {
      if (!legacyFacebookConnection) return null;

      // Legacy path for backward compatibility
      return this.claimLegacyFacebookJob(
        clerkUserId,
        normalizedInstanceId,
        legacyFacebookConnection._id,
        manualRetryOnly,
      );
    }

    // Build platform connection IDs by platform
    const platformConnectionIdsByPlatform = new Map<string, Types.ObjectId[]>();
    for (const pc of claimablePlatformConnections) {
      const arr = platformConnectionIdsByPlatform.get(pc.platform) || [];
      arr.push(pc._id as Types.ObjectId);
      platformConnectionIdsByPlatform.set(pc.platform, arr);
    }

    // First find all posts belonging to this user
    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean<LeanId[]>()
      .exec();
    const postIds = posts.map((p) => p._id.toString());

    if (postIds.length === 0) return null;

    const leaseExpiresAt = new Date(now.getTime() + JobsController.JOB_CLAIM_LEASE_MS);
    const mediaGrant = createJobMediaAccessGrant(leaseExpiresAt);

    // Build query for platform-aware jobs
    const platformConnectionIds = claimablePlatformConnections.map((pc) => pc._id);
    const legacyFacebookConnectionIds = claimablePlatformConnections
      .filter((pc) => pc.platform === PublishingPlatform.FACEBOOK)
      .map((pc) => pc.legacyFacebookConnectionId)
      .filter((id): id is Types.ObjectId => !!id);
    if (
      legacyFacebookConnection &&
      !legacyFacebookConnectionIds.some(
        (id) => String(id) === String(legacyFacebookConnection._id),
      )
    ) {
      legacyFacebookConnectionIds.push(legacyFacebookConnection._id);
    }

    const ownershipFilter = {
      $or: [
        { platformConnectionId: { $in: platformConnectionIds } },
        ...(legacyFacebookConnectionIds.length > 0
          ? [{ facebookConnectionId: { $in: legacyFacebookConnectionIds } }]
          : []),
      ],
    };

    const supportedTargetFilter = {
      $or: platformPublishableTargetFilter.$or.filter((branch) =>
        branch.platform !== PublishingPlatform.TIKTOK ||
        isTikTokPublishingEnabled(),
      ),
    };

    const job = (await this.jobModel
      .findOneAndUpdate(
        {
          postId: { $in: postIds },
          $and: [
            ownershipFilter,
            supportedTargetFilter,
            { $or: [
              { platform: { $ne: PublishingPlatform.TIKTOK }, targetType: { $nin: [PublishingTargetType.TIKTOK_VIDEO, PublishingTargetType.TIKTOK_PHOTO] } },
              { submittedAt: { $exists: false }, submissionStatus: { $nin: ['UNKNOWN', 'PROCESSING', 'PUBLISHED'] } },
            ] },
            ...(manualRetryOnly ? [{ manualRetryRequestedAt: { $exists: true } }] : []),
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
            mediaAccessTokenHash: mediaGrant.tokenHash,
            mediaAccessExpiresAt: mediaGrant.expiresAt,
            startedAt: now,
          },
          ...(manualRetryOnly ? { $unset: { manualRetryRequestedAt: 1 } } : {}),
        },
        {
          new: true,
          sort: { scheduledFor: 1, flowOrder: 1, createdAt: 1 },
        },
      )
      .populate('postId', 'content mediaUrls')
      .populate('groupId', 'name url externalId')
      .populate(
        'platformConnectionId',
        'platform displayName externalAccountId externalUsername detectedExternalAccountId detectedExternalUsername',
      )
      .populate(
        'facebookConnectionId',
        'displayName facebookUserId detectedFacebookUserId',
      )
      .exec()) as PublishingJobDocument | null;

    if (!job) return null;

    if (job.platform === PublishingPlatform.TIKTOK ||
      job.targetType === PublishingTargetType.TIKTOK_VIDEO || job.targetType === PublishingTargetType.TIKTOK_PHOTO) {
      this.logger.log('[TikTok] publishing job claimed', {
        jobId: String(job._id),
        platformConnectionId: job.platformConnectionId ? String(job.platformConnectionId) : null,
        extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
      });
    }

    return toPublishJobPayload(job, {
      mediaAccessToken: mediaGrant.accessToken,
    });
  }

  /**
   * Legacy path for claiming Facebook jobs via facebookConnectionId.
   * Used when an installation only has a legacy Facebook connection.
   */
  private async claimLegacyFacebookJob(
    clerkUserId: string,
    normalizedInstanceId: string,
    facebookConnectionId: Types.ObjectId,
    manualRetryOnly = false,
  ) {
    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean<LeanId[]>()
      .exec();
    const postIds = posts.map((p) => p._id.toString());

    if (postIds.length === 0) return null;

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + JobsController.JOB_CLAIM_LEASE_MS);

    const job = (await this.jobModel
      .findOneAndUpdate(
        {
          facebookConnectionId,
          postId: { $in: postIds },
          $and: [
            publishableTargetFilter,
            ...(manualRetryOnly ? [{ manualRetryRequestedAt: { $exists: true } }] : []),
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
          ...(manualRetryOnly ? { $unset: { manualRetryRequestedAt: 1 } } : {}),
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
    @Headers('x-extension-credential') credential?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    const connection = await this.getVerifiedWorkerConnection(
      clerkUserId,
      normalizedInstanceId,
      credential,
    );
    if (!connection) {
      this.logMaintenanceEvent(
        'maintenance.ownership.rejected',
        {
          workType: MaintenanceClaimType.PENDING_APPROVAL,
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'UNVERIFIED_CONNECTION',
        },
        'warn',
      );
      return [];
    }

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
      this.logMaintenanceEvent('maintenance.claim.created', {
        jobId: claimedJob._id.toString(),
        workType: MaintenanceClaimType.PENDING_APPROVAL,
        connectionId: String(connection._id),
        extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
        manualOnly: manualOnlyRequested,
      });
    }

    if (jobs.length === 0) {
      this.logMaintenanceEvent('maintenance.claim.empty', {
        workType: MaintenanceClaimType.PENDING_APPROVAL,
        connectionId: String(connection._id),
        extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
        manualOnly: manualOnlyRequested,
      });
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
    @Query('manualOnly') manualOnly?: string,
    @Query('excludeTikTok') excludeTikTok?: string,
    @Headers('x-extension-credential') credential?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const normalizedInstanceId = this.requireExtensionInstanceId(
      extensionInstanceId,
    );
    let connection: FacebookConnectionDocument | null = null;
    let legacyFacebookConnection: FacebookConnectionDocument | null = null;
    type PlatformConnectionSummary = {
      _id: Types.ObjectId;
      platform: PublishingPlatform;
      legacyFacebookConnectionId?: Types.ObjectId;
    };
    let installationPlatformConnections: PlatformConnectionSummary[] = [];
    if (this.platformConnectionModel) {
      const installation = await this.extensionsService.verifyWorkerIdentity(
        clerkUserId,
        normalizedInstanceId,
        credential,
      );
      this.extensionsService.assertInstallationActive(installation);
      installationPlatformConnections = await this.platformConnectionModel
        .find({
          clerkUserId,
          activeExtensionInstallationId: installation._id,
          archivedAt: { $exists: false },
          status: PlatformConnectionStatus.CONNECTED,
          workerStatus: { $ne: PlatformConnectionWorkerStatus.PUBLISHING },
          platform: { $in: [PublishingPlatform.FACEBOOK, PublishingPlatform.INSTAGRAM, PublishingPlatform.TIKTOK] },
        })
        .select('_id platform legacyFacebookConnectionId')
        .lean()
        .exec() as PlatformConnectionSummary[];
      // Keep legacy Facebook maintenance visible when this same installation
      // also owns an Instagram platform connection.
      legacyFacebookConnection = await this.getVerifiedWorkerConnection(
        clerkUserId,
        normalizedInstanceId,
        credential,
      );
      if (installationPlatformConnections.length === 0) {
        connection = legacyFacebookConnection;
      }
    } else {
      connection = await this.getVerifiedWorkerConnection(
        clerkUserId,
        normalizedInstanceId,
        credential,
      );
      legacyFacebookConnection = connection;
    }
    if (!connection && installationPlatformConnections.length === 0) {
      this.logMaintenanceEvent(
        'maintenance.ownership.rejected',
        {
          workType: MaintenanceClaimType.ENGAGEMENT,
          extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
          reasonCode: 'UNVERIFIED_CONNECTION',
        },
        'warn',
      );
      return [];
    }
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
    const manualOnlyRequested = manualOnly === 'true';
    const engagementQueueFilter = getEngagementQueueFilter(now);
    const instagramQueueFilter = getPlatformEngagementQueueFilter('INSTAGRAM', now);
    const tiktokQueueFilter = getPlatformEngagementQueueFilter('TIKTOK', now);
    const platformConnectionIds = installationPlatformConnections.map((item) => item._id);
    const facebookPlatformConnectionIds = installationPlatformConnections
      .filter((item) => item.platform === PublishingPlatform.FACEBOOK)
      .map((item) => item._id);
    const instagramPlatformConnectionIds = installationPlatformConnections
      .filter((item) => item.platform === PublishingPlatform.INSTAGRAM)
      .map((item) => item._id);
    const tiktokPlatformConnectionIds = installationPlatformConnections
      .filter((item) => item.platform === PublishingPlatform.TIKTOK)
      .map((item) => item._id);
    const legacyFacebookConnectionIds = installationPlatformConnections
      .filter((item) => item.platform === PublishingPlatform.FACEBOOK && item.legacyFacebookConnectionId)
      .map((item) => item.legacyFacebookConnectionId!);
    if (
      legacyFacebookConnection &&
      !legacyFacebookConnectionIds.some(
        (id) => String(id) === String(legacyFacebookConnection?._id),
      )
    ) {
      legacyFacebookConnectionIds.push(legacyFacebookConnection._id);
    }
    const usePlatformConnections = Boolean(
      this.platformConnectionModel && installationPlatformConnections.length > 0,
    );
    const ownershipAndUrlFilter = usePlatformConnections
      ? {
          $or: [
            ...(facebookPlatformConnectionIds.length
              ? [{ platform: PublishingPlatform.FACEBOOK, platformConnectionId: { $in: facebookPlatformConnectionIds }, postUrl: engagementQueueFilter.postUrl }]
              : []),
            ...(instagramPlatformConnectionIds.length
              ? [{ platform: PublishingPlatform.INSTAGRAM, platformConnectionId: { $in: instagramPlatformConnectionIds }, postUrl: instagramQueueFilter.postUrl }]
              : []),
            ...(!manualOnlyRequested && excludeTikTok === 'true'
              ? []
              : tiktokPlatformConnectionIds.length
                ? [{ platform: PublishingPlatform.TIKTOK, platformConnectionId: { $in: tiktokPlatformConnectionIds }, postUrl: tiktokQueueFilter.postUrl }]
                : []),
            ...(legacyFacebookConnectionIds.length
              ? [{ facebookConnectionId: { $in: legacyFacebookConnectionIds }, postUrl: engagementQueueFilter.postUrl }]
              : []),
          ],
        }
      : {
          facebookConnectionId: connection!._id,
          postUrl: engagementQueueFilter.postUrl,
        };
    const engagementFilter = {
      status: 'SUCCESS',
      submissionStatus: FacebookSubmissionStatus.PUBLISHED,
      ...ownershipAndUrlFilter,
      $and: [
        usePlatformConnections ? platformPublishableTargetFilter : publishableTargetFilter,
        manualOnlyRequested
          ? this.manualMaintenanceRequestFilter(MaintenanceClaimType.ENGAGEMENT)
          : {
              $or: engagementQueueFilter.$or,
            },
        this.maintenanceClaimAvailableFilter(now),
      ],
      postId: { $in: postIds },
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
      this.logMaintenanceEvent('maintenance.claim.created', {
        jobId: claimedJob._id.toString(),
        workType: MaintenanceClaimType.ENGAGEMENT,
        connectionId: connection
          ? String(connection._id)
          : platformConnectionIds.map((id) => String(id)).join(','),
        extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
        manualOnly: manualOnlyRequested,
      });
    }

    if (jobs.length === 0) {
      this.logMaintenanceEvent('maintenance.claim.empty', {
        workType: MaintenanceClaimType.ENGAGEMENT,
        connectionId: connection
          ? String(connection._id)
          : platformConnectionIds.map((id) => String(id)).join(','),
        extensionInstanceId: maskExtensionInstanceId(normalizedInstanceId),
        manualOnly: manualOnlyRequested,
      });
    }

    return jobs.map((job) => ({
      id: job._id.toString(),
      status: FacebookSubmissionStatus.PUBLISHED,
      ...(job.platform ? { platform: job.platform } : {}),
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

  /** POST /api/jobs/:id/maintenance-request — queue dashboard maintenance for the owning extension. */
  /** POST /api/jobs/:id/retry - explicitly requeue a failed, never-submitted job. */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retryFailedJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
  ) {
    if (!clerkUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    if (job.status !== PublishingJobStatus.FAILED) {
      throw new BadRequestException('Only failed jobs can be retried manually');
    }
    if (job.submittedAt || job.postUrl || job.externalPublishId || job.externalPostId || job.submissionStatus) {
      throw new ConflictException('This job may already have been submitted; reconcile it instead of retrying');
    }
    if ((job.platform === PublishingPlatform.TIKTOK ||
      job.targetType === PublishingTargetType.TIKTOK_VIDEO ||
      job.targetType === PublishingTargetType.TIKTOK_PHOTO) && !isTikTokPublishingEnabled()) {
      throw new ForbiddenException('TikTok publishing is disabled for new work');
    }

    // A retry is a user action, so it does not require the extension to be
    // online. It does require the account record to remain connected and
    // identity-verified before the job is put back in the worker queue.
    if (job.platformConnectionId && this.platformConnectionModel) {
      const connection = await this.platformConnectionModel.findOne({
        _id: job.platformConnectionId,
        clerkUserId,
        platform: job.platform ?? PublishingPlatform.FACEBOOK,
        archivedAt: { $exists: false },
      }).exec();
      const identityVerified = connection?.platform === PublishingPlatform.TIKTOK
        ? Boolean(connection.externalUsername && connection.detectedExternalUsername &&
          connection.externalUsername.toLowerCase() === connection.detectedExternalUsername.toLowerCase())
        : Boolean(connection?.externalAccountId && connection.detectedExternalAccountId &&
          connection.externalAccountId === connection.detectedExternalAccountId) ||
          Boolean(connection?.externalUsername && connection.detectedExternalUsername &&
            connection.externalUsername.toLowerCase() === connection.detectedExternalUsername.toLowerCase());
      if (!connection || connection.status !== PlatformConnectionStatus.CONNECTED ||
        !connection.sessionDetected || !identityVerified) {
        throw new BadRequestException('Reconnect and verify the publishing account before retrying');
      }
    }

    // The status predicate makes two simultaneous clicks safe: only one can
    // transition the failed record back to PENDING.
    const requestedAt = new Date();
    const retried = await this.jobModel.findOneAndUpdate(
      {
        _id: id,
        status: PublishingJobStatus.FAILED,
        submittedAt: { $exists: false },
        postUrl: { $exists: false },
        externalPublishId: { $exists: false },
        externalPostId: { $exists: false },
        submissionStatus: { $exists: false },
      },
      {
        $set: { status: PublishingJobStatus.PENDING, manualRetryRequestedAt: requestedAt },
        $unset: {
          error: 1,
          submissionReason: 1,
          startedAt: 1,
          completedAt: 1,
          scheduledFor: 1,
          claimedByExtensionInstanceId: 1,
          claimExpiresAt: 1,
          mediaAccessTokenHash: 1,
          mediaAccessExpiresAt: 1,
          submittedAt: 1,
          postUrl: 1,
          externalPublishId: 1,
          externalPostId: 1,
          submissionStatus: 1,
        },
      },
      { new: true },
    ).exec();
    if (!retried) {
      throw new ConflictException('The job changed before it could be retried');
    }

    await this.updateParentPostStatus(post);
    this.logger.log('[Publishing] Manual retry queued', {
      jobId: String(retried._id),
      platform: retried.platform ?? PublishingPlatform.FACEBOOK,
      targetType: retried.targetType,
      clerkUserId,
    });
    return {
      id: retried._id.toString(),
      status: retried.status,
      attempts: retried.attempts,
      queuedAt: new Date().toISOString(),
    };
  }

  /**
   * POST /api/jobs/:id/force-retry - owner-confirmed retry for a TikTok
   * submission whose acceptance result is unknown and which cannot be found
   * in TikTok Studio Content. This intentionally bypasses the normal
   * submission checkpoint only after an explicit owner confirmation.
   */
  @Post(':id/force-retry')
  @HttpCode(HttpStatus.OK)
  async forceRetryTikTokJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
    @Body() body: { confirmNoPost?: boolean },
  ) {
    if (!clerkUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    if (body?.confirmNoPost !== true) {
      throw new BadRequestException('Confirm that no TikTok post appears in TikTok Studio Content before retrying');
    }

    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }

    const tiktokJob = job.platform === PublishingPlatform.TIKTOK ||
      job.targetType === PublishingTargetType.TIKTOK_VIDEO ||
      job.targetType === PublishingTargetType.TIKTOK_PHOTO;
    if (!tiktokJob) {
      throw new BadRequestException('Force retry is only available for TikTok jobs');
    }
    if (job.submissionStatus !== FacebookSubmissionStatus.UNKNOWN) {
      throw new BadRequestException('Only TikTok jobs with an unknown submission can be force-retried');
    }
    if (!job.submittedAt) {
      throw new ConflictException('This job has no submission checkpoint to force-retry');
    }
    if (job.postUrl || job.externalPublishId || job.externalPostId) {
      throw new ConflictException('A TikTok post identity is already recorded; reconcile it instead of retrying');
    }
    if (job.status === PublishingJobStatus.RUNNING || job.status === PublishingJobStatus.PENDING) {
      throw new ConflictException('This TikTok job is already queued or running');
    }
    if (!isTikTokPublishingEnabled()) {
      throw new ForbiddenException('TikTok publishing is disabled for new work');
    }

    if (job.platformConnectionId && this.platformConnectionModel) {
      const connection = await this.platformConnectionModel.findOne({
        _id: job.platformConnectionId,
        clerkUserId,
        platform: PublishingPlatform.TIKTOK,
        archivedAt: { $exists: false },
      }).exec();
      const identityVerified = Boolean(connection?.externalUsername && connection.detectedExternalUsername &&
        connection.externalUsername.toLowerCase() === connection.detectedExternalUsername.toLowerCase());
      if (!connection || connection.status !== PlatformConnectionStatus.CONNECTED ||
        !connection.sessionDetected || !identityVerified) {
        throw new BadRequestException('Reconnect and verify the TikTok account before retrying');
      }
    }

    const requestedAt = new Date();
    const retried = await this.jobModel.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { platform: PublishingPlatform.TIKTOK },
          { targetType: { $in: [PublishingTargetType.TIKTOK_VIDEO, PublishingTargetType.TIKTOK_PHOTO] } },
        ],
        status: { $in: [PublishingJobStatus.SUCCESS, PublishingJobStatus.FAILED] },
        submissionStatus: FacebookSubmissionStatus.UNKNOWN,
        submittedAt: { $exists: true },
        postUrl: { $exists: false },
        externalPublishId: { $exists: false },
        externalPostId: { $exists: false },
      },
      {
        $set: { status: PublishingJobStatus.PENDING, manualRetryRequestedAt: requestedAt },
        $unset: {
          error: 1,
          submissionReason: 1,
          startedAt: 1,
          completedAt: 1,
          scheduledFor: 1,
          claimedByExtensionInstanceId: 1,
          claimExpiresAt: 1,
          mediaAccessTokenHash: 1,
          mediaAccessExpiresAt: 1,
          submittedAt: 1,
          postUrl: 1,
          externalPublishId: 1,
          externalPostId: 1,
          submissionStatus: 1,
        },
      },
      { new: true },
    ).exec();
    if (!retried) {
      throw new ConflictException('The TikTok job changed before it could be force-retried; inspect TikTok Studio Content again');
    }

    await this.updateParentPostStatus(post);
    this.logger.warn('[Publishing] Owner-confirmed TikTok force retry queued', {
      jobId: String(retried._id),
      clerkUserId,
    });
    return {
      id: retried._id.toString(),
      status: retried.status,
      attempts: retried.attempts,
      queuedAt: requestedAt.toISOString(),
      warning: 'Owner confirmed no TikTok post was visible; a delayed platform submission could still cause a duplicate.',
    };
  }

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
    const instagramJob = job.platform === PublishingPlatform.INSTAGRAM ||
      job.targetType === PublishingTargetType.INSTAGRAM_FEED ||
      job.targetType === PublishingTargetType.INSTAGRAM_REEL;
    const tiktokJob = job.platform === PublishingPlatform.TIKTOK ||
      job.targetType === PublishingTargetType.TIKTOK_VIDEO ||
      job.targetType === PublishingTargetType.TIKTOK_PHOTO;
    if (!job.facebookConnectionId && !job.platformConnectionId) {
      throw new BadRequestException('Job is not assigned to a platform connection');
    }
    if (job.status !== PublishingJobStatus.SUCCESS) {
      throw new BadRequestException('Job is not ready for maintenance refresh');
    }

    const requestedAt = new Date();
    if (body.type === MaintenanceClaimType.PENDING_APPROVAL) {
      if (instagramJob) {
        throw new BadRequestException('Instagram jobs do not use approval refresh');
      }
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
        !job.postUrl ||
        (instagramJob
          ? !isInstagramEngagementPermalink(job.postUrl)
          : tiktokJob
            ? !isTikTokEngagementPermalink(job.postUrl)
            : !job.postUrl)
      ) {
        throw new BadRequestException('Job is not a published post with a supported permalink');
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
    @Headers('x-extension-credential') credential?: string,
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
      credential,
      id,
      body.type,
    );
  }

  /** Downloads one attachment while the associated publishing lease is live. */
  @Get(':id/media/:index')
  async getJobMedia(
    @Param('id') id: string,
    @Param('index') indexValue: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const accessToken = parseBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('Media token required');

    const job = await this.jobModel
      .findById(id)
      .select('+mediaAccessTokenHash')
      .populate('postId', 'mediaUrls')
      .exec();
    if (!job) throw new NotFoundException('Job not found');
    this.assertActiveMediaGrant(job, accessToken);

    const index = Number(indexValue);
    const post = job.postId as unknown as PostDocument;
    const value = Number.isSafeInteger(index) && index >= 0
      ? post.mediaUrls?.[index]
      : undefined;
    const media = typeof value === 'string'
      ? decodeJobMediaDataUrl(value)
      : null;
    if (!media) throw new NotFoundException('Job media not found');

    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Content-Type', media.contentType);
    response.setHeader('Content-Length', String(media.bytes.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${media.fileName}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(media.bytes);
  }

  @Post(':id/tiktok-reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcileTikTokJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
    @Body() body: { status: 'PUBLISHED' | 'PROCESSING' | 'UNKNOWN'; postUrl?: string; reason?: string },
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    if (!['PUBLISHED', 'PROCESSING', 'UNKNOWN'].includes(body.status)) {
      throw new BadRequestException('Invalid TikTok reconciliation status');
    }
    const job = await this.jobModel
      .findById(id)
      .populate('postId')
      .populate('platformConnectionId', 'externalUsername')
      .exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) throw new UnauthorizedException('Not your job');
    if (job.platform !== PublishingPlatform.TIKTOK ||
      ![PublishingTargetType.TIKTOK_VIDEO, PublishingTargetType.TIKTOK_PHOTO].includes(job.targetType)) {
      throw new BadRequestException('TikTok reconciliation is only supported for TikTok publishing jobs');
    }
    if (job.status === PublishingJobStatus.PENDING || job.status === PublishingJobStatus.RUNNING || job.status === PublishingJobStatus.CANCEL_REQUESTED) {
      throw new BadRequestException('TikTok job has not reached a reconcilable terminal state');
    }
    if (job.submissionStatus === FacebookSubmissionStatus.PUBLISHED && body.status !== 'PUBLISHED') {
      throw new BadRequestException('Published TikTok jobs cannot be downgraded');
    }

    const connection = job.platformConnectionId as unknown as { externalUsername?: string };
    const expectedUsername = connection?.externalUsername?.toLowerCase();
    const normalizedUrl = normalizeSubmissionPostUrl(PublishingPlatform.TIKTOK, body.postUrl);
    if (body.status === 'PUBLISHED') {
      if (!normalizedUrl || !expectedUsername) throw new BadRequestException('A valid TikTok permalink is required');
      if (job.submissionStatus === FacebookSubmissionStatus.PUBLISHED && job.postUrl && job.postUrl !== normalizedUrl) {
        throw new BadRequestException('Published TikTok jobs cannot change their permalink');
      }
      const publishedUsername = new URL(normalizedUrl).pathname.match(/^\/@([^/]+)\//)?.[1]?.toLowerCase();
      if (!publishedUsername || publishedUsername !== expectedUsername) throw new BadRequestException('TikTok permalink does not belong to the connected account');
      const existing = await this.jobModel.findOne({
        _id: { $ne: job._id }, platform: PublishingPlatform.TIKTOK,
        platformConnectionId: job.platformConnectionId, postUrl: normalizedUrl,
      }).select('_id').lean().exec();
      if (existing) {
        job.submissionStatus = FacebookSubmissionStatus.UNKNOWN;
        job.submissionReason = 'The supplied TikTok permalink is already assigned to another job';
        job.postUrl = undefined;
      } else {
        job.submissionStatus = FacebookSubmissionStatus.PUBLISHED;
        job.submissionReason = undefined;
        job.postUrl = normalizedUrl;
        job.publishedDetectedAt ??= new Date();
      }
    } else {
      job.submissionStatus = body.status as FacebookSubmissionStatus;
      job.submissionReason = body.reason?.trim().slice(0, 500) || undefined;
      job.postUrl = undefined;
    }
    job.lastCheckedAt = new Date();
    await job.save();
    return {
      id: job._id.toString(), status: job.status,
      submissionStatus: job.submissionStatus, postUrl: job.postUrl, submissionReason: job.submissionReason,
    };
  }

  private assertActiveMediaGrant(
    job: PublishingJobDocument,
    accessToken: string,
  ): void {
    const now = Date.now();
    const hasActiveClaim = Boolean(
      job.status === PublishingJobStatus.RUNNING &&
      job.claimedByExtensionInstanceId &&
      job.claimExpiresAt &&
      job.claimExpiresAt.getTime() > now,
    );
    const tokenIsActive = Boolean(
      job.mediaAccessExpiresAt &&
      job.mediaAccessExpiresAt.getTime() > now &&
      verifyJobMediaAccessToken(accessToken, job.mediaAccessTokenHash),
    );
    if (!hasActiveClaim || !tokenIsActive) {
      throw new ForbiddenException('Media access expired or invalid');
    }
  }

  @Get(':id')
  async getJob(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Param('id') id: string,
    @Headers('x-extension-credential') credential?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');
    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }
    await this.assertWorkerOwnsJob(
      clerkUserId,
      extensionInstanceId,
      credential,
      job,
      { requireActive: false },
    );
    return {
      id: job._id.toString(),
      status: job.status,
      ...(job.submittedAt ? { submittedAt: job.submittedAt, submissionStatus: job.submissionStatus } : {}),
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
    @Headers('x-extension-credential') credential?: string,
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
      credential,
      job,
      MaintenanceClaimType.ENGAGEMENT,
      body.claimToken,
    );
    if (
      job.submissionStatus !== FacebookSubmissionStatus.PUBLISHED ||
      !job.postUrl
    ) {
      throw new BadRequestException('Job is not a published post');
    }

    const isTikTokJob = job.platform === PublishingPlatform.TIKTOK;
    const counts = isTikTokJob
      ? [body.reactionCount, body.commentCount]
      : [body.reactionCount, body.commentCount, body.favoriteCount, body.shareCount];
    if (counts.some((count) => count !== undefined && (!Number.isSafeInteger(count) || count < 0))) {
      throw new BadRequestException('Engagement counters must be non-negative integers');
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
    // TikTok analytics only tracks likes and comments. Strip legacy values
    // from earlier builds whenever this job is synced, including failed reads.
    if (isTikTokJob && job.engagement &&
      (job.engagement.favoriteCount !== undefined || job.engagement.shareCount !== undefined)) {
      const previous = job.engagement;
      if (previous.reactionCount !== undefined || previous.commentCount !== undefined) {
        job.engagement = {
          ...(previous.reactionCount !== undefined ? { reactionCount: previous.reactionCount } : {}),
          ...(previous.commentCount !== undefined ? { commentCount: previous.commentCount } : {}),
          lastSyncedAt: previous.lastSyncedAt,
        };
      } else {
        job.engagement = undefined;
      }
    }
    if (body.status === 'CHECK_FAILED') {
      job.lastEngagementSyncError =
        body.reason?.slice(0, 500) || 'Engagement check failed';
    } else {
      const previous =
        (job.engagement as
          | Partial<NonNullable<PublishingJobDocument['engagement']>>
          | undefined) ?? {};
      const shouldStoreCounters = isTikTokJob
        ? body.reactionCount !== undefined || body.commentCount !== undefined ||
          previous.reactionCount !== undefined || previous.commentCount !== undefined
        : body.reactionCount !== undefined || body.commentCount !== undefined ||
          body.favoriteCount !== undefined || body.shareCount !== undefined ||
          previous.reactionCount !== undefined || previous.commentCount !== undefined ||
          previous.favoriteCount !== undefined || previous.shareCount !== undefined;
      if (shouldStoreCounters) {
        job.engagement = {
          ...(previous.reactionCount !== undefined ||
          body.reactionCount !== undefined
            ? { reactionCount: body.reactionCount ?? previous.reactionCount }
            : {}),
          ...(previous.commentCount !== undefined ||
          body.commentCount !== undefined
            ? { commentCount: body.commentCount ?? previous.commentCount }
            : {}),
          ...(!isTikTokJob && (previous.favoriteCount !== undefined ||
          body.favoriteCount !== undefined)
            ? { favoriteCount: body.favoriteCount ?? previous.favoriteCount }
            : {}),
          ...(!isTikTokJob && (previous.shareCount !== undefined || body.shareCount !== undefined)
            ? { shareCount: body.shareCount ?? previous.shareCount }
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
    this.logMaintenanceResult(
      job,
      MaintenanceClaimType.ENGAGEMENT,
      body.status,
      extensionInstanceId,
      isTikTokJob
        ? { reactionCount: body.reactionCount, commentCount: body.commentCount }
        : body,
    );
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
    @Headers('x-extension-credential') credential?: string,
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
      credential,
      job,
      MaintenanceClaimType.PENDING_APPROVAL,
      body.claimToken,
    );
    const persistAcceptedResult = async () => {
      await job.save();
      this.logMaintenanceResult(
        job,
        MaintenanceClaimType.PENDING_APPROVAL,
        body.status,
        extensionInstanceId,
      );
      return job;
    };
    if (body.status === 'CONTENT_MATCHED') {
      this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
      return persistAcceptedResult();
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
        return persistAcceptedResult();
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
      } else {
        this.releaseMaintenanceClaim(job, MaintenanceClaimType.PENDING_APPROVAL);
      }
      return persistAcceptedResult();
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
      return persistAcceptedResult();
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
      return persistAcceptedResult();
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
    return persistAcceptedResult();
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
    @Headers('x-extension-credential') credential?: string,
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
    const installation = await this.extensionsService.verifyWorkerIdentity(
      clerkUserId,
      normalizedInstanceId,
      credential,
    );
    const workerConnection = await this.assertWorkerOwnsJob(
      clerkUserId,
      normalizedInstanceId,
      credential,
      job,
      { requireActive: false },
    );
    const workerConnectionId = workerConnection._id;

    // Final-result grace: a paused or disconnecting installation may only
    // finish work it claimed before the transition, and only while its lease
    // is still valid. It can never pull a queued job back into RUNNING.
    if (installation.status !== ExtensionLifecycleStatus.ACTIVE) {
      const holdsValidLease = Boolean(
        job.claimedByExtensionInstanceId === installation.extensionInstanceId &&
        job.claimExpiresAt &&
        job.claimExpiresAt.getTime() > Date.now(),
      );
      if (!holdsValidLease) {
        throw new ForbiddenException(
          'Extension is not active and holds no valid job lease.',
        );
      }
      if (
        body.status === PublishingJobStatus.RUNNING ||
        body.status === PublishingJobStatus.PENDING
      ) {
        throw new ForbiddenException(
          'A paused or disconnecting extension cannot claim new work.',
        );
      }
    }

    const previousStatus = job.status;
    if (body.submissionResult?.status === FacebookSubmissionStatus.PROCESSING && job.platform !== PublishingPlatform.TIKTOK) {
      throw new BadRequestException('Processing results are supported only for TikTok');
    }
    if (job.platform === PublishingPlatform.TIKTOK && job.submittedAt &&
      (body.status === PublishingJobStatus.RUNNING || body.status === PublishingJobStatus.PENDING)) {
      throw new ForbiddenException('Submitted TikTok jobs cannot be retried automatically');
    }
    if ((job.platform === PublishingPlatform.TIKTOK ||
      job.targetType === PublishingTargetType.TIKTOK_VIDEO || job.targetType === PublishingTargetType.TIKTOK_PHOTO) &&
      !isTikTokPublishingEnabled() &&
      (body.status === PublishingJobStatus.RUNNING || body.status === PublishingJobStatus.PENDING)) {
      throw new ForbiddenException('TikTok publishing is disabled for new work');
    }
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
      job.mediaAccessTokenHash = undefined;
      job.mediaAccessExpiresAt = undefined;
    }
    if (
      workerConnectionId &&
      (body.status === PublishingJobStatus.RUNNING ||
        body.status === PublishingJobStatus.SUCCESS ||
        body.status === PublishingJobStatus.FAILED ||
        body.status === PublishingJobStatus.CANCELED)
    ) {
      const workerStatus = body.status === PublishingJobStatus.RUNNING
        ? PlatformConnectionWorkerStatus.PUBLISHING
        : PlatformConnectionWorkerStatus.IDLE;
      const update = {
        $set: {
          workerStatus,
          lastSeenAt: new Date(),
        },
      };
      const isLegacyFacebookJob =
        (job.platform ?? PublishingPlatform.FACEBOOK) === PublishingPlatform.FACEBOOK &&
        Boolean(job.facebookConnectionId);
      if (job.platformConnectionId && this.platformConnectionModel && !isLegacyFacebookJob) {
        await this.platformConnectionModel.updateOne({ _id: workerConnectionId }, update);
      } else {
        await this.connectionModel.updateOne(
          { _id: workerConnectionId },
          {
            $set: {
              workerStatus: body.status === PublishingJobStatus.RUNNING
                ? FacebookConnectionWorkerStatus.PUBLISHING
                : FacebookConnectionWorkerStatus.IDLE,
              lastSeenAt: new Date(),
            },
          },
        );
      }
    }
    if (body.submissionResult) {
      const normalizedSubmissionPostUrl = normalizeSubmissionPostUrl(
        job.platform ?? PublishingPlatform.FACEBOOK,
        body.submissionResult.postUrl,
      );
      const effectiveSubmissionStatus =
        job.platform === PublishingPlatform.TIKTOK && body.submissionResult.status === FacebookSubmissionStatus.PUBLISHED && !normalizedSubmissionPostUrl
          ? FacebookSubmissionStatus.UNKNOWN :
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
          [PublishingPlatform.INSTAGRAM, PublishingPlatform.TIKTOK].includes(job.platform)
            ? {
                platform: job.platform,
                platformConnectionId: job.platformConnectionId,
                targetType: job.targetType,
              }
            : job.targetType === PublishingTargetType.PROFILE_FEED
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
        ? `${job.platform ?? PublishingPlatform.FACEBOOK} returned a permalink already assigned to another job`
        : [FacebookSubmissionStatus.UNKNOWN, FacebookSubmissionStatus.PROCESSING].includes(effectiveSubmissionStatus)
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

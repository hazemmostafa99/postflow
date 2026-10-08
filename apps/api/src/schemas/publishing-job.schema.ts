import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Post } from './post.schema';
import { Group } from './group.schema';
import {
  PublishingTargetType,
  validatePublishingTarget,
} from './publishing-target';
import { PublishingPlatform } from './publishing-platform';

export {
  PublishingTargetType,
  resolvePublishingTargetType,
  validatePublishingTarget,
} from './publishing-target';
export {
  PublishingPlatform,
  resolvePublishingPlatform,
} from './publishing-platform';

export type PublishingJobDocument = PublishingJob & Document;

export enum FacebookSubmissionStatus {
  PUBLISHED = 'PUBLISHED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  UNKNOWN = 'UNKNOWN',
}

export enum PublishingJobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  PAUSED = 'PAUSED',
  CANCELED = 'CANCELED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
}

export enum MaintenanceClaimType {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ENGAGEMENT = 'ENGAGEMENT',
}

@Schema({ timestamps: true })
export class PublishingJob {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId: Post;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PublishingPlatform),
    default: PublishingPlatform.FACEBOOK,
    index: true,
  })
  platform: PublishingPlatform;

  @Prop({
    required: true,
    enum: PublishingTargetType,
    default: PublishingTargetType.GROUP,
    index: true,
  })
  targetType: PublishingTargetType;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Group' })
  groupId?: Group;

  /** Facebook connection responsible for executing this job. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FacebookConnection',
    index: true,
  })
  facebookConnectionId?: Types.ObjectId;

  /** Generic owner for Instagram, TikTok, and migrated Facebook jobs. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PlatformConnection',
    index: true,
  })
  platformConnectionId?: Types.ObjectId;

  @Prop({ required: true, default: PublishingJobStatus.PENDING })
  status: string;

  /** Worker lease used to recover jobs after an extension restart. */
  @Prop()
  claimedByExtensionInstanceId?: string;

  @Prop()
  claimExpiresAt?: Date;

  @Prop({ required: true, default: 0 })
  attempts: number;

  /** Stable position inside the Post Flow, used when recalculating schedules. */
  @Prop({ default: 0 })
  flowOrder: number;

  @Prop()
  error?: string;

  @Prop({ enum: FacebookSubmissionStatus })
  submissionStatus?: FacebookSubmissionStatus;

  @Prop()
  postUrl?: string;

  /** Platform correlation ID for an accepted upload/publish operation. */
  @Prop()
  externalPublishId?: string;

  /** Stable platform post identity when it can be detected reliably. */
  @Prop()
  externalPostId?: string;

  @Prop()
  submissionReason?: string;

  /** Timestamp recorded when Facebook accepted the submission attempt. */
  @Prop()
  submittedAt?: Date;

  /** Pending-approval synchronization metadata. */
  @Prop()
  lastCheckedAt?: Date;

  @Prop()
  nextCheckAt?: Date;

  @Prop({ default: 0 })
  syncAttempts: number;

  @Prop()
  lastSyncError?: string;

  @Prop()
  publishedDetectedAt?: Date;

  /** Latest visible Facebook engagement counters. Kept separate from approval-sync metadata. */
  @Prop({
    type: { reactionCount: Number, commentCount: Number, lastSyncedAt: Date },
  })
  engagement?: {
    reactionCount?: number;
    commentCount?: number;
    lastSyncedAt: Date;
  };

  @Prop()
  lastEngagementSyncAt?: Date;

  @Prop()
  nextEngagementSyncAt?: Date;

  @Prop({ default: 0 })
  engagementSyncAttempts: number;

  @Prop()
  lastEngagementSyncError?: string;

  /** Short-lived lease used by pending/analytics maintenance workers. */
  @Prop()
  maintenanceClaimedByExtensionInstanceId?: string;

  @Prop({ enum: MaintenanceClaimType })
  maintenanceClaimType?: MaintenanceClaimType;

  @Prop()
  maintenanceClaimToken?: string;

  @Prop()
  maintenanceClaimExpiresAt?: Date;

  /** Dashboard-triggered maintenance requests waiting for the owning extension. */
  @Prop()
  manualPendingSyncRequestedAt?: Date;

  @Prop()
  manualEngagementSyncRequestedAt?: Date;

  @Prop()
  scheduledFor?: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const PublishingJobSchema = SchemaFactory.createForClass(PublishingJob);

PublishingJobSchema.index({ postId: 1 });

PublishingJobSchema.pre('validate', function () {
  const validationError = validatePublishingTarget({
    platform: this.platform,
    targetType: this.targetType,
    groupId: this.groupId,
    facebookConnectionId: this.facebookConnectionId,
    platformConnectionId: this.platformConnectionId,
  });
  if (validationError) {
    this.invalidate(validationError.path, validationError.message);
  }
});

PublishingJobSchema.index({
  facebookConnectionId: 1,
  targetType: 1,
  status: 1,
  scheduledFor: 1,
  flowOrder: 1,
  createdAt: 1,
});

PublishingJobSchema.index(
  {
    platformConnectionId: 1,
    platform: 1,
    targetType: 1,
    status: 1,
    scheduledFor: 1,
    flowOrder: 1,
    createdAt: 1,
  },
  { name: 'platform_connection_publish_queue' },
);

// Connection-scoped maintenance queues must be able to find due work without
// scanning all jobs for a user or returning legacy jobs that have no owner.
PublishingJobSchema.index({
  facebookConnectionId: 1,
  status: 1,
  submissionStatus: 1,
  nextCheckAt: 1,
  submittedAt: 1,
  createdAt: 1,
});

PublishingJobSchema.index({
  facebookConnectionId: 1,
  status: 1,
  submissionStatus: 1,
  nextEngagementSyncAt: 1,
  publishedDetectedAt: 1,
  createdAt: 1,
});

PublishingJobSchema.index({
  facebookConnectionId: 1,
  status: 1,
  submissionStatus: 1,
  manualPendingSyncRequestedAt: 1,
  createdAt: 1,
});

PublishingJobSchema.index({
  facebookConnectionId: 1,
  status: 1,
  submissionStatus: 1,
  manualEngagementSyncRequestedAt: 1,
  createdAt: 1,
});

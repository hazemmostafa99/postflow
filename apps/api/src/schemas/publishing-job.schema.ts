import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Post } from './post.schema';
import { Group } from './group.schema';

export type PublishingJobDocument = PublishingJob & Document;

export enum FacebookSubmissionStatus {
  PUBLISHED = 'PUBLISHED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  UNKNOWN = 'UNKNOWN',
}

@Schema({ timestamps: true })
export class PublishingJob {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId: Post;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Group', required: true })
  groupId: Group;

  @Prop({ required: true, default: 'PENDING' })
  status: string;

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
  @Prop({ type: { reactionCount: Number, commentCount: Number, lastSyncedAt: Date } })
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

  @Prop()
  scheduledFor?: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const PublishingJobSchema = SchemaFactory.createForClass(PublishingJob);

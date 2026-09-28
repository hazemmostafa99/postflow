import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FacebookConnectionDocument = FacebookConnection & Document;

export enum FacebookConnectionStatus {
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  LOGIN_REQUIRED = 'LOGIN_REQUIRED',
  ACCOUNT_MISMATCH = 'ACCOUNT_MISMATCH',
  BLOCKED = 'BLOCKED',
  DISCONNECTED = 'DISCONNECTED',
}

export enum FacebookConnectionWorkerStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  IDLE = 'IDLE',
  PUBLISHING = 'PUBLISHING',
  BLOCKED = 'BLOCKED',
  LOGIN_REQUIRED = 'LOGIN_REQUIRED',
  ACCOUNT_MISMATCH = 'ACCOUNT_MISMATCH',
  CHECKPOINT_OR_VERIFICATION = 'CHECKPOINT_OR_VERIFICATION',
  CAPTCHA_OR_CHALLENGE = 'CAPTCHA_OR_CHALLENGE',
  MANUAL_INTERVENTION_REQUIRED = 'MANUAL_INTERVENTION_REQUIRED',
}

@Schema({ timestamps: true })
export class FacebookConnection {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  /** Optional for legacy connections created before instance identities existed. */
  @Prop({ index: true })
  extensionInstanceId?: string;

  /** User-provided label for recognizing this Chrome Profile. */
  @Prop({ trim: true, maxlength: 60 })
  displayName?: string;

  /** Expected account identity, bound on the first verified session. */
  @Prop({ index: true })
  facebookUserId?: string;

  /** Most recent account identity reported by the Facebook content script. */
  @Prop({ index: true })
  detectedFacebookUserId?: string;

  @Prop({ required: true, default: FacebookConnectionStatus.PENDING })
  status: FacebookConnectionStatus;

  @Prop({
    required: true,
    default: FacebookConnectionWorkerStatus.OFFLINE,
  })
  workerStatus: FacebookConnectionWorkerStatus;

  @Prop({ default: false })
  facebookSessionDetected: boolean;

  @Prop({ default: Date.now })
  lastSeenAt: Date;
}

export const FacebookConnectionSchema =
  SchemaFactory.createForClass(FacebookConnection);

FacebookConnectionSchema.index(
  { clerkUserId: 1, extensionInstanceId: 1 },
  { unique: true, sparse: true },
);

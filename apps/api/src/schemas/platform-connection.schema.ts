import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { PublishingPlatform } from './publishing-platform';

export type PlatformConnectionDocument = PlatformConnection & Document;

export enum PlatformConnectionStatus {
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  LOGIN_REQUIRED = 'LOGIN_REQUIRED',
  ACCOUNT_MISMATCH = 'ACCOUNT_MISMATCH',
  BLOCKED = 'BLOCKED',
  DISCONNECTED = 'DISCONNECTED',
}

export enum PlatformConnectionWorkerStatus {
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
export class PlatformConnection {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PublishingPlatform),
    index: true,
  })
  platform: PublishingPlatform;

  /** Current installation allowed to claim work for this platform account. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ExtensionInstallation',
    index: true,
  })
  activeExtensionInstallationId?: Types.ObjectId;

  /**
   * Compatibility pointer used while Facebook jobs and Groups still use the
   * durable FacebookConnection collection as their source of truth.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FacebookConnection',
    index: true,
  })
  legacyFacebookConnectionId?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 60 })
  displayName?: string;

  @Prop()
  displayNameKey?: string;

  /** Strongest stable account identifier available from the platform UI. */
  @Prop({ index: true })
  externalAccountId?: string;

  /** Canonical user-visible handle. It may change independently of the ID. */
  @Prop({ trim: true })
  externalUsername?: string;

  @Prop({ index: true })
  detectedExternalAccountId?: string;

  @Prop({ trim: true })
  detectedExternalUsername?: string;

  @Prop({
    required: true,
    enum: Object.values(PlatformConnectionStatus),
    default: PlatformConnectionStatus.PENDING,
  })
  status: PlatformConnectionStatus;

  @Prop()
  statusReason?: string;

  @Prop({
    required: true,
    enum: Object.values(PlatformConnectionWorkerStatus),
    default: PlatformConnectionWorkerStatus.OFFLINE,
  })
  workerStatus: PlatformConnectionWorkerStatus;

  @Prop({ default: false })
  sessionDetected: boolean;

  @Prop({ enum: ['VERIFIED', 'CHECKING', 'LOGIN_REQUIRED', 'STALE'] })
  sessionEvidenceState?: string;

  @Prop()
  sessionVerifiedAt?: Date;

  @Prop()
  sessionEvidenceSource?: string;

  @Prop({ default: Date.now })
  lastSeenAt: Date;

  @Prop({ index: true })
  archivedAt?: Date;

  @Prop()
  archivedByClerkUserId?: string;

  @Prop()
  archiveReason?: string;

  /** Hidden until a verified account on a new installation reconnects it. */
  @Prop({ index: true })
  removedAt?: Date;

  // Added by timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const PlatformConnectionSchema =
  SchemaFactory.createForClass(PlatformConnection);

// One Chrome Profile has one active web session for a given platform.
PlatformConnectionSchema.index(
  { activeExtensionInstallationId: 1, platform: 1 },
  {
    unique: true,
    partialFilterExpression: {
      activeExtensionInstallationId: { $type: 'objectId' },
      archivedAt: { $exists: false },
    },
    name: 'active_installation_platform_binding',
  },
);

// Each legacy Facebook connection maps to at most one generic connection.
PlatformConnectionSchema.index(
  { legacyFacebookConnectionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      legacyFacebookConnectionId: { $type: 'objectId' },
    },
    name: 'legacy_facebook_connection_binding',
  },
);

PlatformConnectionSchema.index(
  { clerkUserId: 1, platform: 1, externalAccountId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalAccountId: { $type: 'string' } },
    name: 'user_platform_external_account',
  },
);

PlatformConnectionSchema.index(
  { clerkUserId: 1, platform: 1, displayNameKey: 1 },
  {
    unique: true,
    partialFilterExpression: { displayNameKey: { $type: 'string' } },
    name: 'user_platform_display_name',
  },
);

PlatformConnectionSchema.index(
  {
    activeExtensionInstallationId: 1,
    platform: 1,
    status: 1,
    archivedAt: 1,
  },
  { name: 'platform_connection_claim_health' },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ExtensionInstallationDocument = ExtensionInstallation & Document;

export enum ExtensionLifecycleStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  REVOKE_PENDING = 'REVOKE_PENDING',
  REVOKED = 'REVOKED',
}

export enum ExtensionRevocationReason {
  USER_DISCONNECTED = 'USER_DISCONNECTED',
  REMOVED = 'REMOVED',
  REPLACED = 'REPLACED',
  SECURITY = 'SECURITY',
  MIGRATION = 'MIGRATION',
}

@Schema({ timestamps: true })
export class ExtensionInstallation {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ index: true, unique: true, sparse: true })
  extensionInstanceId?: string;

  /** This installation is the product Connection; its name is shared across platforms. */
  @Prop()
  displayName?: string;

  @Prop()
  displayNameKey?: string;

  /** Product Connection archive; account records and scheduled jobs are retained. */
  @Prop()
  archivedAt?: Date;

  @Prop()
  archivedByClerkUserId?: string;

  @Prop()
  archiveReason?: string;

  /** Hidden removal tombstone keeps this instance ID revoked after dashboard removal. */
  @Prop({ index: true })
  removedAt?: Date;

  /** Single-use dashboard approval for restoring a user-disconnected instance. */
  @Prop()
  restoreApprovalTokenHash?: string;

  @Prop()
  restoreApprovalExpiresAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'FacebookConnection', index: true })
  facebookConnectionId?: Types.ObjectId;

  @Prop({
    required: true,
    enum: Object.values(ExtensionLifecycleStatus),
    default: ExtensionLifecycleStatus.ACTIVE,
  })
  status: ExtensionLifecycleStatus;

  @Prop({ default: Date.now })
  statusChangedAt: Date;

  @Prop()
  statusChangedByClerkUserId?: string;

  @Prop()
  statusReason?: string;

  @Prop()
  revokedAt?: Date;

  @Prop()
  revokedByClerkUserId?: string;

  @Prop({ enum: Object.values(ExtensionRevocationReason) })
  revocationReason?: ExtensionRevocationReason;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ExtensionInstallation' })
  replacedByInstallationId?: Types.ObjectId;

  /** Only a hash is persisted; the plaintext credential never reaches MongoDB. */
  @Prop()
  credentialHash?: string;

  @Prop({ default: 0 })
  credentialVersion: number;

  @Prop()
  credentialIssuedAt?: Date;

  @Prop()
  credentialRevokedAt?: Date;

  @Prop({ default: Date.now })
  lastHeartbeat: Date;

  @Prop({ default: false })
  facebookSessionDetected: boolean;

  /**
   * The Facebook user id most recently detected for this installation. Used
   * to verify identity before an explicit reconnect may rebind the
   * installation to an existing connection.
   */
  @Prop()
  detectedFacebookUserId?: string;
}

export const ExtensionInstallationSchema = SchemaFactory.createForClass(
  ExtensionInstallation,
);

ExtensionInstallationSchema.index(
  { facebookConnectionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      facebookConnectionId: { $type: 'objectId' },
      status: {
        $in: [
          ExtensionLifecycleStatus.ACTIVE,
          ExtensionLifecycleStatus.PAUSED,
          ExtensionLifecycleStatus.REVOKE_PENDING,
        ],
      },
    },
    name: 'active_facebook_connection_binding',
  },
);

ExtensionInstallationSchema.index(
  { status: 1, lastHeartbeat: -1 },
  { name: 'status_lastHeartbeat' },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ExtensionLifecycleAuditDocument = ExtensionLifecycleAuditEvent &
  Document;

export enum ExtensionLifecycleAuditEventName {
  INSTALLATION_REGISTERED = 'INSTALLATION_REGISTERED',
  INSTALLATION_PAUSED = 'INSTALLATION_PAUSED',
  INSTALLATION_RESUMED = 'INSTALLATION_RESUMED',
  DISCONNECT_REQUESTED = 'DISCONNECT_REQUESTED',
  INSTALLATION_REVOKED = 'INSTALLATION_REVOKED',
  INSTALLATION_RESTORED = 'INSTALLATION_RESTORED',
  CONNECTION_ARCHIVED = 'CONNECTION_ARCHIVED',
  CONNECTION_REMOVED = 'CONNECTION_REMOVED',
  RECOVERY_OFFERED = 'RECOVERY_OFFERED',
  RECOVERY_ACCEPTED = 'RECOVERY_ACCEPTED',
  INSTALLATION_REPLACED = 'INSTALLATION_REPLACED',
  RECOVERY_REJECTED = 'RECOVERY_REJECTED',
}

export enum ExtensionLifecycleActor {
  WORKER = 'WORKER',
  DASHBOARD = 'DASHBOARD',
  SYSTEM = 'SYSTEM',
}

/**
 * Non-sensitive lifecycle audit trail. Never store installation credentials,
 * cookies, complete Facebook DOM, or post content here.
 */
@Schema({ timestamps: true })
export class ExtensionLifecycleAuditEvent {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'FacebookConnection', index: true })
  facebookConnectionId?: Types.ObjectId;

  /** Masked extension instance ID only — see maskExtensionInstanceId. */
  @Prop()
  extensionInstanceIdMasked?: string;

  @Prop({ required: true, enum: Object.values(ExtensionLifecycleActor) })
  actor: ExtensionLifecycleActor;

  @Prop({
    required: true,
    enum: Object.values(ExtensionLifecycleAuditEventName),
  })
  event: ExtensionLifecycleAuditEventName;

  @Prop()
  previousLifecycle?: string;

  @Prop()
  nextLifecycle?: string;

  /** Non-sensitive reason code such as USER_DISCONNECTED, REMOVED, REPLACED. */
  @Prop()
  reason?: string;
}

export const ExtensionLifecycleAuditEventSchema =
  SchemaFactory.createForClass(ExtensionLifecycleAuditEvent);

ExtensionLifecycleAuditEventSchema.index({
  clerkUserId: 1,
  createdAt: -1,
});

ExtensionLifecycleAuditEventSchema.index({
  facebookConnectionId: 1,
  createdAt: -1,
});

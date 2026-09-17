import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from './user.schema';

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export type InvitationDocument = Invitation & Document;

@Schema({ timestamps: true })
export class Invitation {
  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, enum: UserRole })
  role: UserRole;

  @Prop({ type: String, default: null })
  teamId?: string | null;

  @Prop({ required: true, enum: InvitationStatus, default: InvitationStatus.PENDING })
  status: InvitationStatus;

  @Prop({ type: String, default: null })
  clerkInvitationId?: string | null;

  @Prop({ required: true })
  invitedByUserId: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  acceptedAt?: Date | null;

  @Prop({ type: String, default: null })
  acceptedClerkUserId?: string | null;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
InvitationSchema.index({ email: 1, status: 1 });
InvitationSchema.index({ teamId: 1, role: 1, status: 1 });

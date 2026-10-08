import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PhoneContactDocument = PhoneContact & Document;
export type PhoneContactSourceType = 'facebook' | 'generic' | 'manual';

/** Qualification states shown by the lead qualification board. */
export const LEAD_QUALIFICATION_STATUSES = [
  'UNREVIEWED',
  'QUALIFIED',
  'NOT_QUALIFIED',
] as const;

export type LeadQualificationStatus =
  (typeof LEAD_QUALIFICATION_STATUSES)[number];

export const MAX_LEAD_NOTES_LENGTH = 2000;

@Schema({ _id: false })
export class PhoneContactSource {
  @Prop({ required: true, enum: ['facebook', 'generic', 'manual'] })
  type: PhoneContactSourceType;

  @Prop({ maxlength: 2048 })
  url?: string;
}

export const PhoneContactSourceSchema =
  SchemaFactory.createForClass(PhoneContactSource);

@Schema({ timestamps: true })
export class PhoneContact {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ required: true, trim: true })
  normalizedNumber: string;

  @Prop({ required: true, trim: true, maxlength: 80, default: 'Uncategorized' })
  category: string;

  @Prop({ trim: true, maxlength: 80, default: '' })
  group: string;

  @Prop({ type: PhoneContactSourceSchema, required: true })
  source: PhoneContactSource;

  @Prop({
    type: String,
    required: true,
    enum: [...LEAD_QUALIFICATION_STATUSES],
    default: 'UNREVIEWED',
  })
  qualificationStatus: LeadQualificationStatus;

  @Prop({ trim: true, default: '', maxlength: MAX_LEAD_NOTES_LENGTH })
  notes: string;

  @Prop({ required: true, default: Date.now })
  lastSeenAt: Date;
}

export const PhoneContactSchema = SchemaFactory.createForClass(PhoneContact);

PhoneContactSchema.index(
  { clerkUserId: 1, normalizedNumber: 1 },
  { unique: true },
);
PhoneContactSchema.index({ clerkUserId: 1, lastSeenAt: -1 });
PhoneContactSchema.index({
  clerkUserId: 1,
  qualificationStatus: 1,
  lastSeenAt: -1,
  _id: -1,
});
PhoneContactSchema.index({
  clerkUserId: 1,
  group: 1,
  qualificationStatus: 1,
  lastSeenAt: -1,
  _id: -1,
});

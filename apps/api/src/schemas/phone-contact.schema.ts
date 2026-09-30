import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PhoneContactDocument = PhoneContact & Document;
export type PhoneContactSourceType = 'facebook' | 'generic';

@Schema({ _id: false })
export class PhoneContactSource {
  @Prop({ required: true, enum: ['facebook', 'generic'] })
  type: PhoneContactSourceType;

  @Prop({ required: true, maxlength: 2048 })
  url: string;
}

export const PhoneContactSourceSchema =
  SchemaFactory.createForClass(PhoneContactSource);

@Schema({ timestamps: true })
export class PhoneContact {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ required: true, trim: true })
  normalizedNumber: string;

  @Prop({ type: PhoneContactSourceSchema, required: true })
  source: PhoneContactSource;

  @Prop({ required: true, default: Date.now })
  lastSeenAt: Date;
}

export const PhoneContactSchema = SchemaFactory.createForClass(PhoneContact);

PhoneContactSchema.index(
  { clerkUserId: 1, normalizedNumber: 1 },
  { unique: true },
);
PhoneContactSchema.index({ clerkUserId: 1, lastSeenAt: -1 });

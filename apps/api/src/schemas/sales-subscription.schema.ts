import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SalesSubscriptionDocument = SalesSubscription & Document;

@Schema({ timestamps: true, collection: 'sales_subscriptions' })
export class SalesSubscription {
  @Prop({ required: true, trim: true })
  clerkUserId: string;

  @Prop({ required: true })
  trialStartedAt: Date;

  @Prop({ required: true })
  trialEndsAt: Date;

  @Prop({ required: true })
  accessUntil: Date;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;
}

export const SalesSubscriptionSchema =
  SchemaFactory.createForClass(SalesSubscription);

SalesSubscriptionSchema.index({ clerkUserId: 1 }, { unique: true });


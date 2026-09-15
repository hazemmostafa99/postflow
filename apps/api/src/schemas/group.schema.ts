import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ required: true })
  externalId: string; // Facebook's internal group ID / slug

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true, default: 'ACTIVE' })
  status: string;

  @Prop({ default: Date.now })
  lastSeenAt: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);

GroupSchema.index({ clerkUserId: 1, externalId: 1 }, { unique: true });

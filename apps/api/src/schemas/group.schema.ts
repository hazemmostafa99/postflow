import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  /** Optional for legacy groups synced before connection ownership existed. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FacebookConnection',
    index: true,
  })
  facebookConnectionId?: Types.ObjectId;

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

GroupSchema.index(
  { clerkUserId: 1, facebookConnectionId: 1, externalId: 1 },
  { unique: true },
);

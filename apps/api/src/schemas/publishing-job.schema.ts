import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Post } from './post.schema';
import { Group } from './group.schema';

export type PublishingJobDocument = PublishingJob & Document;

@Schema({ timestamps: true })
export class PublishingJob {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId: Post;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Group', required: true })
  groupId: Group;

  @Prop({ required: true, default: 'PENDING' })
  status: string;

  @Prop({ required: true, default: 0 })
  attempts: number;

  @Prop()
  error?: string;

  @Prop()
  scheduledFor?: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const PublishingJobSchema = SchemaFactory.createForClass(PublishingJob);

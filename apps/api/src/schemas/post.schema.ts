import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PostDocument = Post & Document;

@Schema({ timestamps: true })
export class Post {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: [] })
  mediaUrls: string[];

  // DRAFT | PUBLISHING | COMPLETED | PARTIAL_FAILURE
  @Prop({ required: true, default: 'DRAFT' })
  status: string;

  /** Optional Post Flow scheduling configuration. */
  @Prop()
  startTime?: Date;

  @Prop({ default: false })
  spacePostsApart: boolean;

  @Prop()
  spacingMinutes?: number;
}

export const PostSchema = SchemaFactory.createForClass(Post);

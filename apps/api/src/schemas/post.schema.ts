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

  // DRAFT | PUBLISHING | PAUSED | CANCELED | COMPLETED | PARTIAL_FAILURE
  @Prop({ required: true, default: 'DRAFT' })
  status: string;

  /** Optional Post Flow scheduling configuration. */
  @Prop()
  startTime?: Date;

  /** Random delay bounds used between consecutive publishing destinations. */
  @Prop({ default: 30 })
  spacingMinSeconds: number;

  @Prop({ default: 120 })
  spacingMaxSeconds: number;
}

export const PostSchema = SchemaFactory.createForClass(Post);

PostSchema.index({ createdAt: -1 });
PostSchema.index({ clerkUserId: 1, createdAt: -1 });

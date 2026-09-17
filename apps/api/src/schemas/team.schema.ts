import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TeamDocument = Team & Document;

@Schema({ timestamps: true })
export class Team {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ type: String, default: null })
  managerId?: string | null;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ExtensionInstallationDocument = ExtensionInstallation & Document;

@Schema({ timestamps: true })
export class ExtensionInstallation {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ index: true })
  extensionInstanceId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'FacebookConnection', index: true })
  facebookConnectionId?: Types.ObjectId;

  @Prop({ required: true, default: 'ACTIVE' }) // ACTIVE, INACTIVE, UNINSTALLED
  status: string;

  @Prop({ default: Date.now })
  lastHeartbeat: Date;

  @Prop({ default: false })
  facebookSessionDetected: boolean;
}

export const ExtensionInstallationSchema = SchemaFactory.createForClass(
  ExtensionInstallation,
);

ExtensionInstallationSchema.index(
  { clerkUserId: 1, extensionInstanceId: 1 },
  { unique: true, sparse: true },
);

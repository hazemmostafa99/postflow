import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ExtensionInstallationDocument = ExtensionInstallation & Document;

@Schema({ timestamps: true })
export class ExtensionInstallation {
  @Prop({ required: true, index: true })
  clerkUserId: string;

  @Prop({ required: true, default: 'ACTIVE' }) // ACTIVE, INACTIVE, UNINSTALLED
  status: string;

  @Prop({ default: Date.now })
  lastHeartbeat: Date;

  @Prop({ default: false })
  facebookSessionDetected: boolean;
}

export const ExtensionInstallationSchema = SchemaFactory.createForClass(ExtensionInstallation);

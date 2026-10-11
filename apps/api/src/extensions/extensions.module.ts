import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExtensionsService } from './extensions.service';
import { ExtensionsController } from './extensions.controller';
import {
  ExtensionInstallation,
  ExtensionInstallationSchema,
} from '../schemas/extension-installation.schema';
import { User, UserSchema } from '../schemas/user.schema';
import {
  FacebookConnection,
  FacebookConnectionSchema,
} from '../schemas/facebook-connection.schema';
import {
  PublishingJob,
  PublishingJobSchema,
} from '../schemas/publishing-job.schema';
import {
  ExtensionLifecycleAuditEvent,
  ExtensionLifecycleAuditEventSchema,
} from '../schemas/extension-lifecycle-audit.schema';
import {
  PlatformConnection,
  PlatformConnectionSchema,
} from '../schemas/platform-connection.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExtensionInstallation.name, schema: ExtensionInstallationSchema },
      { name: User.name, schema: UserSchema },
      { name: FacebookConnection.name, schema: FacebookConnectionSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      {
        name: ExtensionLifecycleAuditEvent.name,
        schema: ExtensionLifecycleAuditEventSchema,
      },
      { name: PlatformConnection.name, schema: PlatformConnectionSchema },
    ]),
  ],
  providers: [ExtensionsService],
  controllers: [ExtensionsController],
  exports: [ExtensionsService],
})
export class ExtensionsModule {}

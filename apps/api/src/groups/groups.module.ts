import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { Group, GroupSchema } from '../schemas/group.schema';
import {
  PublishingJob,
  PublishingJobSchema,
} from '../schemas/publishing-job.schema';
import {
  FacebookConnection,
  FacebookConnectionSchema,
} from '../schemas/facebook-connection.schema';
import { ExtensionsModule } from '../extensions/extensions.module';

@Module({
  imports: [
    ExtensionsModule,
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      { name: FacebookConnection.name, schema: FacebookConnectionSchema },
    ]),
  ],
  providers: [GroupsService],
  controllers: [GroupsController],
  exports: [GroupsService],
})
export class GroupsModule {}

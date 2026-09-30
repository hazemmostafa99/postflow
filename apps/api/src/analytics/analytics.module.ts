import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Group, GroupSchema } from '../schemas/group.schema';
import { Post, PostSchema } from '../schemas/post.schema';
import {
  PublishingJob,
  PublishingJobSchema,
} from '../schemas/publishing-job.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Team, TeamSchema } from '../schemas/team.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      { name: Group.name, schema: GroupSchema },
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Post, PostSchema } from '../schemas/post.schema';
import {
  PublishingJob,
  PublishingJobSchema,
} from '../schemas/publishing-job.schema';
import { Team, TeamSchema } from '../schemas/team.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}

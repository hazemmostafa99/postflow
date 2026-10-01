import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { JobsController } from './jobs.controller';
import { Post, PostSchema } from '../schemas/post.schema';
import {
  PublishingJob,
  PublishingJobSchema,
} from '../schemas/publishing-job.schema';
import { Group, GroupSchema } from '../schemas/group.schema';
import {
  FacebookConnection,
  FacebookConnectionSchema,
} from '../schemas/facebook-connection.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      { name: Group.name, schema: GroupSchema },
      { name: FacebookConnection.name, schema: FacebookConnectionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [PostsService],
  controllers: [PostsController, JobsController],
  exports: [PostsService],
})
export class PostsModule {}

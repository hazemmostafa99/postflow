import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { JobsController } from './jobs.controller';
import { Post, PostSchema } from '../schemas/post.schema';
import { PublishingJob, PublishingJobSchema } from '../schemas/publishing-job.schema';
import { Group, GroupSchema } from '../schemas/group.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
  ],
  providers: [PostsService],
  controllers: [PostsController, JobsController],
  exports: [PostsService],
})
export class PostsModule {}

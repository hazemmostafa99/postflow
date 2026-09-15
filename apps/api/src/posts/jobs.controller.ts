import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PublishingJob, PublishingJobDocument } from '../schemas/publishing-job.schema';
import { Post as PostSchema, PostDocument } from '../schemas/post.schema';

@Controller('api/jobs')
export class JobsController {
  constructor(
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(PostSchema.name)
    private readonly postModel: Model<PostDocument>,
  ) {}

  /** GET /api/jobs/next — fetch the next pending job for the extension */
  @Get('next')
  async getNextJob(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');

    // First find all posts belonging to this user
    const posts = await this.postModel.find({ clerkUserId }).select('_id').lean().exec();
    const postIds = posts.map(p => p._id);

    // Find the oldest pending job for any of these posts
    const job = await this.jobModel
      .findOne({
        postId: { $in: postIds } as any,
        status: 'PENDING',
      })
      .sort({ createdAt: 1 })
      .populate('postId', 'content mediaUrls')
      .populate('groupId', 'name url externalId')
      .exec();

    if (!job) return null;

    // Optional: mark it as RUNNING right away or let the extension do it?
    // Let's let the extension do it when it actually starts.

    return job;
  }

  /** POST /api/jobs/:id/status — update a job's status */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateJobStatus(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
    @Body() body: { status: string; error?: string },
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    const allowedStatuses = new Set(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']);
    if (!allowedStatuses.has(body.status)) {
      throw new BadRequestException('Invalid job status');
    }

    // Make sure the job actually belongs to the user by populating the post
    const job = await this.jobModel.findById(id).populate('postId').exec();
    if (!job) throw new NotFoundException('Job not found');

    const post = job.postId as unknown as PostDocument;
    if (post.clerkUserId !== clerkUserId) {
      throw new UnauthorizedException('Not your job');
    }

    const previousStatus = job.status;
    job.status = body.status;
    job.error = body.status === 'FAILED' ? body.error : undefined;
    
    // Increment attempts if it just finished (success or fail)
    if (
      (body.status === 'SUCCESS' || body.status === 'FAILED') &&
      previousStatus !== 'SUCCESS' &&
      previousStatus !== 'FAILED'
    ) {
      job.attempts = (job.attempts || 0) + 1;
      job.completedAt = new Date();
    } else if (body.status === 'RUNNING') {
      job.startedAt = new Date();
    }

    await job.save();
    await this.updateParentPostStatus(post);

    return job;
  }

  private async updateParentPostStatus(post: PostDocument) {
    const jobs = await this.jobModel
      .find({ postId: post._id } as any)
      .select('status')
      .lean()
      .exec();

    if (!jobs.length) return;

    const allSucceeded = jobs.every((job) => job.status === 'SUCCESS');
    const anyFailed = jobs.some((job) => job.status === 'FAILED');
    const allFinished = jobs.every((job) => job.status === 'SUCCESS' || job.status === 'FAILED');

    if (allSucceeded) {
      post.status = 'COMPLETED';
    } else if (allFinished && anyFailed) {
      post.status = 'PARTIAL_FAILURE';
    } else {
      post.status = 'PUBLISHING';
    }

    await post.save();
  }
}

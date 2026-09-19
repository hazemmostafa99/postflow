import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../schemas/post.schema';
import {
  PublishingJob,
  PublishingJobDocument,
} from '../schemas/publishing-job.schema';
import { Group, GroupDocument } from '../schemas/group.schema';

export class CreatePostDto {
  content!: string;
  mediaUrls?: string[];
  targetGroupIds!: string[]; // MongoDB _id strings of the groups to target
}

export interface ListPostsOptions {
  page?: number;
  limit?: number;
}

type LeanJobSummary = {
  _id: Types.ObjectId;
  postId: Types.ObjectId;
  groupId: Types.ObjectId;
  status: string;
  submissionStatus?: string;
  postUrl?: string;
  submissionReason?: string;
  attempts: number;
  error?: string;
  scheduledFor?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

type AggregatedPost = {
  _id: Types.ObjectId;
  content: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
  mediaCount: number;
};

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
  ) {}

  /**
   * Create a post and immediately spawn one PublishingJob per selected group.
   */
  async createPost(clerkUserId: string, dto: CreatePostDto) {
    const content = dto.content?.trim() ?? '';
    const mediaUrls = this.validateMediaUrls(dto.mediaUrls);

    if (!content && mediaUrls.length === 0) {
      throw new BadRequestException('Post content or media is required');
    }
    if (!dto.targetGroupIds?.length) {
      throw new BadRequestException(
        'At least one target group must be selected',
      );
    }

    // Validate all group IDs belong to the user
    const groups = await this.groupModel
      .find({
        _id: { $in: dto.targetGroupIds.map((id) => new Types.ObjectId(id)) },
        clerkUserId,
      })
      .exec();

    if (groups.length === 0) {
      throw new BadRequestException('No valid groups found for this user');
    }

    // Create the post
    const post = await this.postModel.create({
      clerkUserId,
      content,
      mediaUrls,
      status: 'PUBLISHING',
    });

    // Create one job per group
    const jobs = groups.map((group) => ({
      postId: post._id,
      groupId: group._id,
      status: 'PENDING',
      attempts: 0,
    }));

    await this.jobModel.insertMany(jobs);

    return {
      post: { ...post.toObject(), _id: post._id.toString() },
      jobsCreated: jobs.length,
    };
  }

  private validateMediaUrls(mediaUrls?: string[]) {
    if (!mediaUrls) return [];
    if (!Array.isArray(mediaUrls)) {
      throw new BadRequestException('Media must be an array');
    }
    if (mediaUrls.length > 4) {
      throw new BadRequestException('You can attach up to 4 images');
    }

    return mediaUrls.map((url) => {
      if (typeof url !== 'string' || !url.startsWith('data:image/')) {
        throw new BadRequestException(
          'Only image attachments are supported right now',
        );
      }
      if (url.length > 3_000_000) {
        throw new BadRequestException('Each image must be 2MB or smaller');
      }
      return url;
    });
  }

  /**
   * List all posts for the user, newest first, with job counts.
   */
  async getPosts(clerkUserId: string) {
    const posts = await this.postModel
      .find({ clerkUserId })
      .select('-mediaUrls')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // Attach job summary to each post
    const postIds = posts.map((p) => p._id);
    const jobs = (await this.jobModel
      .find({ postId: { $in: postIds } } as any)
      .lean()
      .exec()) as unknown as LeanJobSummary[];

    const jobsByPost = jobs.reduce<Record<string, LeanJobSummary[]>>(
      (acc, job) => {
        const key = job.postId.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(job);
        return acc;
      },
      {},
    );

    return posts.map((post) => ({
      ...post,
      _id: post._id.toString(),
      jobs: jobsByPost[post._id.toString()] ?? [],
    }));
  }

  async listPosts(clerkUserId: string, options: ListPostsOptions) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 10));
    const skip = (page - 1) * limit;

    const [rawPosts, total] = await Promise.all([
      this.postModel
        .aggregate([
          { $match: { clerkUserId } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              content: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              mediaCount: { $size: { $ifNull: ['$mediaUrls', []] } },
            },
          },
        ])
        .exec(),
      this.postModel.countDocuments({ clerkUserId }),
    ]);
    const posts = rawPosts as unknown as AggregatedPost[];

    const postIds = posts.map((p) => p._id);
    const jobs = (await this.jobModel
      .find({ postId: { $in: postIds } } as any)
      .lean()
      .exec()) as unknown as LeanJobSummary[];

    const jobsByPost = jobs.reduce<Record<string, LeanJobSummary[]>>(
      (acc, job) => {
        const key = job.postId.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(job);
        return acc;
      },
      {},
    );

    return {
      posts: posts.map((post) => ({
        ...post,
        _id: post._id.toString(),
        jobs: jobsByPost[post._id.toString()] ?? [],
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Get a single post with its jobs.
   */
  async getPost(clerkUserId: string, postId: string) {
    const post = await this.postModel
      .findOne({ _id: postId, clerkUserId })
      .lean()
      .exec();

    if (!post) throw new NotFoundException('Post not found');

    const jobs = await this.jobModel
      .find({ postId: post._id } as any)
      .populate('groupId', 'name url externalId')
      .lean()
      .exec();

    return {
      ...post,
      _id: post._id.toString(),
      jobs,
    };
  }

  async deleteAllPosts(clerkUserId: string) {
    const posts = await this.postModel
      .find({ clerkUserId })
      .select('_id')
      .lean()
      .exec();
    const postIds = posts.map((post) => post._id);
    if (postIds.length) {
      await this.jobModel
        .deleteMany({ postId: { $in: postIds } } as any)
        .exec();
    }
    await this.postModel.deleteMany({ clerkUserId }).exec();
  }
}

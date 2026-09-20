import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PostsService, CreatePostDto, UpdatePostScheduleDto } from './posts.service';

@Controller('api/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  /** POST /api/posts — create a new post and spawn publishing jobs */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Body() body: CreatePostDto,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.postsService.createPost(clerkUserId, body);
  }

  /** GET /api/posts — list all posts with job counts */
  @Get()
  async findAll(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    if (page || limit) {
      return this.postsService.listPosts(clerkUserId, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
    }
    return this.postsService.getPosts(clerkUserId);
  }

  /** GET /api/posts/:id — get a single post with its jobs */
  @Get(':id')
  async findOne(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.postsService.getPost(clerkUserId, id);
  }

  /** PATCH /api/posts/:id/schedule — reschedule future jobs only. */
  @Patch(':id/schedule')
  async updateSchedule(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
    @Body() body: UpdatePostScheduleDto,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.postsService.updatePostSchedule(clerkUserId, id, body);
  }

  /** DELETE /api/posts - delete all posts and their publishing jobs */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAll(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    await this.postsService.deleteAllPosts(clerkUserId);
  }

}

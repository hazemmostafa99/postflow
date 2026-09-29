import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
  ) {}

  @Get('posts')
  listPosts(
    @Headers('authorization') authorization: string | undefined,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    this.requireAnalyticsApiKey(authorization);
    return this.analyticsService.listPosts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      from,
      to,
      status,
    });
  }

  @Get('posts/:id')
  getPost(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    this.requireAnalyticsApiKey(authorization);
    return this.analyticsService.getPost(id);
  }

  private requireAnalyticsApiKey(authorization?: string) {
    const configuredKey = this.configService.get<string>(
      'POSTFLOW_ANALYTICS_API_KEY',
    );
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();

    if (!configuredKey || !token || token !== configuredKey) {
      throw new UnauthorizedException('Invalid analytics API key');
    }
  }
}

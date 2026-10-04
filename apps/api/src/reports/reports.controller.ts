import {
  Controller,
  Get,
  Headers,
  Query,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  overview(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('teamId') teamId?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!clerkUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }

    return this.reportsService.overview(clerkUserId, {
      from,
      to,
      teamId,
      userId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('export')
  async exportCsv(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('teamId') teamId?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
  ) {
    if (!clerkUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }

    const exportFile = await this.reportsService.exportCsv(
      clerkUserId,
      { from, to, teamId, userId },
      type,
    );
    return new StreamableFile(Buffer.from(exportFile.csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${exportFile.filename}"`,
    });
  }
}

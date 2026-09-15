import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { GroupsService, SyncGroupDto } from './groups.service';

class SyncGroupsDto {
  groups: SyncGroupDto[];
}

@Controller('api/groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  /**
   * Called by the Chrome Extension to sync discovered groups.
   * POST /api/groups/sync
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Body() body: SyncGroupsDto,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.groupsService.syncGroups(clerkUserId, body.groups ?? []);
  }

  /**
   * Called by the Web App to list or search all groups.
   * GET /api/groups?search=optional_query
   */
  @Get()
  async getGroups(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    if (page || limit) {
      return this.groupsService.listGroups(clerkUserId, {
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
    }
    if (search?.trim()) {
      return this.groupsService.searchGroups(clerkUserId, search.trim());
    }
    return this.groupsService.getGroups(clerkUserId);
  }

  /** DELETE /api/groups - delete all synced groups and their jobs */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAll(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    await this.groupsService.deleteAllGroups(clerkUserId);
  }

}

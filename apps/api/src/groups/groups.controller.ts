import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Headers,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { GroupsService, SyncGroupDto } from './groups.service';

class SyncGroupsDto {
  groups!: SyncGroupDto[];
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
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Body() body: SyncGroupsDto,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.groupsService.syncGroups(
      clerkUserId,
      body.groups ?? [],
      extensionInstanceId,
    );
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
    @Query('connectionId') connectionId?: string,
    @Query('connectionIds') connectionIds?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const requestedConnectionIds = connectionIds
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const groupConnectionIds = requestedConnectionIds?.length
      ? requestedConnectionIds
      : connectionId
        ? [connectionId]
        : undefined;
    if (page || limit) {
      return this.groupsService.listGroups(clerkUserId, {
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        connectionIds: groupConnectionIds,
      });
    }
    if (search?.trim()) {
      return this.groupsService.searchGroups(
        clerkUserId,
        search.trim(),
        groupConnectionIds,
      );
    }
    return this.groupsService.getGroups(clerkUserId, groupConnectionIds);
  }

  /** DELETE /api/groups/:id - delete one synced group and its jobs */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOne(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    await this.groupsService.deleteGroup(clerkUserId, id);
  }

  /** DELETE /api/groups - delete all synced groups and their jobs */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAll(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    await this.groupsService.deleteAllGroups(clerkUserId);
  }
}

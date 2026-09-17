import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { TeamsService } from './teams.service';

@Controller('api/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  list(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.teamsService.list(clerkUserId);
  }

  @Get(':id')
  get(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.teamsService.get(clerkUserId, id);
  }

  @Post()
  create(@Headers('x-clerk-user-id') clerkUserId: string, @Body() body: { name: string; managerId?: string | null }) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.teamsService.create(clerkUserId, body.name, body.managerId);
  }

  @Patch(':id')
  update(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string, @Body() body: { name?: string; managerId?: string | null }) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.teamsService.update(clerkUserId, id, body);
  }

  @Delete(':id/members/:userId')
  removeMember(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string, @Param('userId') userId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.teamsService.removeMember(clerkUserId, id, userId);
  }

  @Delete(':id')
  delete(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.teamsService.delete(clerkUserId, id);
  }
}

import { Body, Controller, Delete, Get, Headers, Param, Patch, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '../schemas/user.schema';
import { UsersService } from './users.service';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.usersService.list(clerkUserId);
  }

  @Get(':id')
  get(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.usersService.get(clerkUserId, id);
  }

  @Patch(':id')
  update(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string, @Body() body: { role?: UserRole; teamId?: string | null; status?: UserStatus }) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.usersService.update(clerkUserId, id, body);
  }

  @Patch(':id/status')
  status(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string, @Body() body: { status: UserStatus }) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.usersService.update(clerkUserId, id, { status: body.status });
  }

  @Patch(':id/team-assignment')
  assignToTeam(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string, @Body() body: { role: UserRole; teamId: string }) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.usersService.assignToTeam(clerkUserId, id, body);
  }

  @Delete(':id')
  delete(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.usersService.delete(clerkUserId, id);
  }
}

import { Body, Controller, Delete, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import type { CreateInvitationDto } from './invitations.service';

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get()
  list(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.invitationsService.list(clerkUserId);
  }

  @Post()
  create(@Headers('x-clerk-user-id') clerkUserId: string, @Body() body: CreateInvitationDto) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.invitationsService.create(clerkUserId, body);
  }

  @Delete(':id')
  revoke(@Headers('x-clerk-user-id') clerkUserId: string, @Param('id') id: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.invitationsService.revoke(clerkUserId, id);
  }

  /** Called by the trusted onboarding bridge after Clerk creates the invited user. */
  @Post('accept')
  accept(@Headers('x-postflow-internal-secret') secret: string, @Body() body: { invitationId: string; clerkUserId: string; email: string }) {
    if (!process.env.INVITATION_ACCEPT_SECRET || secret !== process.env.INVITATION_ACCEPT_SECRET) throw new UnauthorizedException('Internal invitation bridge authentication required');
    return this.invitationsService.accept(body);
  }
}

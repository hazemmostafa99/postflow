import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get('me')
  async me(@Headers('x-clerk-user-id') clerkUserId: string, @Headers('x-clerk-user-email') email?: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    const user = await this.authorization.requireOrProvisionActiveUser(clerkUserId, email);
    return { id: user._id.toString(), clerkUserId: user.clerkUserId, email: user.email, role: user.role, status: user.status, teamId: user.teamId ?? null };
  }
}

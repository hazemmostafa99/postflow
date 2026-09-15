import { Controller, Post, Body, HttpCode, HttpStatus, Headers, UnauthorizedException } from '@nestjs/common';
import { ExtensionsService } from './extensions.service';

class SessionDto {
  sessionDetected: boolean;
}

@Controller('api/extensions')
export class ExtensionsController {
  constructor(private readonly extensionsService: ExtensionsService) {}

  /**
   * Called when the extension starts up.
   * Registers or reactivates the installation for the user.
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.register(clerkUserId);
  }

  /**
   * Called by the extension every minute to signal it is alive.
   */
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.heartbeat(clerkUserId);
  }

  /**
   * Called by the extension when Facebook session status changes.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async session(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Body() body: SessionDto,
  ) {
    if (!clerkUserId) throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.updateSession(clerkUserId, body.sessionDetected);
  }
}

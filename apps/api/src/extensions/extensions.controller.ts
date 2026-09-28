import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { FacebookConnectionWorkerStatus } from '../schemas/facebook-connection.schema';
import { ExtensionsService } from './extensions.service';

class SessionDto {
  sessionDetected: boolean;
  facebookUserId?: string;
}

class WorkerStatusDto {
  workerStatus: FacebookConnectionWorkerStatus;
  reason?: string;
}

class ExtensionIdentityDto {
  extensionName?: unknown;
}

@Controller('api/extensions')
export class ExtensionsController {
  constructor(private readonly extensionsService: ExtensionsService) {}

  @Get('connections')
  async connections(@Headers('x-clerk-user-id') clerkUserId: string) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.listConnections(clerkUserId);
  }

  /**
   * Called when the extension starts up.
   * Registers or reactivates the installation for the user.
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Body() body?: ExtensionIdentityDto,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.register(clerkUserId, extensionInstanceId, body?.extensionName);
  }

  /**
   * Called by the extension every minute to signal it is alive.
   */
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Body() body?: ExtensionIdentityDto,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.heartbeat(clerkUserId, extensionInstanceId, body?.extensionName);
  }

  /**
   * Called by the extension when Facebook session status changes.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async session(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Body() body: SessionDto,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    return this.extensionsService.updateSession(
      clerkUserId,
      extensionInstanceId,
      body.sessionDetected,
      body.facebookUserId,
    );
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  async status(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-extension-instance-id') extensionInstanceId: string | undefined,
    @Body() body: WorkerStatusDto,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    if (!Object.values(FacebookConnectionWorkerStatus).includes(body.workerStatus)) {
      throw new UnauthorizedException('Invalid extension worker status');
    }
    return this.extensionsService.updateWorkerStatus(
      clerkUserId,
      extensionInstanceId,
      body.workerStatus,
      body.reason,
    );
  }
}

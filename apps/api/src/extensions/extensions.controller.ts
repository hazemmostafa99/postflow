import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
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

class ReconnectDto {
  connectionId?: string;
  createNewConnection?: boolean;
  confirmReplacement?: boolean;
  approvalToken?: string;
}

/**
 * Extension-facing surface.
 *
 * Worker routes (register/heartbeat/session/status/name) authenticate with the
 * `x-extension-instance-id` header plus the revocable `x-extension-credential`
 * header issued at registration time.
 *
 * Dashboard routes key off the `x-clerk-user-id` header and operate only on
 * connections owned by that user.
 */
@Controller('api/extensions')
export class ExtensionsController {
  constructor(private readonly extensionsService: ExtensionsService) {}

  private requireClerkUserId(clerkUserId?: string): string {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    return clerkUserId;
  }

  // ── Dashboard surfaces ────────────────────────────────────────────────────

  @Get('connections')
  async connections(@Headers('x-clerk-user-id') clerkUserId?: string) {
    return this.extensionsService.listConnections(
      this.requireClerkUserId(clerkUserId),
    );
  }

  @Get('connections/archived')
  async archivedConnections(@Headers('x-clerk-user-id') clerkUserId?: string) {
    return this.extensionsService.listArchivedConnections(
      this.requireClerkUserId(clerkUserId),
    );
  }

  @Patch('connections/:connectionId/name')
  @HttpCode(HttpStatus.OK)
  async renameConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Body() body?: ExtensionIdentityDto,
  ) {
    return this.extensionsService.renameConnection(
      this.requireClerkUserId(clerkUserId),
      connectionId,
      body?.extensionName,
    );
  }

  @Post('connections/:connectionId/pause')
  @HttpCode(HttpStatus.OK)
  async pauseConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
  ) {
    return this.extensionsService.pauseConnection(
      this.requireClerkUserId(clerkUserId),
      connectionId,
    );
  }

  @Post('connections/:connectionId/resume')
  @HttpCode(HttpStatus.OK)
  async resumeConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
  ) {
    return this.extensionsService.resumeConnection(
      this.requireClerkUserId(clerkUserId),
      connectionId,
    );
  }

  @Post('connections/:connectionId/disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnectConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
  ) {
    return this.extensionsService.disconnectConnection(
      this.requireClerkUserId(clerkUserId),
      connectionId,
      false,
    );
  }

  @Post('connections/:connectionId/force-disconnect')
  @HttpCode(HttpStatus.OK)
  async forceDisconnectConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
  ) {
    return this.extensionsService.disconnectConnection(
      this.requireClerkUserId(clerkUserId),
      connectionId,
      true,
    );
  }

  @Delete('connections/:connectionId')
  @HttpCode(HttpStatus.OK)
  async removeConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
  ) {
    return this.extensionsService.removeConnection(
      this.requireClerkUserId(clerkUserId),
      connectionId,
    );
  }

  @Post('connections/:connectionId/reconnect-approval')
  @HttpCode(HttpStatus.OK)
  async issueReconnectApproval(
    @Param('connectionId') connectionId: string,
    @Headers('x-clerk-user-id') clerkUserId?: string,
  ) {
    return this.extensionsService.issueReconnectApproval(
      this.requireClerkUserId(clerkUserId),
      connectionId,
    );
  }

  // ── Worker surfaces (credential-authenticated) ───────────────────────────

  /**
   * Called when the extension starts up. Registers the installation and
   * returns an explicit registration outcome. A revoked installation is never
   * reactivated here.
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Body() body?: ExtensionIdentityDto,
  ) {
    return this.extensionsService.register(
      this.requireClerkUserId(clerkUserId),
      extensionInstanceId,
      body?.extensionName,
      credential,
    );
  }

  /**
   * Called by the extension every minute to signal it is alive.
   */
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Body() body?: ExtensionIdentityDto,
  ) {
    return this.extensionsService.heartbeat(
      this.requireClerkUserId(clerkUserId),
      extensionInstanceId,
      body?.extensionName,
      credential,
    );
  }

  @Patch('name')
  @HttpCode(HttpStatus.OK)
  async rename(
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Body() body?: ExtensionIdentityDto,
  ) {
    return this.extensionsService.rename(
      this.requireClerkUserId(clerkUserId),
      extensionInstanceId,
      credential,
      body?.extensionName,
    );
  }

  /**
   * Called by the extension when Facebook session status changes.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async session(
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Body() body: SessionDto = new SessionDto(),
  ) {
    return this.extensionsService.updateSession(
      this.requireClerkUserId(clerkUserId),
      extensionInstanceId,
      credential,
      body.sessionDetected,
      body.facebookUserId,
    );
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  async status(
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Body() body: WorkerStatusDto = new WorkerStatusDto(),
  ) {
    return this.extensionsService.updateWorkerStatus(
      this.requireClerkUserId(clerkUserId),
      extensionInstanceId,
      credential,
      body.workerStatus,
      body.reason,
    );
  }

  /**
   * Explicit reinstall recovery: either rebinds this installation to an
   * existing connection the user chose (reconnect) or completes the
   * new-connection flow. Requires a verified Facebook identity and the
   * installation credential; archived targets additionally require a
   * dashboard-issued single-use approval code.
   */
  @Post('reconnect')
  @HttpCode(HttpStatus.OK)
  async reconnect(
    @Headers('x-clerk-user-id') clerkUserId?: string,
    @Headers('x-extension-instance-id') extensionInstanceId?: string,
    @Headers('x-extension-credential') credential?: string,
    @Body() body: ReconnectDto = new ReconnectDto(),
  ) {
    return this.extensionsService.reconnect(
      this.requireClerkUserId(clerkUserId),
      extensionInstanceId,
      credential,
      body,
    );
  }
}

jest.mock('@nestjs/mongoose', () => ({
  InjectModel: () => () => undefined,
  Prop: () => () => undefined,
  Schema: () => (target: unknown) => target,
  SchemaFactory: {
    createForClass: () => ({
      index: jest.fn(),
      pre: jest.fn(),
    }),
  },
}));

import { UnauthorizedException } from '@nestjs/common';
import { ExtensionsController } from './extensions.controller';
import { FacebookConnectionWorkerStatus } from '../schemas/facebook-connection.schema';

describe('ExtensionsController', () => {
  const service = {
    listConnections: jest.fn(),
    listArchivedConnections: jest.fn(),
    renameConnection: jest.fn(),
    pauseConnection: jest.fn(),
    resumeConnection: jest.fn(),
    disconnectConnection: jest.fn(),
    removeConnection: jest.fn(),
    issueReconnectApproval: jest.fn(),
    register: jest.fn(),
    heartbeat: jest.fn(),
    rename: jest.fn(),
    updateSession: jest.fn(),
    updateWorkerStatus: jest.fn(),
    updatePlatformConnectionWorkerStatus: jest.fn(),
    updatePlatformSession: jest.fn(),
    listInstallations: jest.fn(),
    listBrowserConnections: jest.fn(),
    updateBrowserConnection: jest.fn(),
    browserConnectionAction: jest.fn(),
    createPlatformConnection: jest.fn(),
  };

  type Service = typeof service;

  function createController(): ExtensionsController {
    const clone: Service = { ...service };
    for (const key of Object.keys(clone) as Array<keyof Service>) {
      clone[key] = jest.fn();
    }
    return new ExtensionsController(clone as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a clerk user id for dashboard routes', async () => {
    const controller = createController();
    await expect(controller.browserConnections(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.renameBrowserConnection('', 'installation-1', { name: 'Work' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.browserConnectionAction('', 'installation-1', 'pause')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.connections(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller.pauseConnection('connection-1', undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires a clerk user id for worker routes', async () => {
    const controller = createController();
    await expect(
      controller.register(undefined, 'extension-1', 'credential'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.heartbeat(undefined, 'extension-1', 'credential', {
        extensionName: 'PC',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.status(undefined, 'extension-1', 'credential', {
        workerStatus: FacebookConnectionWorkerStatus.IDLE,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('forwards the worker credential on register and heartbeat', async () => {
    const controller = createController();
    const register = (controller as unknown as {
      extensionsService: Service;
    }).extensionsService.register as jest.Mock;
    const heartbeat = (controller as unknown as {
      extensionsService: Service;
    }).extensionsService.heartbeat as jest.Mock;

    await controller.register('user-1', 'extension-1', 'credential-1', {
      extensionName: 'Office PC',
    });
    expect(register).toHaveBeenCalledWith(
      'user-1',
      'extension-1',
      'Office PC',
      'credential-1',
    );

    await controller.heartbeat('user-1', 'extension-1', 'credential-1', {
      extensionName: 'Office PC',
    });
    expect(heartbeat).toHaveBeenCalledWith(
      'user-1',
      'extension-1',
      'Office PC',
      'credential-1',
    );
  });

  it('forwards the worker credential to session and status routes', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };

    await controller.session('user-1', 'extension-1', 'credential-1', {
      sessionDetected: true,
      facebookUserId: 'fb-1',
    });
    expect(internal.extensionsService.updateSession).toHaveBeenCalledWith(
      'user-1',
      'extension-1',
      'credential-1',
      true,
      'fb-1',
    );

    await controller.status('user-1', 'extension-1', 'credential-1', {
      workerStatus: FacebookConnectionWorkerStatus.BLOCKED,
      reason: 'checkpoint',
    });
    expect(internal.extensionsService.updateWorkerStatus).toHaveBeenCalledWith(
      'user-1',
      'extension-1',
      'credential-1',
      FacebookConnectionWorkerStatus.BLOCKED,
      'checkpoint',
    );
  });

  it('forwards platform session identity without binding it automatically', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };

    await controller.platformSession('user-1', 'extension-1', 'credential-1', {
      platform: 'INSTAGRAM',
      sessionDetected: true,
      externalUsername: 'brand.account',
    });

    expect(internal.extensionsService.updatePlatformSession).toHaveBeenCalledWith(
      'INSTAGRAM',
      'user-1',
      'extension-1',
      'credential-1',
      true,
      undefined,
      'brand.account',
    );
  });

  it('forwards TikTok session identity to the generic connection service', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };

    await controller.platformSession('user-1', 'extension-1', 'credential-1', {
      platform: 'TIKTOK',
      sessionDetected: true,
      externalUsername: 'creator.account',
    });

    expect(internal.extensionsService.updatePlatformSession).toHaveBeenCalledWith(
      'TIKTOK',
      'user-1',
      'extension-1',
      'credential-1',
      true,
      undefined,
      'creator.account',
    );
  });

  it('forwards explicit Instagram evidence state and source', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };
    await controller.platformSession('user-1', 'extension-1', 'credential-1', {
      platform: 'INSTAGRAM', sessionDetected: false,
      evidenceState: 'CHECKING', evidenceSource: 'none',
    });
    expect(internal.extensionsService.updatePlatformSession).toHaveBeenCalledWith(
      'INSTAGRAM', 'user-1', 'extension-1', 'credential-1', false,
      undefined, undefined, { state: 'CHECKING', source: 'none' },
    );
  });

  it('forwards explicit Instagram connection creation to the service', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };

    await controller.createPlatformConnection('user-1', {
      platform: 'INSTAGRAM',
      installationId: '507f1f77bcf86cd799439011',
      displayName: 'Brand Instagram',
      externalUsername: '@brand.account',
    });

    expect(internal.extensionsService.createPlatformConnection).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ platform: 'INSTAGRAM', externalUsername: '@brand.account' }),
    );
  });

  it('maps dashboard lifecycle routes to owned connections', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };

    await controller.pauseConnection('connection-1', 'user-1');
    expect(internal.extensionsService.pauseConnection).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
    );

    await controller.resumeConnection('connection-1', 'user-1');
    expect(internal.extensionsService.resumeConnection).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
    );

    await controller.disconnectConnection('connection-1', 'user-1');
    expect(internal.extensionsService.disconnectConnection).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
      false,
    );

    await controller.forceDisconnectConnection('connection-1', 'user-1');
    expect(internal.extensionsService.disconnectConnection).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
      true,
    );

    await controller.removeConnection('connection-1', 'user-1');
    expect(internal.extensionsService.removeConnection).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
    );

    await controller.issueReconnectApproval('connection-1', 'user-1');
    expect(
      internal.extensionsService.issueReconnectApproval,
    ).toHaveBeenCalledWith('user-1', 'connection-1');
  });

  it('maps archived and rename dashboard routes', async () => {
    const controller = createController();
    const internal = controller as unknown as { extensionsService: Service };

    await controller.archivedConnections('user-1');
    expect(internal.extensionsService.listArchivedConnections).toHaveBeenCalledWith(
      'user-1',
    );

    await controller.renameConnection('connection-1', 'user-1', {
      extensionName: 'New Name',
    });
    expect(internal.extensionsService.renameConnection).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
      'New Name',
    );
  });
});

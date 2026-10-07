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
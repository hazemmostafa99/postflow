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

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExtensionLifecycleAuditEventName } from '../schemas/extension-lifecycle-audit.schema';
import {
  ExtensionLifecycleStatus,
  ExtensionRevocationReason,
} from '../schemas/extension-installation.schema';
import {
  FacebookConnectionStatus,
  FacebookConnectionWorkerStatus,
} from '../schemas/facebook-connection.schema';
import {
  PlatformConnectionStatus,
  PlatformConnectionWorkerStatus,
} from '../schemas/platform-connection.schema';
import { hashInstallationCredential } from './installation-credential';
import {
  ExtensionsService,
  RECONNECT_APPROVAL_TTL_MS,
  deriveConnectivity,
  normalizeExtensionName,
  normalizeExtensionNameKey,
} from './extensions.service';

function installationDoc(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    clerkUserId: 'clerk-user-1',
    extensionInstanceId: 'extension-1',
    status: ExtensionLifecycleStatus.ACTIVE,
    statusChangedAt: new Date(),
    statusChangedByClerkUserId: undefined,
    statusReason: undefined,
    lastHeartbeat: new Date(),
    facebookConnectionId: undefined as unknown,
    facebookSessionDetected: false,
    credentialHash: undefined,
    credentialVersion: 0,
    credentialRevokedAt: undefined,
    save: jest.fn().mockImplementation(function save(this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
  return doc as never;
}

function connectionDoc(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    clerkUserId: 'clerk-user-1',
    extensionInstanceId: 'extension-1',
    status: FacebookConnectionStatus.PENDING,
    workerStatus: FacebookConnectionWorkerStatus.OFFLINE,
    facebookSessionDetected: false,
    lastSeenAt: new Date(),
    archivedAt: undefined,
    set: jest.fn().mockImplementation(function set(
      this: Record<string, unknown>,
      values: Record<string, unknown>,
    ) {
      Object.assign(this, values);
    }),
    save: jest.fn().mockImplementation(function save(this: unknown) {
      return Promise.resolve(this);
    }),
    toObject: jest.fn(function toObject(this: Record<string, unknown>) {
      return { ...this };
    }),
    ...overrides,
  };
  return doc as never;
}

type HarnessOptions = {
  installation?: Record<string, unknown> | null;
  connection?: Record<string, unknown> | null;
  hasActiveClaim?: boolean;
} & Record<string, unknown>;

function createHarness(options: HarnessOptions = {}) {
  const installation =
    options.installation === undefined
      ? installationDoc()
      : options.installation;
  const connection =
    options.connection === undefined ? connectionDoc() : options.connection;

  const extensionModel = {
    findOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(installation) }),
    findById: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    create: jest.fn().mockResolvedValue(installation),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const transactionSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    inTransaction: jest.fn().mockReturnValue(true),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const connectionModel = {
    ...(options.withTransactions
      ? {
          db: {
            startSession: jest.fn().mockResolvedValue(transactionSession),
          },
        }
      : {}),
    findById: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(connection) }),
    findOne: jest.fn(
      (query: {
        _id?: string | Types.ObjectId;
        clerkUserId?: string;
        extensionInstanceId?: string;
        reconnectApprovalTokenHash?: string;
      }) => {
        if (
          query._id &&
          (!connection ||
            String(query._id) !==
              String((connection as { _id?: string | Types.ObjectId })._id))
        ) {
          return { exec: jest.fn().mockResolvedValue(null) };
        }
        // The instance-id fallback only matches a connection created for that
        // exact installation (models an unbound reinstall having no connection).
        if (
          query.extensionInstanceId !== undefined &&
          connection &&
          query.extensionInstanceId !== connection.extensionInstanceId
        ) {
          return { exec: jest.fn().mockResolvedValue(null) };
        }
        if (
          query.reconnectApprovalTokenHash !== undefined &&
          connection &&
          query.reconnectApprovalTokenHash !==
            connection.reconnectApprovalTokenHash
        ) {
          return { exec: jest.fn().mockResolvedValue(null) };
        }
        return { exec: jest.fn().mockResolvedValue(connection) };
      },
    ),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    findOneAndUpdate: jest.fn().mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(connection),
    }),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const jobModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue(options.hasActiveClaim ? { _id: 'job-1' } : null),
    }),
  };
  const auditModel = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ExtensionsService(
    extensionModel as never,
    connectionModel as never,
    jobModel as never,
    auditModel as never,
  );

  return {
    service,
    extensionModel,
    connectionModel,
    jobModel,
    auditModel,
    installation,
    connection,
    transactionSession,
  };
}

const credential = 'cred-secret';
const credentialHash = hashInstallationCredential(credential);

describe('ExtensionsService.verifyWorkerIdentity', () => {
  it('rejects requests without a clerk user id', async () => {
    const { service } = createHarness({ installation: null });
    await expect(
      service.verifyWorkerIdentity(
        undefined as unknown as string,
        'extension-1',
      ),
    ).rejects.toThrow('x-clerk-user-id header is required');
  });

  it('rejects requests without an extension instance id', async () => {
    const { service } = createHarness({ installation: null });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', '   '),
    ).rejects.toThrow('x-extension-instance-id header is required');
  });

  it('rejects an unregistered installation', async () => {
    const { service } = createHarness({ installation: null });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1'),
    ).rejects.toThrow('Please register first');
  });

  it('rejects a revoked installation before touching the credential', async () => {
    const revoked = installationDoc({
      status: ExtensionLifecycleStatus.REVOKED,
      credentialHash,
      revocationReason: ExtensionRevocationReason.USER_DISCONNECTED,
    });
    const { service } = createHarness({ installation: revoked });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1', credential),
    ).rejects.toThrow('has been revoked');
  });

  it('accepts a legacy installation without a credential hash', async () => {
    const legacy = installationDoc({ credentialHash: undefined });
    const { service } = createHarness({ installation: legacy });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1'),
    ).resolves.toBe(legacy);
  });

  it('requires the credential once a hash has been issued', async () => {
    const issued = installationDoc({ credentialHash });
    const { service } = createHarness({ installation: issued });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a wrong credential', async () => {
    const issued = installationDoc({ credentialHash });
    const { service } = createHarness({ installation: issued });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1', 'wrong'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a credential that was revoked', async () => {
    const revokedCredential = installationDoc({
      credentialHash,
      credentialRevokedAt: new Date(),
    });
    const { service } = createHarness({ installation: revokedCredential });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1', credential),
    ).rejects.toThrow('credential has been revoked');
  });

  it('accepts the matching credential', async () => {
    const issued = installationDoc({ credentialHash });
    const { service } = createHarness({ installation: issued });
    await expect(
      service.verifyWorkerIdentity('clerk-user-1', 'extension-1', credential),
    ).resolves.toBe(issued);
  });
});

describe('ExtensionsService.register', () => {
  it('registers a brand-new UNBOUND installation without creating a connection', async () => {
    const created = installationDoc({ _id: new Types.ObjectId() });
    const { service, extensionModel, connectionModel, auditModel } =
      createHarness({ installation: null, connection: connectionDoc() });
    extensionModel.create.mockResolvedValue(created);

    const result = await service.register('clerk-user-1', 'extension-1');

    expect(result.status).toBe('NEW_INSTALLATION');
    expect(result.credentialIssued).toMatch(/^pfc_/);
    expect(result.connectionId).toBeNull();
    expect(extensionModel.create).toHaveBeenCalledTimes(1);
    const createCalls = extensionModel.create.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const createdArgs = createCalls[0][0];
    expect(createdArgs.status).toBe(ExtensionLifecycleStatus.ACTIVE);
    expect(createdArgs.credentialVersion).toBe(1);
    expect(createdArgs.credentialIssuedAt).toBeInstanceOf(Date);
    // A reinstall never inherits or auto-creates a connection at register.
    expect(createdArgs.facebookConnectionId).toBeUndefined();
    expect(hashInstallationCredential(result.credentialIssued as string)).toBe(
      createdArgs.credentialHash,
    );
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(connectionModel.updateOne).not.toHaveBeenCalled();
    expect(auditModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ExtensionLifecycleAuditEventName.INSTALLATION_REGISTERED,
        actor: 'WORKER',
      }),
    );
  });

  it('offers recovery candidates on register for an unbound, identity-verified installation', async () => {
    const existing = installationDoc({
      credentialHash,
      credentialVersion: 1,
      facebookSessionDetected: true,
      detectedFacebookUserId: 'fb-user-1',
    });
    const previousConnection = connectionDoc({
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: new Types.ObjectId(),
    });
    const { service, extensionModel, connectionModel } = createHarness({
      installation: existing,
      connection: null,
    });
    connectionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([previousConnection]),
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        installationDoc({
          status: ExtensionLifecycleStatus.REVOKED,
          lastHeartbeat: new Date(Date.now() - 60 * 60 * 1000),
        }),
      ),
    });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('RECOVERY_AVAILABLE');
    const outcome = result as {
      status: string;
      candidates: Array<{
        connectionId: string;
        activeInstallationOnline: boolean;
      }>;
    };
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0].connectionId).toBe(
      String(previousConnection._id),
    );
    expect(outcome.candidates[0].activeInstallationOnline).toBe(false);
  });

  it('refreshes a known ACTIVE installation without reissuing a credential', async () => {
    const connectionRef = connectionDoc();
    const existing = installationDoc({
      credentialHash,
      credentialVersion: 1,
      facebookConnectionId: connectionRef._id,
    });
    const { service, extensionModel } = createHarness({
      installation: existing,
      connection: connectionRef,
    });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('ACTIVE');
    expect(result.credentialIssued).toBeUndefined();
    expect(extensionModel.create).not.toHaveBeenCalled();
    expect((existing as { lastHeartbeat: Date }).lastHeartbeat).toBeInstanceOf(
      Date,
    );
  });

  it('keeps a PAUSED installation paused and never reactivates it', async () => {
    const pausedBefore = installationDoc({
      status: ExtensionLifecycleStatus.PAUSED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({ installation: pausedBefore });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('PAUSED');
    expect((pausedBefore as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.PAUSED,
    );
  });

  it('returns REVOKED for a revoked tombstone and never mutates it', async () => {
    const revoked = installationDoc({
      status: ExtensionLifecycleStatus.REVOKED,
      credentialHash,
      credentialRevokedAt: new Date(),
      revocationReason: ExtensionRevocationReason.USER_DISCONNECTED,
    });
    const { service, extensionModel, connectionModel } = createHarness({
      installation: revoked,
    });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('REVOKED');
    expect(result.reason).toBe(ExtensionRevocationReason.USER_DISCONNECTED);
    expect(extensionModel.create).not.toHaveBeenCalled();
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect((revoked as { save: jest.Mock }).save).not.toHaveBeenCalled();
  });

  it('returns REVOKE_PENDING while an active claim is still in flight', async () => {
    const pending = installationDoc({
      status: ExtensionLifecycleStatus.REVOKE_PENDING,
      statusReason: ExtensionRevocationReason.USER_DISCONNECTED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({
      installation: pending,
      hasActiveClaim: true,
    });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('REVOKE_PENDING');
    expect((pending as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.REVOKE_PENDING,
    );
  });

  it('finalizes a claim-free REVOKE_PENDING installation and reports REVOKED', async () => {
    const pending = installationDoc({
      status: ExtensionLifecycleStatus.REVOKE_PENDING,
      statusChangedByClerkUserId: 'clerk-user-1',
      statusReason: ExtensionRevocationReason.USER_DISCONNECTED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({
      installation: pending,
      hasActiveClaim: false,
    });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('REVOKED');
    const doc = pending as {
      status: ExtensionLifecycleStatus;
      credentialRevokedAt?: Date;
      revokedAt?: Date;
    };
    expect(doc.status).toBe(ExtensionLifecycleStatus.REVOKED);
    expect(doc.credentialRevokedAt).toBeInstanceOf(Date);
    expect(doc.revokedAt).toBeInstanceOf(Date);
  });
});

type InstallationSnapshot = {
  _id: Types.ObjectId;
  status: ExtensionLifecycleStatus;
  facebookConnectionId?: unknown;
  facebookSessionDetected?: boolean;
  detectedFacebookUserId?: string;
  lastHeartbeat?: Date;
  revocationReason?: string;
  replacedByInstallationId?: Types.ObjectId;
  [key: string]: unknown;
};

type ConnectionSnapshot = {
  _id: Types.ObjectId;
  extensionInstanceId?: string;
  facebookUserId?: string;
  status?: string;
  workerStatus?: string;
  archivedAt?: Date;
  activeExtensionInstallationId?: Types.ObjectId;
  reconnectApprovalTokenHash?: string;
  reconnectApprovalExpiresAt?: Date;
  reconnectApprovalUsedAt?: Date;
  [key: string]: unknown;
};

describe('ExtensionsService.updateSession recovery', () => {
  it('keeps an unbound installation unbound while no session is detected', async () => {
    const unbound = installationDoc({
      credentialHash,
      credentialVersion: 1,
    });
    const { service, connectionModel } = createHarness({
      installation: unbound,
      connection: null,
    });

    const result = await service.updateSession(
      'clerk-user-1',
      'extension-1',
      credential,
      false,
    );

    expect(result.connection).toBeNull();
    expect(result.recoveryCandidates).toEqual([]);
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(unbound.facebookConnectionId).toBeUndefined();
  });

  it('surfaces recovery candidates without binding on identity match', async () => {
    const unbound = installationDoc({
      credentialHash,
      credentialVersion: 1,
    });
    const previousConnection = connectionDoc({
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: new Types.ObjectId(),
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel } = createHarness({
      installation: unbound,
      connection: null,
    });
    connectionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([previousConnection]),
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        installationDoc({
          lastHeartbeat: new Date(Date.now() - 60 * 60 * 1000),
        }),
      ),
    });

    const result = await service.updateSession(
      'clerk-user-1',
      'extension-1',
      credential,
      true,
      'fb-user-1',
    );

    expect(result.connection).toBeNull();
    expect(result.recoveryCandidates).toHaveLength(1);
    expect(result.recoveryCandidates[0]).toMatchObject({
      connectionId: String(previousConnection._id),
      activeInstallationOnline: false,
    });
    expect(unbound.facebookSessionDetected).toBe(true);
    expect(unbound.detectedFacebookUserId).toBe('fb-user-1');
    // Identity match alone must never bind.
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(unbound.facebookConnectionId).toBeUndefined();
  });

  it('excludes live workers and includes revoked-online or missing installations', async () => {
    const unbound = installationDoc({
      credentialHash,
      credentialVersion: 1,
    });
    const liveConnection = connectionDoc({
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: new Types.ObjectId(),
    }) as ConnectionSnapshot;
    const revokedOnlineConnection = connectionDoc({
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: new Types.ObjectId(),
    }) as ConnectionSnapshot;
    const orphanConnection = connectionDoc({
      facebookUserId: 'fb-user-1',
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel } = createHarness({
      installation: unbound,
      connection: null,
    });
    connectionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue([
          liveConnection,
          revokedOnlineConnection,
          orphanConnection,
        ]),
    });
    extensionModel.findById
      .mockReturnValueOnce({
        exec: jest
          .fn()
          .mockResolvedValue(installationDoc({ lastHeartbeat: new Date() })),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(
          installationDoc({
            status: ExtensionLifecycleStatus.REVOKED,
            lastHeartbeat: new Date(),
          }),
        ),
      });

    const result = await service.updateSession(
      'clerk-user-1',
      'extension-1',
      credential,
      true,
      'fb-user-1',
    );

    expect(
      result.recoveryCandidates.map((candidate) => candidate.connectionId),
    ).toEqual([
      String(revokedOnlineConnection._id),
      String(orphanConnection._id),
    ]);
    expect(result.recoveryCandidates[0].activeInstallationOnline).toBe(true);
    expect(result.recoveryCandidates[1].activeInstallationOnline).toBe(false);
  });

  it('completes the new-connection flow when no recoverable connection exists', async () => {
    const unbound = installationDoc({
      credentialHash,
      credentialVersion: 1,
    }) as InstallationSnapshot;
    const createdConnection = connectionDoc({
      extensionInstanceId: 'extension-1',
      facebookUserId: 'fb-user-1',
      status: FacebookConnectionStatus.CONNECTED,
    }) as ConnectionSnapshot;
    const { service, connectionModel } = createHarness({
      installation: unbound,
      connection: null,
    });
    connectionModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createdConnection),
    });

    const result = await service.updateSession(
      'clerk-user-1',
      'extension-1',
      credential,
      true,
      'fb-user-1',
    );

    expect(result.connection).toMatchObject({
      _id: String(createdConnection._id),
    });
    expect(result.recoveryCandidates).toEqual([]);
    expect(unbound.facebookConnectionId).toBe(createdConnection._id);
    expect(connectionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = connectionModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set).toMatchObject({
      status: FacebookConnectionStatus.CONNECTED,
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: unbound._id,
    });
  });

  it('keeps a bound installation on its connection with no candidates', async () => {
    const bound = installationDoc({
      credentialHash,
      credentialVersion: 1,
      facebookConnectionId: undefined,
    }) as InstallationSnapshot;
    const existingConnection = connectionDoc({
      facebookUserId: 'fb-user-1',
      status: FacebookConnectionStatus.LOGIN_REQUIRED,
    }) as ConnectionSnapshot;
    bound.facebookConnectionId = existingConnection._id;
    const { service } = createHarness({
      installation: bound,
      connection: existingConnection,
    });

    const result = await service.updateSession(
      'clerk-user-1',
      'extension-1',
      credential,
      true,
      'fb-user-1',
    );

    expect(result.connection).toMatchObject({
      _id: String(existingConnection._id),
      status: FacebookConnectionStatus.CONNECTED,
    });
    expect(result.recoveryCandidates).toEqual([]);
    expect(bound.detectedFacebookUserId).toBe('fb-user-1');
  });
});

describe('ExtensionsService.updatePlatformSession', () => {
  it('marks an owned Instagram connection mismatched without rebinding it', async () => {
    const harness = createHarness();
    const platformConnection = {
      _id: new Types.ObjectId(),
      clerkUserId: 'clerk-user-1',
      platform: 'INSTAGRAM',
      activeExtensionInstallationId: harness.installation._id,
      externalAccountId: undefined,
      externalUsername: 'expected.account',
      detectedExternalUsername: undefined,
      status: PlatformConnectionStatus.CONNECTED,
      workerStatus: PlatformConnectionWorkerStatus.IDLE,
      sessionDetected: true,
      lastSeenAt: new Date(),
      save: jest.fn().mockImplementation(function save(this: unknown) {
        return Promise.resolve(this);
      }),
      toObject: jest.fn(function toObject(this: Record<string, unknown>) {
        return { ...this };
      }),
    };
    const platformConnectionModel = {
      findOne: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(platformConnection),
      })),
    };
    const service = new ExtensionsService(
      harness.extensionModel as never,
      harness.connectionModel as never,
      harness.jobModel as never,
      harness.auditModel as never,
      platformConnectionModel as never,
    );

    const result = await service.updatePlatformSession(
      'INSTAGRAM',
      'clerk-user-1',
      'extension-1',
      undefined,
      true,
      undefined,
      'different.account',
    );

    expect(platformConnection.status).toBe(PlatformConnectionStatus.ACCOUNT_MISMATCH);
    expect(platformConnection.workerStatus).toBe(
      PlatformConnectionWorkerStatus.ACCOUNT_MISMATCH,
    );
    expect(platformConnection.detectedExternalUsername).toBe('different.account');
    expect(platformConnection.save).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      platform: 'INSTAGRAM',
      status: PlatformConnectionStatus.ACCOUNT_MISMATCH,
    }));
  });
});

describe('ExtensionsService.reconnect', () => {
  const approvalToken = 'pfc_reconnect_approval_code';

  function identityVerifiedInstallation(
    overrides: Record<string, unknown> = {},
  ): InstallationSnapshot {
    return installationDoc({
      credentialHash,
      credentialVersion: 1,
      facebookSessionDetected: true,
      detectedFacebookUserId: 'fb-user-1',
      ...overrides,
    });
  }

  it('rejects a reconnect before the Facebook identity is verified', async () => {
    const unbound = installationDoc({
      credentialHash,
      credentialVersion: 1,
    }) as InstallationSnapshot;
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
    }) as ConnectionSnapshot;
    const { service, connectionModel } = createHarness({
      installation: unbound,
      connection: target,
    });

    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(target._id),
      }),
    ).rejects.toThrow('Facebook identity has not been verified');
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a reconnect when the detected account does not match', async () => {
    const installation = identityVerifiedInstallation({
      detectedFacebookUserId: 'fb-user-other',
    });
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
    }) as ConnectionSnapshot;
    const { service, connectionModel } = createHarness({
      installation,
      connection: target,
    });

    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(target._id),
      }),
    ).rejects.toThrow('does not match this connection');
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a connection owned by another user', async () => {
    const installation = identityVerifiedInstallation();
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
    }) as ConnectionSnapshot;
    const { service } = createHarness({
      installation,
      connection: target,
    });

    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(new Types.ObjectId()),
      }),
    ).rejects.toThrow('Facebook connection not found.');
  });

  it('claims the connection, revokes the previous worker with REPLACED, and binds the new installation', async () => {
    const installation = identityVerifiedInstallation();
    const previousInstallation = installationDoc({
      lastHeartbeat: new Date(Date.now() - 60 * 60 * 1000),
    }) as InstallationSnapshot;
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: previousInstallation._id,
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel, auditModel } =
      createHarness({ installation, connection: target });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(previousInstallation),
    });

    const result = await service.reconnect(
      'clerk-user-1',
      'extension-1',
      credential,
      { connectionId: String(target._id) },
    );

    // A single guarded write decides the single winner of the swap.
    expect(connectionModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: target._id,
        $or: [
          { activeExtensionInstallationId: previousInstallation._id },
          { activeExtensionInstallationId: installation._id },
        ],
      },
      expect.objectContaining({
        // Jest asymmetric matchers are intentionally dynamic test values.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        $set: expect.objectContaining({
          activeExtensionInstallationId: installation._id,
          extensionInstanceId: 'extension-1',
        }),
      }),
      { returnDocument: 'after' },
    );
    // The old installation is revoked with reason REPLACED.
    expect(previousInstallation.status).toBe(ExtensionLifecycleStatus.REVOKED);
    expect(previousInstallation.revocationReason).toBe(
      ExtensionRevocationReason.REPLACED,
    );
    expect(previousInstallation.replacedByInstallationId).toBe(
      installation._id,
    );
    // The new installation becomes the only holder of the connection.
    expect(installation.facebookConnectionId).toBe(target._id);
    const auditEvents = auditModel.create.mock.calls.map(
      (call: Array<Record<string, unknown>>) => call[0]?.event,
    );
    expect(auditEvents).toContain(
      ExtensionLifecycleAuditEventName.INSTALLATION_REVOKED,
    );
    expect(auditEvents).toContain(
      ExtensionLifecycleAuditEventName.INSTALLATION_REPLACED,
    );
    expect(auditEvents).toContain(
      ExtensionLifecycleAuditEventName.RECOVERY_ACCEPTED,
    );
    expect(result).toMatchObject({
      connectionId: String(target._id),
    });
  });

  it('commits the winning claim, old revocation, and new binding in one transaction', async () => {
    const installation = identityVerifiedInstallation();
    const previousInstallation = installationDoc({
      lastHeartbeat: new Date(Date.now() - 60 * 60 * 1000),
    }) as InstallationSnapshot;
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: previousInstallation._id,
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel, transactionSession } =
      createHarness({
        installation,
        connection: target,
        withTransactions: true,
      });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(previousInstallation),
    });

    await service.reconnect('clerk-user-1', 'extension-1', credential, {
      connectionId: String(target._id),
    });

    expect(transactionSession.startTransaction).toHaveBeenCalledTimes(1);
    expect(transactionSession.commitTransaction).toHaveBeenCalledTimes(1);
    expect(transactionSession.abortTransaction).not.toHaveBeenCalled();
    expect(transactionSession.endSession).toHaveBeenCalledTimes(1);
    const claimQuery = connectionModel.findOneAndUpdate.mock.results[0]
      .value as {
      session: jest.Mock;
    };
    expect(claimQuery.session).toHaveBeenCalledWith(transactionSession);
    expect(previousInstallation.save).toHaveBeenCalledWith({
      session: transactionSession,
    });
    expect(installation.save).toHaveBeenCalledWith({
      session: transactionSession,
    });
  });

  it('requires stronger confirmation while the previous worker is still online', async () => {
    const installation = identityVerifiedInstallation();
    const previousInstallation = installationDoc({
      lastHeartbeat: new Date(),
    }) as InstallationSnapshot;
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: previousInstallation._id,
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel } = createHarness({
      installation,
      connection: target,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(previousInstallation),
    });

    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(target._id),
      }),
    ).rejects.toThrow('REPLACEMENT_CONFIRMATION_REQUIRED');
    // Nothing was claimed or revoked before the user confirmed.
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(previousInstallation.status).toBe(ExtensionLifecycleStatus.ACTIVE);

    await service.reconnect('clerk-user-1', 'extension-1', credential, {
      connectionId: String(target._id),
      confirmReplacement: true,
    });

    expect(connectionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(previousInstallation.status).toBe(ExtensionLifecycleStatus.REVOKED);
    expect(installation.facebookConnectionId).toBe(target._id);
  });

  it('lets only one of two concurrent reconnect attempts win', async () => {
    const installation = identityVerifiedInstallation();
    const previousInstallation = installationDoc({
      lastHeartbeat: new Date(Date.now() - 60 * 60 * 1000),
    }) as InstallationSnapshot;
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
      activeExtensionInstallationId: previousInstallation._id,
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel } = createHarness({
      installation,
      connection: target,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(previousInstallation),
    });
    // Another installation claimed the connection between read and write.
    connectionModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(target._id),
      }),
    ).rejects.toThrow('RECONNECT_CONFLICT');
    // The loser never revokes the old worker or binds itself.
    expect(previousInstallation.status).toBe(ExtensionLifecycleStatus.ACTIVE);
    expect(installation.facebookConnectionId).toBeUndefined();
  });

  it('treats a retry of a completed restore as success without redoing the swap', async () => {
    const installation = identityVerifiedInstallation({
      facebookConnectionId: undefined,
    });
    const target = connectionDoc({
      extensionInstanceId: 'extension-1',
      facebookUserId: 'fb-user-1',
      archivedAt: new Date(Date.now() - 60_000),
      reconnectApprovalTokenHash: hashInstallationCredential(approvalToken),
      reconnectApprovalExpiresAt: new Date(Date.now() - 1_000),
      reconnectApprovalUsedAt: new Date(Date.now() - 500),
    }) as ConnectionSnapshot;
    installation.facebookConnectionId = target._id;
    const { service, connectionModel } = createHarness({
      installation,
      connection: target,
    });

    const result = await service.reconnect(
      'clerk-user-1',
      'extension-1',
      credential,
      { connectionId: String(target._id), approvalToken },
    );

    expect(result).toMatchObject({ connectionId: String(target._id) });
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('restores an archived connection only with an unexpired single-use approval', async () => {
    const installation = identityVerifiedInstallation();
    const previousInstallation = installationDoc({
      lastHeartbeat: new Date(Date.now() - 60 * 60 * 1000),
    }) as InstallationSnapshot;
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
      archivedAt: new Date(Date.now() - 60_000),
      activeExtensionInstallationId: previousInstallation._id,
      reconnectApprovalTokenHash: hashInstallationCredential(approvalToken),
      reconnectApprovalExpiresAt: new Date(Date.now() + 60_000),
    }) as ConnectionSnapshot;
    const { service, connectionModel, extensionModel } = createHarness({
      installation,
      connection: target,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(previousInstallation),
    });

    // No approval code → refused.
    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(target._id),
      }),
    ).rejects.toThrow('requires a reconnect approval code');

    // Expired approval → refused.
    target.reconnectApprovalExpiresAt = new Date(Date.now() - 1_000);
    await expect(
      service.reconnect('clerk-user-1', 'extension-1', credential, {
        connectionId: String(target._id),
        approvalToken,
      }),
    ).rejects.toThrow('has expired');
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();

    // Valid approval → restore, unarchive, and burn the token in one write.
    target.reconnectApprovalExpiresAt = new Date(Date.now() + 60_000);
    await service.reconnect('clerk-user-1', 'extension-1', credential, {
      connectionId: String(target._id),
      approvalToken,
    });

    expect(connectionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = connectionModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown>; $unset: Record<string, number> },
    ];
    expect(update.$unset).toEqual({
      archivedAt: 1,
      archivedByClerkUserId: 1,
      archiveReason: 1,
    });
    expect(update.$set.reconnectApprovalUsedAt).toBeInstanceOf(Date);
    expect(previousInstallation.status).toBe(ExtensionLifecycleStatus.REVOKED);
    expect(installation.facebookConnectionId).toBe(target._id);
  });

  it('finds the connection to restore from the approval code alone', async () => {
    const installation = identityVerifiedInstallation();
    const target = connectionDoc({
      extensionInstanceId: 'extension-old',
      facebookUserId: 'fb-user-1',
      archivedAt: new Date(Date.now() - 60_000),
      reconnectApprovalTokenHash: hashInstallationCredential(approvalToken),
      reconnectApprovalExpiresAt: new Date(Date.now() + 60_000),
    }) as ConnectionSnapshot;
    const { service, connectionModel } = createHarness({
      installation,
      connection: target,
    });

    const result = await service.reconnect(
      'clerk-user-1',
      'extension-1',
      credential,
      { approvalToken },
    );

    expect(result).toMatchObject({ connectionId: String(target._id) });
    const [filter] = connectionModel.findOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) =>
        typeof call[0]?.reconnectApprovalTokenHash === 'string',
    ) as [Record<string, unknown>];
    expect(filter.clerkUserId).toBe('clerk-user-1');
    expect(installation.facebookConnectionId).toBe(target._id);
  });

  it('creates a fresh connection for the explicit create-new choice', async () => {
    const installation = identityVerifiedInstallation();
    const createdConnection = connectionDoc({
      extensionInstanceId: 'extension-1',
      facebookUserId: undefined,
    }) as ConnectionSnapshot;
    const { service, connectionModel } = createHarness({
      installation,
      connection: null,
    });
    connectionModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(createdConnection),
    });

    const result = await service.reconnect(
      'clerk-user-1',
      'extension-1',
      credential,
      { createNewConnection: true },
    );

    expect(result).toMatchObject({
      connectionId: String(createdConnection._id),
    });
    expect(connectionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter] = connectionModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({
      clerkUserId: 'clerk-user-1',
      extensionInstanceId: 'extension-1',
    });
    expect(installation.facebookConnectionId).toBe(createdConnection._id);
    expect(createdConnection.activeExtensionInstallationId).toBe(
      installation._id,
    );
  });

  it('reports the existing connection for a repeated create-new choice', async () => {
    const installation = identityVerifiedInstallation();
    const existingConnection = connectionDoc({
      extensionInstanceId: 'extension-1',
    }) as ConnectionSnapshot;
    const { service, connectionModel } = createHarness({
      installation,
      connection: existingConnection,
    });

    const result = await service.reconnect(
      'clerk-user-1',
      'extension-1',
      credential,
      { createNewConnection: true },
    );

    expect(result).toMatchObject({
      connectionId: String(existingConnection._id),
    });
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('ExtensionsService.heartbeat', () => {
  it('returns the desired lifecycle state and never reactivates', async () => {
    const paused = installationDoc({
      status: ExtensionLifecycleStatus.PAUSED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({ installation: paused });

    const result = await service.heartbeat(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe(ExtensionLifecycleStatus.PAUSED);
    expect((paused as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.PAUSED,
    );
  });

  it('fails closed for an unregistered worker and creates nothing', async () => {
    const { service, connectionModel, extensionModel } = createHarness({
      installation: null,
    });

    await expect(
      service.heartbeat('clerk-user-1', 'extension-1', undefined, credential),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(connectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(extensionModel.create).not.toHaveBeenCalled();
  });

  it('finalizes a REVOKE_PENDING installation once its leases are gone', async () => {
    const pending = installationDoc({
      status: ExtensionLifecycleStatus.REVOKE_PENDING,
      statusChangedByClerkUserId: 'clerk-user-1',
      statusReason: ExtensionRevocationReason.USER_DISCONNECTED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({
      installation: pending,
      hasActiveClaim: false,
    });

    const result = await service.heartbeat(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe(ExtensionLifecycleStatus.REVOKED);
    expect((pending as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.REVOKED,
    );
  });

  it('keeps REVOKE_PENDING while a leased job is still running', async () => {
    const pending = installationDoc({
      status: ExtensionLifecycleStatus.REVOKE_PENDING,
      statusReason: ExtensionRevocationReason.USER_DISCONNECTED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({
      installation: pending,
      hasActiveClaim: true,
    });

    const result = await service.heartbeat(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe(ExtensionLifecycleStatus.REVOKE_PENDING);
  });
});

describe('ExtensionsService dashboard lifecycle', () => {
  const bindConnection = (installation: Record<string, unknown>) => {
    const id = new Types.ObjectId();
    (installation as { facebookConnectionId?: unknown }).facebookConnectionId =
      id;
    return connectionDoc({
      _id: id,
      activeExtensionInstallationId: (installation as { _id: Types.ObjectId })
        ._id,
    });
  };

  it('throws for a connection owned by another user', async () => {
    const { service } = createHarness({ connection: null });
    await expect(
      service.pauseConnection('clerk-user-1', '64b000000000000000000001'),
    ).rejects.toThrow('Facebook connection not found');
  });

  it('pauses an ACTIVE installation and records an audit', async () => {
    const installation = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.ACTIVE,
    });
    const connection = bindConnection(installation);
    const { service, auditModel, extensionModel } = createHarness({
      installation,
      connection,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.pauseConnection(
      'clerk-user-1',
      String(connection._id),
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.PAUSED);
    expect((installation as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.PAUSED,
    );
    expect(auditModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ExtensionLifecycleAuditEventName.INSTALLATION_PAUSED,
        actor: 'DASHBOARD',
      }),
    );
  });

  it('resumes a PAUSED installation back to ACTIVE', async () => {
    const installation = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.PAUSED,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel } = createHarness({
      installation,
      connection,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.resumeConnection(
      'clerk-user-1',
      String(connection._id),
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.ACTIVE);
    expect((installation as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.ACTIVE,
    );
  });

  it('refuses to resume a REVOKED installation', async () => {
    const installation = installationDoc({
      status: ExtensionLifecycleStatus.REVOKED,
      credentialHash,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel } = createHarness({
      installation,
      connection,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    await expect(
      service.resumeConnection('clerk-user-1', String(connection._id)),
    ).rejects.toThrow('cannot be resumed');
  });

  it('graceful disconnect finalizes immediately when nothing is in flight', async () => {
    const installation = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.ACTIVE,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel } = createHarness({
      installation,
      connection,
      hasActiveClaim: false,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.disconnectConnection(
      'clerk-user-1',
      String(connection._id),
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.REVOKED);
    expect((installation as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.REVOKED,
    );
  });

  it('graceful disconnect waits for a running leased job', async () => {
    const installation = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.ACTIVE,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel } = createHarness({
      installation,
      connection,
      hasActiveClaim: true,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.disconnectConnection(
      'clerk-user-1',
      String(connection._id),
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.REVOKE_PENDING);
  });

  it('force disconnect revokes immediately', async () => {
    const installation = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.ACTIVE,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel } = createHarness({
      installation,
      connection,
      hasActiveClaim: true,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.disconnectConnection(
      'clerk-user-1',
      String(connection._id),
      true,
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.REVOKED);
  });

  it('remove archives the connection and revokes the installation without deleting', async () => {
    const installation = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.ACTIVE,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel, connectionModel } = createHarness({
      installation,
      connection,
    });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.removeConnection(
      'clerk-user-1',
      String(connection._id),
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.REVOKED);
    expect(state.archivedAt).toBeInstanceOf(Date);
    expect((installation as { status: ExtensionLifecycleStatus }).status).toBe(
      ExtensionLifecycleStatus.REVOKED,
    );
    expect(connectionModel.deleteOne).not.toHaveBeenCalled();
    expect(connectionModel.deleteMany).not.toHaveBeenCalled();
    expect(extensionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('does not claim work through an archived connection', async () => {
    const installation = installationDoc({ credentialHash });
    const connection = connectionDoc({ archivedAt: new Date() });
    const { service } = createHarness({ installation, connection });

    await expect(
      service.resolveActiveWorkerConnection('clerk-user-1', installation),
    ).resolves.toBeNull();
  });

  it('requires ACTIVE installations to claim new work', () => {
    const paused = installationDoc({
      credentialHash,
      status: ExtensionLifecycleStatus.PAUSED,
    });
    const { service } = createHarness({ installation: paused });
    expect(() => service.assertInstallationActive(paused)).toThrow(
      'cannot claim new work',
    );
  });
});

describe('ExtensionsService.reconnectApproval', () => {
  it('issues a one-time approval token and stores only the hash', async () => {
    const connection = connectionDoc();
    const { service } = createHarness({ connection });

    const approval = await service.issueReconnectApproval(
      'clerk-user-1',
      String(connection._id),
    );

    expect(approval.approvalToken).toMatch(/^pfc_/);
    expect(approval.expiresAt).toBeInstanceOf(Date);
    expect(approval.ttlSeconds).toBe(RECONNECT_APPROVAL_TTL_MS / 1000);
    const doc = connection as unknown as Record<string, unknown>;
    expect(doc.reconnectApprovalTokenHash).not.toBe(approval.approvalToken);
    expect(hashInstallationCredential(approval.approvalToken)).toBe(
      doc.reconnectApprovalTokenHash,
    );
  });

  it('consumes an approval exactly once', async () => {
    const approvalToken = 'approval-token';
    const connection = connectionDoc({
      reconnectApprovalTokenHash: hashInstallationCredential(approvalToken),
      reconnectApprovalExpiresAt: new Date(Date.now() + 60_000),
    });
    const { service } = createHarness({ connection });

    await service.consumeReconnectApproval(
      'clerk-user-1',
      String(connection._id),
      approvalToken,
    );
    await expect(
      service.consumeReconnectApproval(
        'clerk-user-1',
        String(connection._id),
        approvalToken,
      ),
    ).rejects.toThrow('already been used');
  });

  it('rejects an expired or invalid approval', async () => {
    const expired = connectionDoc({
      reconnectApprovalTokenHash: hashInstallationCredential('token'),
      reconnectApprovalExpiresAt: new Date(Date.now() - 1_000),
    });
    const { service } = createHarness({ connection: expired });
    await expect(
      service.consumeReconnectApproval(
        'clerk-user-1',
        String(expired._id),
        'token',
      ),
    ).rejects.toThrow('expired');

    const invalid = connectionDoc({
      reconnectApprovalTokenHash: hashInstallationCredential('real-token'),
      reconnectApprovalExpiresAt: new Date(Date.now() + 60_000),
    });
    const mismatch = createHarness({ connection: invalid });
    await expect(
      mismatch.service.consumeReconnectApproval(
        'clerk-user-1',
        String(invalid._id),
        'wrong',
      ),
    ).rejects.toThrow('invalid');
  });
});

describe('ExtensionsService listing', () => {
  it('lists only non-archived connections with derived connectivity', async () => {
    const liveId = new Types.ObjectId();
    const live = connectionDoc({
      _id: liveId,
      clerkUserId: 'clerk-user-1',
      extensionInstanceId: 'extension-1',
    });
    const installation = installationDoc({
      extensionInstanceId: 'extension-1',
      facebookConnectionId: liveId,
      lastHeartbeat: new Date(),
      status: ExtensionLifecycleStatus.ACTIVE,
    });
    const liveSnapshot = live as unknown as {
      _id: Types.ObjectId;
      status: FacebookConnectionStatus;
      workerStatus: FacebookConnectionWorkerStatus;
    };
    const installationSnapshot = installation as unknown as {
      _id: Types.ObjectId;
    };

    const extensionModel = {
      findOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findById: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          {
            _id: installationSnapshot._id,
            extensionInstanceId: 'extension-1',
            status: ExtensionLifecycleStatus.ACTIVE,
            facebookConnectionId: liveSnapshot._id,
            lastHeartbeat: new Date(),
          },
        ]),
      }),
      create: jest.fn(),
      updateOne: jest.fn(),
    };
    const connectionModel = {
      findById: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          {
            _id: liveSnapshot._id,
            clerkUserId: 'clerk-user-1',
            extensionInstanceId: 'extension-1',
            status: liveSnapshot.status,
            workerStatus: liveSnapshot.workerStatus,
            facebookSessionDetected: false,
            lastSeenAt: new Date(),
            activeExtensionInstallationId: undefined,
          },
        ]),
      }),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      updateOne: jest.fn(),
    };
    const jobModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
    };
    const auditModel = { create: jest.fn() };
    const service = new ExtensionsService(
      extensionModel as never,
      connectionModel as never,
      jobModel as never,
      auditModel as never,
    );

    const [row] = await service.listConnections('clerk-user-1');

    expect(row._id).toBe(String(live._id));
    expect(row.extensionInstanceIdMasked).not.toBe('extension-1');
    expect(row.lifecycle).toBe(ExtensionLifecycleStatus.ACTIVE);
    expect(row.isOnline).toBe(true);
  });

  it('classifies a stale or missing heartbeat as OFFLINE', () => {
    expect(
      deriveConnectivity(new Date(Date.now() - 5 * 60 * 1000)).connectivity,
    ).toBe('OFFLINE');
    expect(deriveConnectivity(undefined).isOnline).toBe(false);
  });
});

describe('ExtensionsService name normalization', () => {
  it('normalizes extension names for display and uniqueness checks', () => {
    expect(normalizeExtensionName('  Office   PC  ')).toBe('Office PC');
    expect(normalizeExtensionNameKey('  OFFICE   pc  ')).toBe('office pc');
  });
});

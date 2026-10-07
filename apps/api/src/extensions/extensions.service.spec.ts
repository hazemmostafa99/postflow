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
import {
  ExtensionLifecycleAuditEventName,
} from '../schemas/extension-lifecycle-audit.schema';
import {
  ExtensionLifecycleStatus,
  ExtensionRevocationReason,
} from '../schemas/extension-installation.schema';
import {
  FacebookConnectionStatus,
  FacebookConnectionWorkerStatus,
} from '../schemas/facebook-connection.schema';
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
    options.installation === undefined ? installationDoc() : options.installation;
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
  const connectionModel = {
    findById: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(connection) }),
    findOne: jest.fn(
      (query: { _id?: unknown; clerkUserId?: string; extensionInstanceId?: string }) => {
        if (
          query._id &&
          (!connection ||
            String(query._id) !== String(connection._id))
        ) {
          return { exec: jest.fn().mockResolvedValue(null) };
        }
        return { exec: jest.fn().mockResolvedValue(connection) };
      },
    ),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    findOneAndUpdate: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(connection) }),
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
  };
}

const credential = 'cred-secret';
const credentialHash = hashInstallationCredential(credential);

describe('ExtensionsService.verifyWorkerIdentity', () => {
  it('rejects requests without a clerk user id', async () => {
    const { service } = createHarness({ installation: null });
    await expect(
      service.verifyWorkerIdentity(undefined as unknown as string, 'extension-1'),
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
  it('registers a brand-new installation, issues a credential, and records an audit', async () => {
    const created = installationDoc({ _id: new Types.ObjectId() });
    const connectionRef = connectionDoc();
    const { service, extensionModel, connectionModel, auditModel } =
      createHarness({ installation: null, connection: connectionRef });
    extensionModel.create.mockResolvedValue(created);

    const result = await service.register('clerk-user-1', 'extension-1');

    expect(result.status).toBe('NEW_INSTALLATION');
    expect(result.credentialIssued).toMatch(/^pfc_/);
    expect(result.connectionId).toBe(String(connectionRef._id));
    expect(extensionModel.create).toHaveBeenCalledTimes(1);
    const createdArgs = extensionModel.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(createdArgs.status).toBe(ExtensionLifecycleStatus.ACTIVE);
    expect(createdArgs.credentialVersion).toBe(1);
    expect(createdArgs.credentialIssuedAt).toBeInstanceOf(Date);
    expect(
      hashInstallationCredential(result.credentialIssued as string),
    ).toBe(createdArgs.credentialHash);
    expect(connectionModel.updateOne).toHaveBeenCalledWith(
      { _id: connectionRef._id },
      { $set: { activeExtensionInstallationId: created._id } },
    );
    expect(auditModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ExtensionLifecycleAuditEventName.INSTALLATION_REGISTERED,
        actor: 'WORKER',
      }),
    );
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
    expect(
      (pausedBefore as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.PAUSED);
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
    const { service } = createHarness({ installation: pending, hasActiveClaim: true });

    const result = await service.register(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe('REVOKE_PENDING');
    expect(
      (pending as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.REVOKE_PENDING);
  });

  it('finalizes a claim-free REVOKE_PENDING installation and reports REVOKED', async () => {
    const pending = installationDoc({
      status: ExtensionLifecycleStatus.REVOKE_PENDING,
      statusChangedByClerkUserId: 'clerk-user-1',
      statusReason: ExtensionRevocationReason.USER_DISCONNECTED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({ installation: pending, hasActiveClaim: false });

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
    expect(
      (paused as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.PAUSED);
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
    const { service } = createHarness({ installation: pending, hasActiveClaim: false });

    const result = await service.heartbeat(
      'clerk-user-1',
      'extension-1',
      undefined,
      credential,
    );

    expect(result.status).toBe(ExtensionLifecycleStatus.REVOKED);
    expect(
      (pending as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.REVOKED);
  });

  it('keeps REVOKE_PENDING while a leased job is still running', async () => {
    const pending = installationDoc({
      status: ExtensionLifecycleStatus.REVOKE_PENDING,
      statusReason: ExtensionRevocationReason.USER_DISCONNECTED,
      credentialHash,
      facebookConnectionId: new Types.ObjectId(),
    });
    const { service } = createHarness({ installation: pending, hasActiveClaim: true });

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
    (installation as { facebookConnectionId?: unknown }).facebookConnectionId = id;
    return connectionDoc({
      _id: id,
      activeExtensionInstallationId:
        (installation as { _id: Types.ObjectId })._id,
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
    expect(
      (installation as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.PAUSED);
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
    const { service, extensionModel } = createHarness({ installation, connection });
    extensionModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(installation),
    });

    const state = await service.resumeConnection(
      'clerk-user-1',
      String(connection._id),
    );

    expect(state.lifecycle).toBe(ExtensionLifecycleStatus.ACTIVE);
    expect(
      (installation as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.ACTIVE);
  });

  it('refuses to resume a REVOKED installation', async () => {
    const installation = installationDoc({
      status: ExtensionLifecycleStatus.REVOKED,
      credentialHash,
    });
    const connection = bindConnection(installation);
    const { service, extensionModel } = createHarness({ installation, connection });
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
    expect(
      (installation as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.REVOKED);
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
    expect(
      (installation as { status: ExtensionLifecycleStatus }).status,
    ).toBe(ExtensionLifecycleStatus.REVOKED);
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

  it('requires ACTIVE installations to claim new work', async () => {
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
    expect(
      hashInstallationCredential(approval.approvalToken as string),
    ).toBe(doc.reconnectApprovalTokenHash);
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
    const live = connectionDoc({
      _id: new Types.ObjectId(),
      clerkUserId: 'clerk-user-1',
      extensionInstanceId: 'extension-1',
    });
    const installation = installationDoc({
      extensionInstanceId: 'extension-1',
      facebookConnectionId: live._id,
      lastHeartbeat: new Date(),
      status: ExtensionLifecycleStatus.ACTIVE,
    });

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
            _id: (installation as { _id: Types.ObjectId })._id,
            extensionInstanceId: 'extension-1',
            status: ExtensionLifecycleStatus.ACTIVE,
            facebookConnectionId: live._id,
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
            _id: live._id,
            clerkUserId: 'clerk-user-1',
            extensionInstanceId: 'extension-1',
            status: (live as unknown as Record<string, unknown>).status,
            workerStatus: (live as unknown as Record<string, unknown>).workerStatus,
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
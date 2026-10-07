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

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FacebookConnectionStatus } from '../schemas/facebook-connection.schema';
import { GroupsService } from './groups.service';

describe('GroupsService.syncGroups', () => {
  const clerkUserId = 'clerk-user-1';
  const extensionInstanceId = 'extension-1';
  const connectionId = '64b000000000000000000001';

  function createHarness(options?: {
    connection?: Record<string, unknown> | null;
    bulkWriteError?: unknown;
    installationStatus?: string;
    verifyIdentityThrows?: unknown;
  }) {
    const bulkWrite = jest.fn().mockImplementation(() => {
      if (options?.bulkWriteError) return Promise.reject(options.bulkWriteError);
      return Promise.resolve({ upsertedCount: 0, modifiedCount: 1 });
    });
    const groupModel = {
      bulkWrite,
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const jobModel = {};
    const connection = options?.connection === undefined
      ? verifiedConnection()
      : options.connection;
    const connectionModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(connection),
      }),
    };
    const extensionsService = {
      verifyWorkerIdentity: jest.fn(
        async (_clerk: string, instanceId?: string) => {
          if (options?.verifyIdentityThrows) throw options.verifyIdentityThrows;
          return {
            _id: { toString: () => 'installation-1' },
            clerkUserId,
            extensionInstanceId: instanceId?.trim(),
            status: options?.installationStatus ?? 'ACTIVE',
          };
        },
      ),
      assertInstallationActive: jest.fn(
        (installation: { status?: string }) => {
          if (installation.status === 'ACTIVE') return;
          throw new ForbiddenException(
            'Extension is not active and cannot claim new work.',
          );
        },
      ),
      resolveActiveWorkerConnection: jest.fn(
        async (
          _clerk: string,
          installation: { extensionInstanceId?: string },
        ) => {
          const query = connectionModel.findOne({
            clerkUserId,
            extensionInstanceId: installation.extensionInstanceId,
          });
          if (!query || typeof query.exec !== 'function') return null;
          const found = await query.exec();
          return (found as Record<string, unknown> | null) ?? null;
        },
      ),
    };
    const service = new GroupsService(
      groupModel as never,
      jobModel as never,
      connectionModel as never,
      extensionsService as never,
    );

    return { service, groupModel, connectionModel, extensionsService };
  }

  function verifiedConnection() {
    return {
      _id: connectionId,
      clerkUserId,
      extensionInstanceId,
      status: FacebookConnectionStatus.CONNECTED,
      facebookSessionDetected: true,
      facebookUserId: 'facebook-user-1',
      detectedFacebookUserId: 'facebook-user-1',
    };
  }

  it('claims legacy unowned group rows for the verified connection', async () => {
    const { service, groupModel } = createHarness();

    await service.syncGroups(
      clerkUserId,
      [
        {
          externalId: 'group-one',
          name: 'Group One',
          url: 'https://www.facebook.com/groups/group-one/',
        },
      ],
      extensionInstanceId,
    );

    expect(groupModel.bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: {
            clerkUserId,
            externalId: 'group-one',
            $or: [
              { facebookConnectionId: connectionId },
              { facebookConnectionId: { $exists: false } },
              { facebookConnectionId: null },
            ],
          },
          update: {
            $set: expect.objectContaining({
              facebookConnectionId: connectionId,
              name: 'Group One',
              status: 'ACTIVE',
              url: 'https://www.facebook.com/groups/group-one/',
            }),
            $setOnInsert: {
              clerkUserId,
              externalId: 'group-one',
            },
          },
          upsert: true,
        },
      },
    ]);
  });

  it('rejects sync when the extension identity is not verified', async () => {
    const { service } = createHarness({ connection: null });

    await expect(
      service.syncGroups(clerkUserId, [], extensionInstanceId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks sync for a paused extension installation', async () => {
    const { service, groupModel } = createHarness({
      installationStatus: 'PAUSED',
    });

    await expect(
      service.syncGroups(
        clerkUserId,
        [
          {
            externalId: 'group-one',
            name: 'Group One',
            url: 'https://www.facebook.com/groups/group-one/',
          },
        ],
        extensionInstanceId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(groupModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('blocks sync for a revoked extension installation', async () => {
    const { service, groupModel } = createHarness({
      verifyIdentityThrows: new ForbiddenException(
        'Extension installation has been revoked.',
      ),
    });

    await expect(
      service.syncGroups(clerkUserId, [], extensionInstanceId),
    ).rejects.toThrow('Extension installation has been revoked.');
    expect(groupModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('turns stale duplicate group indexes into an actionable conflict', async () => {
    const { service } = createHarness({
      bulkWriteError: { code: 11000 },
    });

    await expect(
      service.syncGroups(
        clerkUserId,
        [
          {
            externalId: 'group-one',
            name: 'Group One',
            url: 'https://www.facebook.com/groups/group-one/',
          },
        ],
        extensionInstanceId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('GroupsService.listGroups', () => {
  it('filters groups by every selected Facebook connection', async () => {
    const connectionIds = [
      '64b000000000000000000001',
      '64b000000000000000000002',
    ];
    const exec = jest.fn().mockResolvedValue([]);
    const lean = jest.fn().mockReturnValue({ exec });
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const groupModel = {
      find,
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const service = new GroupsService(
      groupModel as never,
      {} as never,
      {} as never,
      {
        verifyWorkerIdentity: jest.fn(),
        assertInstallationActive: jest.fn(),
        resolveActiveWorkerConnection: jest.fn(),
      } as never,
    );

    await service.listGroups('clerk-user-1', { connectionIds });

    const filter = find.mock.calls[0][0] as {
      clerkUserId: string;
      facebookConnectionId: { $in: Types.ObjectId[] };
    };
    expect(filter.clerkUserId).toBe('clerk-user-1');
    expect(filter.facebookConnectionId.$in.map(String)).toEqual(connectionIds);
  });
});

describe('GroupsService.deleteGroup', () => {
  it('deletes only the signed-in user\'s group and its publishing jobs', async () => {
    const clerkUserId = 'clerk-user-1';
    const groupId = new Types.ObjectId('64b000000000000000000001');
    const findOneAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: groupId }),
    });
    const jobExec = jest.fn().mockResolvedValue({ deletedCount: 2 });
    const jobIn = jest.fn().mockReturnValue({ exec: jobExec });
    const jobWhere = jest.fn().mockReturnValue({ in: jobIn });
    const deleteMany = jest.fn().mockReturnValue({ where: jobWhere });
    const service = new GroupsService(
      { findOneAndDelete } as never,
      { deleteMany } as never,
      {} as never,
      {
        verifyWorkerIdentity: jest.fn(),
        assertInstallationActive: jest.fn(),
        resolveActiveWorkerConnection: jest.fn(),
      } as never,
    );

    await service.deleteGroup(clerkUserId, groupId.toString());

    expect(findOneAndDelete).toHaveBeenCalledWith({
      _id: groupId.toString(),
      clerkUserId,
    });
    expect(jobWhere).toHaveBeenCalledWith('groupId');
    expect(jobIn).toHaveBeenCalledWith([groupId]);
  });
});

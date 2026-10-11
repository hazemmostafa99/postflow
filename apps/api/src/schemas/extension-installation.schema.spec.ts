import {
  ExtensionInstallationSchema,
  ExtensionLifecycleStatus,
  ExtensionRevocationReason,
} from './extension-installation.schema';

describe('ExtensionInstallation lifecycle schema', () => {
  it('declares the lifecycle and revocation states', () => {
    expect(Object.values(ExtensionLifecycleStatus)).toEqual([
      'ACTIVE',
      'PAUSED',
      'REVOKE_PENDING',
      'REVOKED',
    ]);
    expect(Object.values(ExtensionRevocationReason)).toEqual([
      'USER_DISCONNECTED',
      'REMOVED',
      'REPLACED',
      'SECURITY',
      'MIGRATION',
    ]);
  });

  it('has unique instance and active connection binding indexes', () => {
    const indexes = ExtensionInstallationSchema.indexes();
    const instanceIndex = indexes.find(([keys]) => keys.extensionInstanceId === 1);
    const bindingIndex = indexes.find(
      ([_keys, options]) => options?.name === 'active_facebook_connection_binding',
    );

    expect(instanceIndex?.[1]).toMatchObject({ unique: true, sparse: true });
    expect(bindingIndex).toBeDefined();
    expect(bindingIndex?.[1]).toMatchObject({ unique: true });
    expect(bindingIndex?.[1].partialFilterExpression).toEqual({
      facebookConnectionId: { $type: 'objectId' },
      status: { $in: ['ACTIVE', 'PAUSED', 'REVOKE_PENDING'] },
    });
  });
});

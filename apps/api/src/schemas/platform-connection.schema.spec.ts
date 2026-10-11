import { PublishingPlatform } from './publishing-platform';
import {
  PlatformConnectionSchema,
  PlatformConnectionStatus,
  PlatformConnectionWorkerStatus,
} from './platform-connection.schema';

describe('PlatformConnection schema', () => {
  it('declares platform-neutral lifecycle states', () => {
    expect(Object.values(PublishingPlatform)).toEqual([
      'FACEBOOK',
      'INSTAGRAM',
      'TIKTOK',
    ]);
    expect(Object.values(PlatformConnectionStatus)).toEqual([
      'PENDING',
      'CONNECTED',
      'LOGIN_REQUIRED',
      'ACCOUNT_MISMATCH',
      'BLOCKED',
      'DISCONNECTED',
    ]);
    expect(Object.values(PlatformConnectionWorkerStatus)).toContain(
      'MANUAL_INTERVENTION_REQUIRED',
    );
  });

  it('enforces one active connection per installation and platform', () => {
    const index = PlatformConnectionSchema.indexes().find(
      ([, options]) => options?.name === 'active_installation_platform_binding',
    );

    expect(index?.[0]).toEqual({
      activeExtensionInstallationId: 1,
      platform: 1,
    });
    expect(index?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: {
        activeExtensionInstallationId: { $type: 'objectId' },
        archivedAt: { $exists: false },
      },
    });
  });

  it('keeps the legacy Facebook compatibility mapping unique', () => {
    const index = PlatformConnectionSchema.indexes().find(
      ([, options]) => options?.name === 'legacy_facebook_connection_binding',
    );

    expect(index?.[0]).toEqual({ legacyFacebookConnectionId: 1 });
    expect(index?.[1]).toMatchObject({ unique: true });
  });
});

import { groupBrowserConnections } from './browser-connections';

describe('extension-as-connection grouping', () => {
  it('returns installation archive metadata without exposing credentials', () => {
    const archivedAt = new Date();
    const [connection] = groupBrowserConnections([{ _id: 'old', status: 'REVOKED', archivedAt,
      archivedByClerkUserId: 'owner', archiveReason: 'REMOVED' }], [], [], true);
    expect(connection.archivedAt).toBe(archivedAt);
    expect(connection.archiveReason).toBe('REMOVED');
    expect(connection).not.toHaveProperty('credentialHash');
  });
  it('uses the installation itself as the connection ID and masks instance metadata', () => {
    const [connection] = groupBrowserConnections([{ _id: 'one', extensionInstanceId: 'pfi_1234567890abcdef' }], [], []);
    expect(connection._id).toBe('one');
    expect(connection.installationId).toBe(connection._id);
    expect(connection.displayName).toBe(connection.extensionInstanceIdMasked);
    expect(connection.extensionInstanceIdMasked).not.toBe('pfi_1234567890abcdef');
    expect(connection).not.toHaveProperty('extensionInstanceId');
  });

  it('can include disconnected installations for existing recovery without rebinding accounts', () => {
    const [connection] = groupBrowserConnections([{ _id: 'old', status: 'REVOKED', facebookConnectionId: 'fb' }],
      [{ _id: 'fb', activeExtensionInstallationId: 'new' }], [], true);
    expect(connection.status).toBe('REVOKED');
    expect(connection.accounts[0].connectionId).toBeNull();
  });
  it('always provides three platform slots for an unbound installation', () => {
    const [profile] = groupBrowserConnections([{ _id: 'one', status: 'ACTIVE' }], [], []);
    expect(profile.accounts.map((account) => account.platform)).toEqual(['FACEBOOK', 'INSTAGRAM', 'TIKTOK']);
    expect(profile.accounts.every((account) => account.status === 'NOT_DETECTED')).toBe(true);
  });

  it('never groups accounts by a matching name or username', () => {
    const profiles = groupBrowserConnections([{ _id: 'one' }, { _id: 'two' }], [], [
      { _id: 'ig', platform: 'INSTAGRAM', activeExtensionInstallationId: 'two', externalUsername: 'shared' },
    ]);
    expect(profiles[0].accounts[1].connectionId).toBeNull();
    expect(profiles[1].accounts[1].connectionId).toBe('ig');
  });

  it('prefers the neutral profile name and keeps platform health independent', () => {
    const [profile] = groupBrowserConnections([{ _id: 'one', displayName: 'Work' }], [
      { _id: 'fb', activeExtensionInstallationId: 'one', displayName: 'Old', status: 'CONNECTED', facebookSessionDetected: true },
    ], [{ _id: 'ig', platform: 'INSTAGRAM', activeExtensionInstallationId: 'one', status: 'LOGIN_REQUIRED' }]);
    expect(profile.displayName).toBe('Work');
    expect(profile.accounts[0].status).toBe('CONNECTED');
    expect(profile.accounts[1].status).toBe('LOGIN_REQUIRED');
  });

  it('supports legacy names and omits revoked installations', () => {
    const profiles = groupBrowserConnections([{ _id: 'one' }, { _id: 'old', status: 'REVOKED' }], [
      { _id: 'fb', activeExtensionInstallationId: 'one', displayName: 'Legacy' },
    ], []);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].displayName).toBe('Legacy');
  });

  it('does not attach a Facebook record rebound to a different installation', () => {
    const [profile] = groupBrowserConnections([{ _id: 'one', facebookConnectionId: 'fb' }], [
      { _id: 'fb', activeExtensionInstallationId: 'two' },
    ], []);
    expect(profile.accounts[0].connectionId).toBeNull();
  });
});

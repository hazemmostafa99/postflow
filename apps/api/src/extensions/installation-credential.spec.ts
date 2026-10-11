import {
  generateInstallationCredential,
  hashInstallationCredential,
  maskExtensionInstanceId,
  verifyInstallationCredential,
} from './installation-credential';

describe('installation credentials', () => {
  it('generates a random prefixed credential that is not persisted verbatim', () => {
    const first = generateInstallationCredential();
    const second = generateInstallationCredential();
    expect(first).toMatch(/^pfc_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    expect(hashInstallationCredential(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInstallationCredential(first)).not.toContain(first);
  });

  it('verifies the correct credential and rejects everything else', () => {
    const credential = generateInstallationCredential();
    const hash = hashInstallationCredential(credential);
    expect(verifyInstallationCredential(credential, hash)).toBe(true);
    expect(verifyInstallationCredential('wrong', hash)).toBe(false);
    expect(verifyInstallationCredential(undefined, hash)).toBe(false);
    expect(verifyInstallationCredential(credential, undefined)).toBe(false);
    expect(verifyInstallationCredential(credential, 'not-hex')).toBe(false);
    expect(verifyInstallationCredential(credential, '')).toBe(false);
  });

  it('masks instance IDs for logs and API responses', () => {
    expect(maskExtensionInstanceId('pfi_1234567890abcdef')).toBe(
      'pfi_…cdef',
    );
    expect(maskExtensionInstanceId('short')).toBe('sh…rt');
    expect(maskExtensionInstanceId('  ')).toBe('missing');
    expect(maskExtensionInstanceId(undefined)).toBe('missing');
  });
});
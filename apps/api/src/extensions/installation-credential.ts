import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const INSTALLATION_CREDENTIAL_PREFIX = 'pfc_';
/** Hexadecimal SHA-256 digest length. */
const CREDENTIAL_HASH_HEX_LENGTH = 64;

/**
 * Generates a fresh random installation credential. The plaintext value is
 * handed to the extension exactly once, at issuance time, and is never
 * persisted or logged by the backend.
 */
export function generateInstallationCredential(): string {
  return `${INSTALLATION_CREDENTIAL_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * Hashes an installation credential for storage. The backend may persist the
 * hash and a version counter, but never the plaintext.
 */
export function hashInstallationCredential(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Timing-safe verification of a presented credential against the stored hex
 * hash. Any malformed or length-mismatched hash fails closed.
 */
export function verifyInstallationCredential(
  presented: string | undefined,
  storedHash: string | undefined,
): boolean {
  if (!presented || !storedHash) return false;
  const candidate = Buffer.from(hashInstallationCredential(presented), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (
    expected.length !== CREDENTIAL_HASH_HEX_LENGTH / 2 ||
    candidate.length !== CREDENTIAL_HASH_HEX_LENGTH / 2 ||
    expected.length !== candidate.length
  ) {
    return false;
  }
  return timingSafeEqual(expected, candidate);
}

/** Mask an extension instance ID for logs, audit records, and API responses. */
export function maskExtensionInstanceId(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) return 'missing';
  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}…${normalized.slice(-2)}`;
  }
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}
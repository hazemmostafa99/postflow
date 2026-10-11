import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const DATA_URL_PATTERN =
  /^data:((?:image|video)\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/]*={0,2})$/;

export const MAX_JOB_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_JOB_IMAGE_BYTES = 2 * 1024 * 1024;

export type JobMediaMetadata = {
  contentType: string;
  sizeBytes: number;
  fileName: string;
};

export type JobMediaReference = {
  index: number;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  fetchPath: string;
  accessToken: string;
  expiresAt: string;
};

export type DecodedJobMedia = {
  contentType: string;
  bytes: Buffer;
  fileName: string;
};

export function createJobMediaAccessGrant(expiresAt: Date) {
  const accessToken = randomBytes(32).toString('base64url');
  return {
    accessToken,
    tokenHash: hashJobMediaAccessToken(accessToken),
    expiresAt,
  };
}

export function hashJobMediaAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

export function verifyJobMediaAccessToken(
  accessToken: string,
  expectedHash?: string,
): boolean {
  if (!accessToken || !expectedHash) return false;
  const actual = Buffer.from(hashJobMediaAccessToken(accessToken), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function decodeJobMediaDataUrl(value: string): DecodedJobMedia | null {
  const match = DATA_URL_PATTERN.exec(value);
  if (!match || match[2].length % 4 === 1) return null;
  const metadata = metadataFromMatch(match);
  if (!metadata || metadata.sizeBytes > MAX_JOB_MEDIA_BYTES) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length !== metadata.sizeBytes) return null;
  return {
    contentType: metadata.contentType,
    bytes,
    fileName: metadata.fileName,
  };
}

export function getJobMediaDataUrlMetadata(
  value: string,
): JobMediaMetadata | null {
  const match = DATA_URL_PATTERN.exec(value);
  return match && match[2].length % 4 !== 1 ? metadataFromMatch(match) : null;
}

export function buildJobMediaReferences(
  jobId: string,
  mediaUrls: readonly string[],
  accessToken: string,
  expiresAt: Date,
): JobMediaReference[] {
  return mediaUrls.flatMap((value, index) => {
    const metadata = getJobMediaDataUrlMetadata(value);
    if (!metadata || metadata.sizeBytes > MAX_JOB_MEDIA_BYTES) return [];
    return [
      {
        index,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
        fileName: metadata.fileName,
        fetchPath: `/api/jobs/${encodeURIComponent(jobId)}/media/${index}`,
        accessToken,
        expiresAt: expiresAt.toISOString(),
      },
    ];
  });
}

function metadataFromMatch(match: RegExpExecArray): JobMediaMetadata | null {
  const payload = match[2];
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const sizeBytes = Math.floor((payload.length * 3) / 4) - padding;
  if (sizeBytes <= 0) return null;
  return {
    contentType: match[1].toLowerCase(),
    sizeBytes,
    fileName: `postflow-media.${extensionForContentType(match[1])}`,
  };
}

function extensionForContentType(contentType: string): string {
  const subtype = contentType.split('/')[1]?.toLowerCase();
  if (subtype === 'quicktime') return 'mov';
  if (subtype === 'jpeg') return 'jpg';
  return subtype?.replace(/[^a-z0-9]/g, '') || 'bin';
}

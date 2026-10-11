export const MAX_DELIVERED_MEDIA_BYTES = 25 * 1024 * 1024;

export type JobMediaReference = {
  index: number;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  fetchPath: string;
  accessToken: string;
  expiresAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeJobMediaReference(
  value: unknown,
): JobMediaReference | null {
  if (!isRecord(value)) return null;
  if (!Number.isSafeInteger(value.index) || Number(value.index) < 0) return null;
  if (!Number.isSafeInteger(value.sizeBytes)) return null;
  const sizeBytes = Number(value.sizeBytes);
  const contentType = stringValue(value.contentType);
  const fileName = stringValue(value.fileName);
  const fetchPath = stringValue(value.fetchPath);
  const accessToken = stringValue(value.accessToken);
  const expiresAt = stringValue(value.expiresAt);
  if (
    sizeBytes <= 0 ||
    sizeBytes > MAX_DELIVERED_MEDIA_BYTES ||
    !contentType?.match(/^(image|video)\/[a-z0-9.+-]+$/i) ||
    !fileName ||
    !fetchPath?.match(/^\/api\/jobs\/[^/]+\/media\/\d+$/) ||
    !accessToken?.match(/^[A-Za-z0-9_-]{32,}$/) ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    return null;
  }
  return {
    index: Number(value.index),
    contentType: contentType.toLowerCase(),
    sizeBytes,
    fileName,
    fetchPath,
    accessToken,
    expiresAt,
  };
}

export function getJobMediaReferences(post: unknown): JobMediaReference[] {
  if (!isRecord(post) || !Array.isArray(post.media)) return [];
  return post.media.flatMap((value) => {
    const reference = normalizeJobMediaReference(value);
    return reference ? [reference] : [];
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

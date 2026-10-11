interface PostFlowJobMediaReference {
  contentType: string;
  sizeBytes: number;
  fileName: string;
  fetchPath: string;
  accessToken: string;
  expiresAt: string;
}

interface PostFlowJobMediaRuntime {
  fetchJobMediaFile(
    reference: PostFlowJobMediaReference,
    apiBaseUrl: string,
  ): Promise<File>;
}

const POSTFLOW_MAX_DELIVERED_MEDIA_BYTES = 25 * 1024 * 1024;
const POSTFLOW_MEDIA_FETCH_TIMEOUT_MS = 60_000;

function getPostFlowMediaUrl(apiBaseUrl: string, fetchPath: string): URL {
  const base = new URL(apiBaseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !fetchPath.match(/^\/api\/jobs\/[^/]+\/media\/\d+$/)
  ) {
    throw new Error('MEDIA_URL_INVALID');
  }
  const url = new URL(fetchPath, base.origin);
  if (url.origin !== base.origin) throw new Error('MEDIA_URL_INVALID');
  return url;
}

async function fetchPostFlowJobMediaFile(
  reference: PostFlowJobMediaReference,
  apiBaseUrl: string,
): Promise<File> {
  if (Date.parse(reference.expiresAt) <= Date.now()) {
    throw new Error('MEDIA_ACCESS_EXPIRED');
  }
  const url = getPostFlowMediaUrl(apiBaseUrl, reference.fetchPath);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${reference.accessToken}` },
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(POSTFLOW_MEDIA_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`MEDIA_FETCH_FAILED_${response.status}`);

  const contentLengthHeader = response.headers.get('content-length');
  const contentLength =
    typeof contentLengthHeader === 'string' && contentLengthHeader.trim()
      ? Number(contentLengthHeader)
      : null;
  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    (contentLength <= 0 ||
      contentLength > POSTFLOW_MAX_DELIVERED_MEDIA_BYTES)
  ) {
    throw new Error('MEDIA_SIZE_INVALID');
  }
  const responseType = response.headers.get('content-type')?.split(';')[0];
  if (responseType?.toLowerCase() !== reference.contentType) {
    throw new Error('MEDIA_TYPE_MISMATCH');
  }

  const blob = await readBoundedMediaBlob(response, responseType);
  if (
    blob.size !== reference.sizeBytes ||
    blob.size > POSTFLOW_MAX_DELIVERED_MEDIA_BYTES
  ) {
    throw new Error('MEDIA_SIZE_MISMATCH');
  }
  return new File([blob], reference.fileName, {
    type: reference.contentType,
    lastModified: Date.now(),
  });
}

async function readBoundedMediaBlob(
  response: Response,
  responseType?: string,
): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > POSTFLOW_MAX_DELIVERED_MEDIA_BYTES) {
      throw new Error('MEDIA_SIZE_INVALID');
    }
    return blob;
  }

  const chunks: BlobPart[] = [];
  let totalBytes = 0;
  let cancelled = false;
  const cancel = async () => {
    if (cancelled) return;
    cancelled = true;
    try {
      await reader.cancel();
    } catch {
      // The response is already unusable; preserve the original validation error.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !Number.isSafeInteger(value.byteLength)) {
        await cancel();
        throw new Error('MEDIA_SIZE_INVALID');
      }
      totalBytes += value.byteLength;
      if (totalBytes > POSTFLOW_MAX_DELIVERED_MEDIA_BYTES) {
        await cancel();
        throw new Error('MEDIA_SIZE_INVALID');
      }
      chunks.push(value as BlobPart);
    }
  } catch (error) {
    await cancel();
    throw error;
  }

  return new Blob(chunks, { type: responseType ?? '' });
}

(globalThis as typeof globalThis & {
  PostFlowJobMedia?: PostFlowJobMediaRuntime;
}).PostFlowJobMedia = {
  fetchJobMediaFile: fetchPostFlowJobMediaFile,
};

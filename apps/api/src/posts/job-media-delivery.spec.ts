import {
  MAX_JOB_MEDIA_BYTES,
  buildJobMediaReferences,
  createJobMediaAccessGrant,
  decodeJobMediaDataUrl,
  getJobMediaDataUrlMetadata,
  verifyJobMediaAccessToken,
} from './job-media-delivery';

describe('job media delivery', () => {
  it('issues a job-scoped token that can be verified without storing plaintext', () => {
    const expiresAt = new Date('2026-10-09T03:00:00.000Z');
    const grant = createJobMediaAccessGrant(expiresAt);

    expect(grant.accessToken).not.toBe(grant.tokenHash);
    expect(grant.tokenHash).toHaveLength(64);
    expect(verifyJobMediaAccessToken(grant.accessToken, grant.tokenHash)).toBe(
      true,
    );
    expect(verifyJobMediaAccessToken('wrong-token', grant.tokenHash)).toBe(
      false,
    );
  });

  it('builds metadata-only references without returning media bytes', () => {
    const expiresAt = new Date('2026-10-09T03:00:00.000Z');
    const references = buildJobMediaReferences(
      'job/one',
      ['data:video/mp4;base64,SGVsbG8='],
      'media-token',
      expiresAt,
    );

    expect(references).toEqual([
      {
        index: 0,
        contentType: 'video/mp4',
        sizeBytes: 5,
        fileName: 'postflow-media.mp4',
        fetchPath: '/api/jobs/job%2Fone/media/0',
        accessToken: 'media-token',
        expiresAt: expiresAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(references)).not.toContain('SGVsbG8');
  });

  it('decodes supported media and rejects invalid or oversized input', () => {
    expect(decodeJobMediaDataUrl('data:image/jpeg;base64,SGk=')).toMatchObject({
      contentType: 'image/jpeg',
      fileName: 'postflow-media.jpg',
    });
    expect(decodeJobMediaDataUrl('data:text/html;base64,SGk=')).toBeNull();
    expect(decodeJobMediaDataUrl('data:video/mp4;base64,%%%')).toBeNull();

    const oversized = Buffer.alloc(MAX_JOB_MEDIA_BYTES + 1).toString('base64');
    expect(
      decodeJobMediaDataUrl(`data:video/mp4;base64,${oversized}`),
    ).toBeNull();
  });

  it('measures decoded size without materializing the media buffer', () => {
    expect(
      getJobMediaDataUrlMetadata('data:video/mp4;base64,SGVsbG8='),
    ).toEqual({
      contentType: 'video/mp4',
      sizeBytes: 5,
      fileName: 'postflow-media.mp4',
    });
  });
});

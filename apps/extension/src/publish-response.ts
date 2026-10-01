interface FacebookPublishResponseMetadata {
  isStoryCreateResponse?: unknown;
  requestStartedAt?: unknown;
}

/**
 * Only creation responses started by the active final-submit window may
 * provide publication identities. This rejects delayed responses from an
 * earlier profile/group job and ordinary feed responses containing old posts.
 */
function isResponseForActivePublish(
  detail: FacebookPublishResponseMetadata,
  acceptCandidatesAfter: number,
): boolean {
  return detail.isStoryCreateResponse === true &&
    typeof detail.requestStartedAt === 'number' &&
    Number.isFinite(detail.requestStartedAt) &&
    detail.requestStartedAt >= acceptCandidatesAfter;
}

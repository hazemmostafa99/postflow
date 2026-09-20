interface FindPendingPublishedPostOptions {
  root?: ParentNode;
  submittedText?: string;
  submittedAt: number;
  currentGroupId?: string;
  expectedPostUrl?: string;
}

interface PendingPublishedPostMatch {
  element: HTMLElement;
  postUrl?: string;
}

function isExactPendingTextMatch(postElement: Element, submittedText: string): boolean {
  const submitted = normalizePostText(submittedText);
  const candidate = normalizePostText(postElement.textContent ?? "");
  return Boolean(submitted && candidate && candidate.includes(submitted));
}

function getFacebookPostIdentity(value?: string): string | null {
  if (!value) return null;
  try {
    const path = new URL(value, window.location.origin).pathname;
    return path.match(/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/([A-Za-z0-9_-]+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isFacebookPendingUrl(value?: string): boolean {
  if (!value) return false;
  try {
    return /^\/groups\/[^/]+\/pending_posts\/[A-Za-z0-9_-]+/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function getCurrentFacebookPostUrl(expectedPostUrl?: string): string | null {
  const expectedIdentity = getFacebookPostIdentity(expectedPostUrl);
  if (!expectedIdentity) return null;
  try {
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/\/+$/, '');
    const currentIdentity = getFacebookPostIdentity(url.href);
    if (!currentIdentity || currentIdentity !== expectedIdentity || isFacebookPendingUrl(url.href)) return null;
    if (!/^\/groups\/[^/]+\/(?:posts|permalink)\/[A-Za-z0-9_-]+/i.test(path)) return null;
    return normalizeFacebookGroupPostUrl(url.href);
  } catch {
    return null;
  }
}

/**
 * Find a previously submitted post after it has been approved. Unlike the
 * initial-submission matcher, this does not require the post to be new DOM
 * evidence because approval may happen much later.
 */
function findPendingPublishedPost({
  root = document,
  submittedText,
  submittedAt,
  currentGroupId,
  expectedPostUrl,
}: FindPendingPublishedPostOptions): PendingPublishedPostMatch | null {
  if (!submittedText?.trim()) return null;

  const candidates: Element[] = [];
  if (root instanceof Element && root.matches(POST_SELECTOR)) candidates.push(root);
  candidates.push(...Array.from(root.querySelectorAll(POST_SELECTOR)));

  const seen = new Set<Element>();
  const expectedPostIdentity = getFacebookPostIdentity(expectedPostUrl);
  const matches: Array<{ element: Element; postUrl?: string; timestamp: number | null }> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate) || !isVisiblePostElement(candidate)) continue;
    seen.add(candidate);
    if (!isExactPendingTextMatch(candidate, submittedText)) continue;

    const timestamp = extractPostTimestamp(candidate);
    // A known timestamp before submission is evidence of an older similar post.
    if (timestamp !== null && timestamp < submittedAt - 5 * 60_000) continue;
    const postUrl = extractPostPermalink(candidate, currentGroupId) ?? undefined;
    if (currentGroupId && !postUrl) continue;
    if (expectedPostIdentity && getFacebookPostIdentity(postUrl) !== expectedPostIdentity) continue;
    matches.push({ element: candidate, postUrl, timestamp });
  }

  // Feed order can change while Facebook re-renders. If the same text exists
  // more than once, use the newest timestamp instead of the first DOM node so
  // an older post cannot donate its permalink to this job.
  const match = matches.sort((left, right) => {
    if (left.timestamp === null && right.timestamp !== null) return 1;
    if (left.timestamp !== null && right.timestamp === null) return -1;
    return (right.timestamp ?? 0) - (left.timestamp ?? 0);
  })[0];
  return match
    ? { element: match.element as HTMLElement, ...(match.postUrl ? { postUrl: match.postUrl } : {}) }
    : null;
}

/** Check a pending record against the currently loaded Facebook group DOM. */
function checkPendingFacebookPost(
  post: PendingFacebookPost,
  root: ParentNode = document,
): PendingPostSyncResult {
  const approvedPageUrl = getCurrentFacebookPostUrl(post.postUrl);
  if (approvedPageUrl) {
    return { status: "PUBLISHED", postUrl: approvedPageUrl };
  }
  const match = findPendingPublishedPost({
    root,
    submittedText: post.content,
    submittedAt: Date.parse(post.submittedAt),
    currentGroupId: post.groupExternalId ?? post.groupId,
    expectedPostUrl: post.postUrl,
  });

  if (!match) return { status: "STILL_PENDING" };
  // A matching /pending_posts/ permalink confirms the post still exists in
  // Facebook's approval queue. It must not transition the job to PUBLISHED.
  if (isFacebookPendingUrl(match.postUrl)) return { status: "STILL_PENDING" };
  return {
    status: "PUBLISHED",
    ...(match.postUrl ? { postUrl: match.postUrl } : {}),
  };
}

interface WaitForPostSubmissionResultOptions {
  root?: ParentNode;
  submittedText: string;
  submittedAt: number;
  timeout: number;
  interval: number;
  existingPostElements?: ReadonlySet<Element>;
  existingPostUrls?: ReadonlySet<string>;
  submittedMediaCount?: number;
  currentGroupId?: string;
  initialPageUrl?: string;
  getFailureReason?: () => string | null;
  getInterruption?: () => FacebookPublishInterruption | null;
  getSuccessEvidence?: () => string | null;
  getPendingPostUrl?: () => string | null;
  getNetworkPostUrl?: () => string | null;
  onStateChange?: (status: FacebookPostStatus, details?: Record<string, unknown>) => void;
}

function waitForTrackingDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getCurrentPagePostUrl(currentGroupId?: string, initialPageUrl?: string): string | null {
  try {
    if (!initialPageUrl) return null;
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/\/$/, "");
    if (!/^\/groups\/[^/]+\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+/i.test(path)) return null;
    if (initialPageUrl) {
      const initialPath = new URL(initialPageUrl, window.location.origin).pathname.replace(/\/$/, "");
      if (initialPath.toLowerCase() === path.toLowerCase()) return null;
    }
    // The tab was navigated to the target Facebook group before this check.
    // Facebook may rewrite the group segment from an API id to a vanity slug,
    // so the current post-page URL is stronger evidence than that segment.
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Poll for positive approval/publication evidence; ambiguity becomes UNKNOWN. */
async function waitForPostSubmissionResult({
  root = document,
  submittedText,
  submittedAt,
  timeout,
  interval,
  existingPostElements,
  existingPostUrls,
  submittedMediaCount,
  currentGroupId,
  initialPageUrl,
  getFailureReason,
  getInterruption,
  getSuccessEvidence,
  getPendingPostUrl,
  getNetworkPostUrl,
  onStateChange,
}: WaitForPostSubmissionResultOptions): Promise<FacebookPostSubmissionResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(0, timeout);
  const intervalMs = Math.max(1, interval);
  let successEvidence: string | null = null;
  let successEvidenceAt: number | null = null;
  let lastReportedState: FacebookPostStatus | null = null;

  console.log("[PostTracking] Waiting for Facebook submission result");

  const reportState = (status: FacebookPostStatus, details: Record<string, unknown> = {}) => {
    if (lastReportedState === status) return;
    lastReportedState = status;
    onStateChange?.(status, details);
  };

  reportState("PUBLISHING", { phase: "waiting-for-result" } as Record<string, unknown>);

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const interruption = getInterruption?.();
      if (interruption) {
        reportState(interruption.status, {
          detector: interruption.detector,
          source: interruption.source,
          shouldPauseQueue: interruption.shouldPauseQueue,
        });
        console.warn("[PostTracking] Facebook publishing interruption detected", {
          status: interruption.status,
          detector: interruption.detector,
          source: interruption.source,
          shouldPauseQueue: interruption.shouldPauseQueue,
        });
        return {
          status: interruption.status,
          reason: interruption.reason,
          source: interruption.source,
          detector: interruption.detector,
          shouldPauseQueue: interruption.shouldPauseQueue,
        };
      }

      const pending = detectPendingApprovalMessage(root);
      if (pending.detected) {
        const networkPendingPostUrl = getPendingPostUrl?.() ?? null;
        const postSurface = pending.surface.closest('[role="article"], [data-pagelet*="FeedUnit"]');
        const directPostUrl = networkPendingPostUrl
          ?? extractPostPermalink(pending.surface, currentGroupId)
          ?? (postSurface ? extractPostPermalink(postSurface, currentGroupId) : null);
        const pendingPost = directPostUrl ? { postUrl: directPostUrl } : findPublishedPost({
          root,
          submittedText,
          submittedAt,
          existingPostElements,
          existingPostUrls,
          submittedMediaCount,
          currentGroupId,
        });
        console.log("[PostTracking] Pending approval detected", {
          postUrl: pendingPost?.postUrl ?? getCurrentPagePostUrl(currentGroupId, initialPageUrl),
        });
        const pendingPageUrl = getCurrentPagePostUrl(currentGroupId, initialPageUrl) ?? undefined;
        return {
          status: "PENDING_APPROVAL",
          ...((pendingPost?.postUrl ?? pendingPageUrl) ? { postUrl: pendingPost?.postUrl ?? pendingPageUrl } : {}),
        };
      }

      const failureReason = getFailureReason?.();
      if (failureReason) throw new Error(failureReason);

      const publishedPost = findPublishedPost({
        root,
        submittedText,
        submittedAt,
        existingPostElements,
        existingPostUrls,
        submittedMediaCount,
        currentGroupId,
      });
      if (publishedPost) {
        const verifiedPageUrl = publishedPost.postUrl ? undefined : (getCurrentPagePostUrl(currentGroupId, initialPageUrl) ?? undefined);
        console.log("[PostTracking] Published post detected", {
          postUrl: publishedPost.postUrl ?? verifiedPageUrl,
          matchedSubmittedContent: true,
        });
        return {
          status: "PUBLISHED",
          ...((publishedPost.postUrl ?? verifiedPageUrl) ? { postUrl: publishedPost.postUrl ?? verifiedPageUrl } : {}),
        };
      }

      const networkPostUrl = getNetworkPostUrl?.();
      if (networkPostUrl) {
        console.log("[PostTracking] Published post URL detected from Facebook response", {
          postUrl: networkPostUrl,
        });
        return { status: "PUBLISHED", postUrl: networkPostUrl };
      }

      const navigatedPostUrl = getCurrentPagePostUrl(currentGroupId, initialPageUrl);
      if (navigatedPostUrl) {
        console.log("[PostTracking] Published post detected from Facebook redirect", {
          postUrl: navigatedPostUrl,
          matchedSubmittedContent: false,
          navigationStartedFrom: initialPageUrl,
        });
        return { status: "PUBLISHED", postUrl: navigatedPostUrl };
      }

      const evidence = getSuccessEvidence?.() ?? null;
      if (evidence && !successEvidenceAt) {
        successEvidence = evidence;
        successEvidenceAt = Date.now();
        console.log("[PostTracking] Facebook publish success evidence detected", { evidence });
      }
      if (successEvidenceAt && Date.now() - successEvidenceAt >= 2_000) {
        console.log("[PostTracking] Facebook publish success evidence is stable; waiting for permalink", {
          evidence: successEvidence,
        });
        successEvidenceAt = Number.POSITIVE_INFINITY;
      }
    } catch {
      // Facebook can replace the document or detach nodes while updating the feed.
      // Continue polling; ambiguity must not be reported as publication.
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    await waitForTrackingDelay(Math.min(intervalMs, remainingMs));
  }

  if (successEvidence) {
    console.log("[PostTracking] Treating explicit Facebook success evidence as published without permalink", {
      evidence: successEvidence,
    });
    return {
      status: "PUBLISHED",
    };
  }

  console.warn("[PostTracking] Submission status could not be determined");
  return {
    status: "UNKNOWN",
    reason: "Unable to determine Facebook post submission result",
  };
}

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
  onDiagnostic?: (
    step: string,
    details?: Record<string, string | number | boolean | null | undefined>,
  ) => void;
}

const PENDING_POST_URL_GRACE_MS = 5_000;

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

function isPendingApprovalPostUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    return /^\/groups\/[^/]+\/pending_posts\/[A-Za-z0-9_-]+/i.test(
      new URL(value, window.location.origin).pathname,
    );
  } catch {
    return false;
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
  onDiagnostic,
}: WaitForPostSubmissionResultOptions): Promise<FacebookPostSubmissionResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(0, timeout);
  const intervalMs = Math.max(1, interval);
  let successEvidence: string | null = null;
  let successEvidenceAt: number | null = null;
  let pendingApprovalDetectedAt: number | null = null;
  let pendingApprovalSurface: Element | null = null;
  let pendingUrlProbeAttempt = 0;
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
      const networkPendingPostUrl = getPendingPostUrl?.() ?? null;
      if (pending.detected) pendingApprovalSurface = pending.surface;
      if (pending.detected || networkPendingPostUrl || pendingApprovalDetectedAt !== null) {
        const firstPendingDetection = pendingApprovalDetectedAt === null;
        pendingApprovalDetectedAt ??= Date.now();
        reportState("PENDING_APPROVAL", { phase: "waiting-for-pending-url" });
        const pendingSurface = pending.detected ? pending.surface : pendingApprovalSurface;
        const postSurface = pendingSurface?.closest(
          '[role="article"], [data-pagelet*="FeedUnit"], [aria-posinset]'
        );
        const surfacePostUrl = pendingSurface
          ? extractPostPermalink(pendingSurface, currentGroupId)
          : null;
        const cardPostUrl = postSurface
          ? extractPostPermalink(postSurface, currentGroupId)
          : null;
        const pendingLinkElements = postSurface
          ? Array.from(postSurface.querySelectorAll<HTMLAnchorElement>('a[href*="/pending_posts/"]'))
          : [];
        const pendingLinkHref = pendingLinkElements[0]?.href ?? null;
        const directPostUrl = networkPendingPostUrl ?? surfacePostUrl ?? cardPostUrl;
        const pendingPost = directPostUrl ? { postUrl: directPostUrl } : findPublishedPost({
          root,
          submittedText,
          submittedAt,
          existingPostElements,
          existingPostUrls,
          submittedMediaCount,
          currentGroupId,
        });
        const pendingPageUrl = getCurrentPagePostUrl(currentGroupId, initialPageUrl) ?? undefined;
        const pendingPostUrl = pendingPost?.postUrl ?? pendingPageUrl;
        pendingUrlProbeAttempt += 1;
        onDiagnostic?.('pending_post_url_probe', {
          attempt: pendingUrlProbeAttempt,
          firstPendingDetection,
          pendingMessageDetected: pending.detected,
          reusedPendingSurface: !pending.detected && pendingSurface !== null,
          pendingSurfaceTag: pendingSurface?.tagName ?? null,
          virtualizedCardFound: postSurface?.matches('[aria-posinset]') ?? false,
          cardAriaPosInSet: postSurface?.getAttribute('aria-posinset') ?? null,
          pendingLinkCount: pendingLinkElements.length,
          pendingLinkHref,
          networkPendingPostUrl,
          surfacePostUrl,
          cardPostUrl,
          pendingPageUrl: pendingPageUrl ?? null,
          resolvedPostUrl: pendingPostUrl ?? null,
        });
        if (!pendingPostUrl && Date.now() - pendingApprovalDetectedAt < PENDING_POST_URL_GRACE_MS) {
          if (firstPendingDetection) {
            console.log("[PostTracking] Pending approval detected; waiting briefly for its URL");
            onDiagnostic?.('pending_post_url_wait_started', {
              graceMs: PENDING_POST_URL_GRACE_MS,
            });
          }
          const remainingMs = timeoutMs - (Date.now() - startedAt);
          if (remainingMs > 0) {
            await waitForTrackingDelay(Math.min(intervalMs, remainingMs));
            continue;
          }
        }
        console.log("[PostTracking] Pending approval result ready", {
          postUrl: pendingPostUrl,
        });
        onDiagnostic?.(
          pendingPostUrl ? 'pending_post_url_resolved' : 'pending_post_url_missing',
          {
            attempts: pendingUrlProbeAttempt,
            postUrl: pendingPostUrl ?? null,
            source: networkPendingPostUrl
              ? 'network'
              : surfacePostUrl
                ? 'pending_surface'
                : cardPostUrl
                  ? 'virtualized_card'
                  : pendingPageUrl
                    ? 'navigation'
                    : null,
          },
        );
        return {
          status: "PENDING_APPROVAL",
          ...(pendingPostUrl ? { postUrl: pendingPostUrl } : {}),
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
        const matchedPostUrl = publishedPost.postUrl ?? verifiedPageUrl;
        if (isPendingApprovalPostUrl(matchedPostUrl)) {
          console.log("[PostTracking] Pending approval post detected from matched post", {
            postUrl: matchedPostUrl,
          });
          return { status: "PENDING_APPROVAL", postUrl: matchedPostUrl };
        }
        console.log("[PostTracking] Published post detected", {
          postUrl: matchedPostUrl,
          matchedSubmittedContent: true,
        });
        return {
          status: "PUBLISHED",
          ...(matchedPostUrl ? { postUrl: matchedPostUrl } : {}),
        };
      }

      const networkPostUrl = getNetworkPostUrl?.();
      if (networkPostUrl) {
        if (isPendingApprovalPostUrl(networkPostUrl)) {
          console.log("[PostTracking] Pending approval detected from Facebook response", {
            postUrl: networkPostUrl,
          });
          return { status: "PENDING_APPROVAL", postUrl: networkPostUrl };
        }
        console.log("[PostTracking] Published post URL detected from Facebook response", {
          postUrl: networkPostUrl,
        });
        return { status: "PUBLISHED", postUrl: networkPostUrl };
      }

      const navigatedPostUrl = getCurrentPagePostUrl(currentGroupId, initialPageUrl);
      if (navigatedPostUrl) {
        if (isPendingApprovalPostUrl(navigatedPostUrl)) {
          console.log("[PostTracking] Pending approval detected from Facebook redirect", {
            postUrl: navigatedPostUrl,
          });
          return { status: "PENDING_APPROVAL", postUrl: navigatedPostUrl };
        }
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

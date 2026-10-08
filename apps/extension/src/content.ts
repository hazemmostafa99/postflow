// ── Constants ──

interface FacebookResponseCandidateDetail {
  requestUrl?: string;
  requestStartedAt?: unknown;
  isStoryCreateResponse?: unknown;
  postUrls?: unknown[];
  storyFbids?: unknown[];
  videoIds?: unknown[];
  uploadSessionIds?: unknown[];
  pendingPostCandidates?: unknown[];
}

const EXCLUDED_SLUGS = new Set([
  "feed", "discover", "create", "joins",
  "requests", "questions", "members",
  "media", "events", "files", "search", "about",
]);

// Facebook UI button texts that are NOT group names (Arabic + English)
const EXCLUDED_NAMES = new Set([
  // Arabic
  "عرض المجموعة",
  "انضم إلى المجموعة",
  "الانضمام",
  "انضم",
  "متابعة",
  "إلغاء المتابعة",
  "إعداداتي",
  "مشاركة",
  "المزيد",
  "أعجبني",
  "تعرف على المزيد عن هذه المجموعة",
  "تعرف على المزيد",
  "حول هذه المجموعة",
  // English
  "View Group",
  "View group",
  "Join Group",
  "Join group",
  "Join",
  "Follow",
  "Unfollow",
  "Like",
  "Share",
  "More",
  "My settings",
  "Invite",
  "Joined",
  "Learn more about this group",
  "About this group",
]);

const EXCLUDED_NAME_SUBSTRINGS = [
  "تعرف على المزيد",
  "learn more about this group",
  "about this group",
  "غير مقروءة",
  "مطلوب الموافقة",
  "approval required",
  "requires approval",
  "unread",
  "new post",
];

// ── State ──

const POSTING_TIMING = (globalThis as { PostFlowPostingTiming?: PostFlowPostingTimingConfig }).PostFlowPostingTiming!;

type PostingLogDetails = Record<string, string | number | boolean | null | undefined>;

function recordPostingStep(jobId: string, step: string, details: PostingLogDetails = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    jobId,
    step,
    url: location.href,
    details,
  };
  console.log(`[PostFlow][${jobId}][${step}]`, details);
  try {
    chrome.runtime.sendMessage({ type: 'POSTING_LOG', entry }).catch(() => undefined);
  } catch {
    // The page can be unloading while Facebook navigates.
  }
}
const groups = new Map<string, FacebookGroup>();
let lastSentSignature = "";
let isExecutingJob = false;
let activeJobId: string | null = null;
let activeJobUsesEnglishGroupFlow = false;
let activeJobPublishedVideoIds: string[] = [];

interface PendingPostNetworkCandidate {
  postUrls: string[];
  postIds: string[];
  texts: string[];
  videoIds: string[];
  observedAt: number;
}

const pendingPostNetworkCandidates: PendingPostNetworkCandidate[] = [];
const pendingPostNetworkCandidateKeys = new Set<string>();

function normalizePendingCandidateText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function trackPendingPageNetworkCandidates(detail: FacebookResponseCandidateDetail): void {
  if (!/^\/groups\/[^/]+\/pending_posts\/?$/i.test(location.pathname)) return;
  if (!Array.isArray(detail.pendingPostCandidates)) return;

  for (const rawCandidate of detail.pendingPostCandidates) {
    if (!rawCandidate || typeof rawCandidate !== 'object') continue;
    const candidate = rawCandidate as Record<string, unknown>;
    const postUrls = Array.isArray(candidate.postUrls)
      ? candidate.postUrls.filter((value): value is string => typeof value === 'string')
      : [];
    const postIds = Array.isArray(candidate.postIds)
      ? candidate.postIds.filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
      : [];
    const texts = Array.isArray(candidate.texts)
      ? candidate.texts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const videoIds = Array.isArray(candidate.videoIds)
      ? candidate.videoIds.filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
      : [];
    if (!texts.length || (!postUrls.length && !postIds.length)) continue;
    const key = `${postUrls.join(',')}|${postIds.join(',')}|${texts.join('|')}|${videoIds.join(',')}`;
    if (pendingPostNetworkCandidateKeys.has(key)) continue;
    pendingPostNetworkCandidateKeys.add(key);
    pendingPostNetworkCandidates.push({ postUrls, postIds, texts, videoIds, observedAt: Date.now() });
  }
  if (pendingPostNetworkCandidates.length > 200) {
    pendingPostNetworkCandidates.splice(0, pendingPostNetworkCandidates.length - 200);
  }
}

function getPendingLookupGroupId(post: PendingFacebookPost): string | null {
  try {
    return new URL(post.groupUrl).pathname.match(/^\/groups\/([^/]+)/i)?.[1] ??
      post.groupExternalId ??
      post.groupId ??
      null;
  } catch {
    return post.groupExternalId ?? post.groupId ?? null;
  }
}

function findMatchingPendingNetworkPostUrl(post: PendingFacebookPost): string | null {
  const submittedText = normalizePendingCandidateText(post.content ?? '');
  if (!submittedText) return null;
  const expectedVideoIds = new Set((post.videoIds ?? []).filter((value) => /^\d+$/.test(value)));
  const groupId = getPendingLookupGroupId(post);
  if (!groupId) return null;

  const textMatches = pendingPostNetworkCandidates.filter((candidate) =>
    candidate.texts.some((value) => normalizePendingCandidateText(value) === submittedText),
  );
  if (!textMatches.length) return null;
  const videoMatch = textMatches.find((candidate) =>
    expectedVideoIds.size > 0 && candidate.videoIds.some((value) => expectedVideoIds.has(value)),
  );
  const candidate = videoMatch ?? textMatches[textMatches.length - 1];

  for (const value of candidate.postUrls) {
    const normalized = normalizeTrackedPostUrl(value);
    if (!normalized || !/\/pending_posts\//i.test(normalized)) continue;
    const candidateGroupId = extractFacebookGroupIdFromUrl(normalized);
    if (candidateGroupId && candidateGroupId.toLowerCase() !== groupId.toLowerCase()) continue;
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }
  const postId = candidate.postIds[0];
  return postId
    ? `https://www.facebook.com/groups/${groupId}/pending_posts/${postId}/`
    : null;
}

function getPendingNetworkMatchDiagnostics(post: PendingFacebookPost): PostingLogDetails {
  const submittedText = normalizePendingCandidateText(post.content ?? '');
  const expectedVideoIds = new Set((post.videoIds ?? []).filter((value) => /^\d+$/.test(value)));
  let candidateTextCount = 0;
  let exactTextMatchCount = 0;
  let containingTextMatchCount = 0;
  let expectedVideoOverlapCount = 0;
  let exactTextAndVideoOverlapCount = 0;
  let directPendingUrlCount = 0;

  for (const candidate of pendingPostNetworkCandidates) {
    const normalizedTexts = candidate.texts.map(normalizePendingCandidateText).filter(Boolean);
    candidateTextCount += normalizedTexts.length;
    const exactTextMatch = Boolean(submittedText) && normalizedTexts.some((value) => value === submittedText);
    const containingTextMatch = Boolean(submittedText) && normalizedTexts.some((value) =>
      value.includes(submittedText) || submittedText.includes(value)
    );
    const expectedVideoOverlap = expectedVideoIds.size > 0 &&
      candidate.videoIds.some((value) => expectedVideoIds.has(value));
    if (exactTextMatch) exactTextMatchCount += 1;
    if (containingTextMatch) containingTextMatchCount += 1;
    if (expectedVideoOverlap) expectedVideoOverlapCount += 1;
    if (exactTextMatch && expectedVideoOverlap) exactTextAndVideoOverlapCount += 1;
    if (candidate.postUrls.some((value) => /\/pending_posts\//i.test(value))) {
      directPendingUrlCount += 1;
    }
  }

  return {
    submittedTextLength: submittedText.length,
    expectedVideoIdCount: expectedVideoIds.size,
    candidateTextCount,
    exactTextMatchCount,
    containingTextMatchCount,
    expectedVideoOverlapCount,
    exactTextAndVideoOverlapCount,
    directPendingUrlCount,
  };
}

type PublishCandidateSource = 'response-post-url' | 'response-story-fbid';

interface PublishTrackingCandidate {
  source: PublishCandidateSource;
  value: string;
  requestUrl?: string;
  requestStartedAt?: number;
  observedAt: number;
}

interface PublishTrackingSession {
  jobId: string;
  groupId?: string;
  submittedAt: number;
  acceptCandidatesAfter: number;
  hasVideo: boolean;
  existingPostUrls: ReadonlySet<string>;
  candidates: PublishTrackingCandidate[];
  candidateKeys: Set<string>;
  mediaVideoIds: Set<string>;
  uploadSessionIds: Set<string>;
}

let activePublishTrackingSession: PublishTrackingSession | null = null;

function createPublishTrackingSession(options: {
  jobId: string;
  groupId?: string;
  submittedAt: number;
  hasVideo: boolean;
  existingPostUrls: ReadonlySet<string>;
}): PublishTrackingSession {
  const session: PublishTrackingSession = {
    ...options,
    acceptCandidatesAfter: 0,
    candidates: [],
    candidateKeys: new Set(),
    mediaVideoIds: new Set(),
    uploadSessionIds: new Set(),
  };
  console.log('[PostTracking] Publish tracking session started', {
    jobId: session.jobId,
    groupId: session.groupId,
    hasVideo: session.hasVideo,
    existingPostUrlCount: session.existingPostUrls.size,
  });
  return session;
}

function normalizeTrackedPostUrl(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    const path = url.pathname.replace(/\/+$/, '');
    if (!/^\/groups\/[^/]+\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+/i.test(path)) return null;
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return null;
  }
}

function addPublishCandidate(
  session: PublishTrackingSession,
  source: PublishCandidateSource,
  value: string,
  requestUrl?: string,
  requestStartedAt?: number,
): void {
  const key = `${source}:${value}`;
  if (session.candidateKeys.has(key)) return;
  session.candidateKeys.add(key);
  session.candidates.push({ source, value, requestUrl, requestStartedAt, observedAt: Date.now() });
}

function trackFacebookResponseCandidates(detail: FacebookResponseCandidateDetail): void {
  if (activeProfileTrackingSession) {
    trackProfileResponseCandidates(detail);
    return;
  }
  const session = activePublishTrackingSession;
  if (!session) return;

  const isActivePublishResponse = isResponseForActivePublish(
    detail,
    session.acceptCandidatesAfter,
  );

  const postUrls = isActivePublishResponse && Array.isArray(detail.postUrls)
    ? detail.postUrls.filter((url): url is string => typeof url === 'string')
    : [];
  const storyFbids = isActivePublishResponse && Array.isArray(detail.storyFbids)
    ? detail.storyFbids.filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
    : [];
  const videoIds = Array.isArray(detail.videoIds)
    ? detail.videoIds.filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
    : [];
  const uploadSessionIds = Array.isArray(detail.uploadSessionIds)
    ? detail.uploadSessionIds.filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
    : [];

  if (!session.hasVideo) {
    for (const postUrl of postUrls) {
      addPublishCandidate(session, 'response-post-url', postUrl, detail.requestUrl, detail.requestStartedAt as number);
    }
  } else if (postUrls.length) {
    const currentPageGroupId = extractFacebookGroupIdFromUrl(location.href)?.toLowerCase();
    const sameGroupPostUrls = postUrls.filter((postUrl) => {
      try {
        const parsedUrl = new URL(postUrl, window.location.origin);
        const path = parsedUrl.pathname;
        if (!/^\/groups\/[^/]+\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+/i.test(path)) return false;
        const candidateGroupId = extractFacebookGroupIdFromUrl(postUrl)?.toLowerCase();
        return Boolean(
          candidateGroupId &&
          (candidateGroupId === session.groupId?.toLowerCase() || candidateGroupId === currentPageGroupId),
        );
      } catch {
        return false;
      }
    });
    for (const postUrl of sameGroupPostUrls) {
      addPublishCandidate(session, 'response-post-url', postUrl, detail.requestUrl, detail.requestStartedAt as number);
    }
    console.log('[PostTracking] Ignoring direct network post URLs during video publish', {
      jobId: session.jobId,
      ignoredPostUrlCount: postUrls.length - sameGroupPostUrls.length,
      acceptedSameGroupPostUrlCount: sameGroupPostUrls.length,
      reason: 'video responses can include unrelated feed stories; same-group links are retained',
      requestUrl: detail.requestUrl,
    });
  }
  for (const storyFbid of storyFbids) {
    addPublishCandidate(session, 'response-story-fbid', storyFbid, detail.requestUrl, detail.requestStartedAt as number);
  }
  for (const videoId of videoIds) session.mediaVideoIds.add(videoId);
  for (const uploadSessionId of uploadSessionIds) session.uploadSessionIds.add(uploadSessionId);

  if (postUrls.length || storyFbids.length || videoIds.length || uploadSessionIds.length) {
    console.log('[PostTracking] Facebook network candidates observed', {
      jobId: session.jobId,
      postUrlCount: postUrls.length,
      storyFbidCount: storyFbids.length,
      videoIdCount: videoIds.length,
      uploadSessionIdCount: uploadSessionIds.length,
      requestUrl: detail.requestUrl,
    });
  }
}

function getBestNetworkPostUrl(session: PublishTrackingSession): string | null {
  for (let index = session.candidates.length - 1; index >= 0; index--) {
    const candidate = session.candidates[index];
    if (candidate.observedAt < session.acceptCandidatesAfter) continue;
    if (candidate.requestStartedAt === undefined || candidate.requestStartedAt < session.acceptCandidatesAfter) continue;
    const candidateUrl = candidate.source === 'response-story-fbid' && session.groupId
      ? 'https://www.facebook.com/groups/' + session.groupId + '/posts/' + candidate.value + '/'
      : candidate.value;
    const normalizedCandidate = normalizeTrackedPostUrl(candidateUrl);
    if (!normalizedCandidate) {
      console.log('[PostTracking] Rejected network candidate', {
        jobId: session.jobId,
        source: candidate.source,
        reason: 'not-a-group-post-url',
      });
      continue;
    }
    if (/\/pending_posts\//i.test(normalizedCandidate)) {
      console.log('[PostTracking] Rejected published network candidate', {
        jobId: session.jobId,
        source: candidate.source,
        reason: 'pending-approval-url',
      });
      continue;
    }
    if (session.existingPostUrls.has(normalizedCandidate)) {
      console.log('[PostTracking] Rejected network candidate', {
        jobId: session.jobId,
        source: candidate.source,
        reason: 'already-present-before-submit',
      });
      continue;
    }
    const candidateGroupId = extractFacebookGroupIdFromUrl(candidateUrl);
    const currentPageGroupId = extractFacebookGroupIdFromUrl(location.href);
    if (
      candidate.source === 'response-post-url' &&
      session.groupId &&
      candidateGroupId &&
      candidateGroupId.toLowerCase() !== session.groupId.toLowerCase() &&
      (!currentPageGroupId || candidateGroupId.toLowerCase() !== currentPageGroupId.toLowerCase())
    ) {
      console.log('[PostTracking] Rejected network candidate', {
        jobId: session.jobId,
        source: candidate.source,
        reason: 'different-group',
        candidateGroupId,
        expectedGroupId: session.groupId,
      });
      continue;
    }
    console.log('[PostTracking] Accepted network candidate', {
      jobId: session.jobId,
      source: candidate.source,
      postUrl: candidateUrl,
      requestUrl: candidate.requestUrl,
    });
    return candidateUrl;
  }
  return null;
}

function getBestNetworkPendingPostUrl(session: PublishTrackingSession): string | null {
  for (let index = session.candidates.length - 1; index >= 0; index--) {
    const candidate = session.candidates[index];
    if (candidate.observedAt < session.acceptCandidatesAfter) continue;
    if (candidate.requestStartedAt === undefined || candidate.requestStartedAt < session.acceptCandidatesAfter) continue;
    if (candidate.source !== 'response-post-url') continue;
    const normalizedCandidate = normalizeTrackedPostUrl(candidate.value);
    if (!normalizedCandidate || !/\/pending_posts\//i.test(normalizedCandidate)) continue;
    if (session.existingPostUrls.has(normalizedCandidate)) continue;
    const candidateGroupId = extractFacebookGroupIdFromUrl(candidate.value);
    const currentPageGroupId = extractFacebookGroupIdFromUrl(location.href);
    if (
      session.groupId &&
      candidateGroupId &&
      candidateGroupId.toLowerCase() !== session.groupId.toLowerCase() &&
      (!currentPageGroupId || candidateGroupId.toLowerCase() !== currentPageGroupId.toLowerCase())
    ) {
      continue;
    }
    console.log('[PostTracking] Accepted network pending-post candidate', {
      jobId: session.jobId,
      postUrl: candidate.value,
      requestUrl: candidate.requestUrl,
    });
    return candidate.value;
  }
  return null;
}

function injectFacebookResponseSpy(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/graphql-spy.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

window.addEventListener('postflow:facebook-response', ((event: CustomEvent<FacebookResponseCandidateDetail>) => {
  trackPendingPageNetworkCandidates(event.detail ?? {});
  if (!isExecutingJob) return;
  trackFacebookResponseCandidates(event.detail ?? {});
}) as EventListener, false);

window.addEventListener('message', ((event: MessageEvent<FacebookResponseCandidateDetail & { source?: string; type?: string }>) => {
  if (event.source !== window || event.data?.source !== 'postflow-graphql-spy' || event.data.type !== 'facebook-response') return;
  trackPendingPageNetworkCandidates(event.data);
  if (!isExecutingJob) return;
  trackFacebookResponseCandidates(event.data);
}) as EventListener, false);

injectFacebookResponseSpy();

// ── Cleanup registry ──

let mutationObserver: MutationObserver | null = null;
let port: chrome.runtime.Port | null = null;

function cleanup() {
  mutationObserver?.disconnect();
  mutationObserver = null;

  console.log("[PostFlow] Cleaned up");
}

// ── Port connection ──

function connect() {
  try {
    port = chrome.runtime.connect({ name: "postflow-content" });
  } catch {
    // Extension not available
    return;
  }

  port.onDisconnect.addListener(() => {
    // Extension was reloaded or updated — stop everything
    port = null;
    cleanup();
  });

  console.log("[PostFlow] Connected to background");
}

function sendGroups() {
  if (!port) return;

  const groupList = Array.from(groups.values());
  const signature = groupList.map((g) => `${g.id}:${g.name}`).join("|");

  if (signature === lastSentSignature) return;

  lastSentSignature = signature;

  try {
    port.postMessage({
      type: "GROUPS_DETECTED",
      groups: groupList,
    });
  } catch {
    // Port disconnected before onDisconnect fired (async timing gap)
    port = null;
    cleanup();
    return;
  }

  console.log(`[PostFlow] Sent ${groupList.length} groups`);
}

// ── URL helpers ──

function extractGroupId(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    // Strip trailing slash before matching to avoid "joins/" not matching "joins"
    const path = url.pathname.replace(/\/$/, "");
    const match = path.match(/^\/groups\/([^/?#]+)/);
    if (!match) return null;
    const slug = match[1];
    return EXCLUDED_SLUGS.has(slug) ? null : slug;
  } catch {
    return null;
  }
}

function canonicalizeGroupUrl(id: string): string {
  return `https://www.facebook.com/groups/${id}/`;
}

// ── Strategy 1: DOM extraction ──

function normalizeGroupNameCandidate(text: string): string {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisyGroupName(text: string): boolean {
  const normalized = normalizeGroupNameCandidate(text).toLowerCase();
  return EXCLUDED_NAME_SUBSTRINGS.some((s) => normalized.includes(s.toLowerCase()));
}

function isValidName(text: string): boolean {
  const normalized = normalizeGroupNameCandidate(text);
  if (!normalized || normalized.length < 2 || normalized.length > 150) return false;
  if (EXCLUDED_NAMES.has(normalized)) return false;
  return !isNoisyGroupName(normalized);
}

function bestNameFromText(text?: string | null): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const candidate = normalizeGroupNameCandidate(line);
    if (isValidName(candidate)) return candidate;
  }
  const candidate = normalizeGroupNameCandidate(text);
  return isValidName(candidate) ? candidate : null;
}

function extractNameFromLink(link: HTMLAnchorElement): string | null {
  // Facebook often puts notification text in aria-label, so prefer visible title text.
  return bestNameFromText(link.innerText) ?? bestNameFromText(link.getAttribute("aria-label"));
}

function extractGroupFromLink(link: HTMLAnchorElement): FacebookGroup | null {
  const id = extractGroupId(link.href);
  if (!id) return null;

  const name = extractNameFromLink(link);
  if (!name) return null;

  // If the slug is all digits, it IS the numeric ID
  const numericId = /^\d+$/.test(id) ? id : undefined;

  return { id, numericId, name, url: canonicalizeGroupUrl(id), nameSource: "dom" };
}

function addGroup(group: FacebookGroup): boolean {
  if (!isValidName(group.name)) return false;

  const existing = groups.get(group.id);
  const url = canonicalizeGroupUrl(group.id);
  const cleanName = normalizeGroupNameCandidate(group.name);

  if (!existing) {
    groups.set(group.id, { ...group, name: cleanName, url });
    console.log("[PostFlow] Group:", group.name);
    return true;
  }

  const shouldReplaceName =
    isValidName(cleanName) &&
    (
      isNoisyGroupName(existing.name) ||
      existing.name === existing.id ||
      existing.name === existing.numericId ||
      (
        group.nameSource === "graphql" &&
        normalizeGroupNameCandidate(existing.name).length > cleanName.length + 20
      )
    );
  const updatedNumericId = group.numericId ?? existing.numericId;
  const hasChanges =
    existing.url !== url ||
    existing.numericId !== updatedNumericId ||
    shouldReplaceName;

  if (hasChanges) {
    groups.set(group.id, {
      ...existing,
      ...group,
      name: shouldReplaceName ? cleanName : existing.name,
      url,
      numericId: updatedNumericId,
      nameSource: shouldReplaceName ? group.nameSource : existing.nameSource ?? group.nameSource,
    });
    return true;
  }

  return false;
}

function scanDOM(root: ParentNode = document): boolean {
  if (isExecutingJob) return false;
  let changed = false;
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]');

  for (const link of links) {
    const group = extractGroupFromLink(link);
    if (group && addGroup(group)) {
      changed = true;
    }
  }

  return changed;
}

// ── Scan scheduling ──

function scheduleScan() {
  if (!port) return;
  const changed = scanDOM();
  if (changed) sendGroups();
}

// ── Strategy 2: GraphQL interception (passive spy removed) ──
// The GraphQL spy is no longer injected automatically.
// It was causing group names to be overwritten from Facebook's API calls
// whenever the extension opened a group page to execute a post.
// Manual sync uses fetchAllGroupsFromGraphQL() directly instead.

// ── Strategy 3: Active GraphQL fetch (gets ALL groups the user is a member of) ──
// Facebook exposes the user's groups via the same GraphQL API the app uses.
// We call it directly using the session cookies already in the browser.

async function fetchAllGroupsFromGraphQL(): Promise<void> {
  // Grab the __dtsg token Facebook requires on every API call (anti-CSRF)
  let dtsg = '';
  try {
    // Facebook stores it in a meta tag or in the page's __d("DTSGInitData",...) call
    const metaDtsg = document.querySelector<HTMLInputElement>('input[name="fb_dtsg"]');
    if (metaDtsg) {
      dtsg = metaDtsg.value;
    } else {
      // Parse from inline script
      const regexes = [
        /"token":"(AQIA[^"]+)"/,
        /"(?:fb_dtsg|token)"\s*:\s*"([^"]+)"/,
        /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
        /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
      ];
      for (const rx of regexes) {
        const match = document.documentElement.innerHTML.match(rx);
        if (match) {
          dtsg = match[1];
          break;
        }
      }
    }
  } catch {
    // dtsg may not be available — Facebook will reject the request without it
  }

  if (!dtsg) {
    console.warn('[PostFlow] Could not find fb_dtsg token — skipping active GraphQL fetch');
    return;
  }

  let cursor: string | null = null;
  let pagesFetched = 0;
  let totalGroupsFetched = 0;
  const MAX_PAGES = 30; // safety limit (30 pages × ~10 groups = up to 300 groups)

  do {
    try {
      const variables: Record<string, unknown> = {
        count: 10,
        ...(cursor ? { cursor } : {}),
      };

      const body = new URLSearchParams({
        doc_id: '7049871405048867', // Facebook's "GroupsTab" doc_id for group memberships
        variables: JSON.stringify(variables),
        fb_dtsg: dtsg,
      });

      const res = await fetch('https://www.facebook.com/api/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'include',
      });

      if (!res.ok) break;

      const text = await res.text();
      collectGroupsFromGraphQLText(text);
      const lines = text.split('\n');
      let hasMore = false;
      cursor = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const data = JSON.parse(trimmed);
          
          // Count how many groups are in this page's response
          // (rough count by looking for the __typename === 'Group')
          const countGroups = (obj: any): number => {
            if (typeof obj !== 'object' || obj === null) return 0;
            let c = 0;
            if (obj.__typename === 'Group' && obj.name) c = 1;
            for (const val of Object.values(obj)) {
              c += countGroups(val);
            }
            return c;
          };
          totalGroupsFetched += countGroups(data);

          // Look for pagination info
          const pageInfo = findPageInfo(data);
          if (pageInfo) {
            hasMore = pageInfo.has_next_page ?? false;
            cursor = pageInfo.end_cursor ?? null;
          }
        } catch { /* skip */ }
      }

      window.dispatchEvent(new CustomEvent('postflow:graphql-text', { detail: text }));

      pagesFetched++;
      if (!hasMore || !cursor) break;

      await sleep(POSTING_TIMING.groupSyncPageDelayMs);
    } catch (err) {
      console.warn('[PostFlow] Active GraphQL fetch error:', err);
      break;
    }
  } while (pagesFetched < MAX_PAGES);

  console.log(`[PostFlow] Active GraphQL fetch complete: ${pagesFetched} page(s), ~${totalGroupsFetched} groups found`);
}

/** Recursively search for a GraphQL PageInfo node anywhere in the tree */
function findPageInfo(obj: unknown, depth = 0): { has_next_page?: boolean; end_cursor?: string } | null {
  if (depth > 20 || obj === null || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  
  // Facebook pagination object usually has has_next_page and end_cursor
  if (record.has_next_page !== undefined || record.end_cursor !== undefined) {
    // If it has BOTH or at least one, it's likely the right object
    if (typeof record.has_next_page === 'boolean' || typeof record.end_cursor === 'string') {
      return record as { has_next_page?: boolean; end_cursor?: string };
    }
  }
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findPageInfo(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(record)) {
    const val = record[key];
    if (typeof val === 'object' && val !== null) {
      const found = findPageInfo(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Extract Group nodes from an active GraphQL response and send them to the background. */
function collectGroupsFromGraphQLText(text: string): void {
  const findGroups = (value: unknown, depth = 0): FacebookGroup[] => {
    if (depth > 20 || value === null || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap((item) => findGroups(item, depth + 1));
    }

    const record = value as Record<string, unknown>;
    const found: FacebookGroup[] = [];
    if (record.__typename === 'Group' && typeof record.name === 'string' && record.name.trim()) {
      const numericId = typeof record.id === 'string' && /^\d+$/.test(record.id) ? record.id : undefined;
      const rawUrl = typeof record.url === 'string'
        ? record.url
        : typeof record.group_url === 'string'
          ? record.group_url
          : '';
      let id = rawUrl ? extractGroupId(rawUrl) : null;
      if (!id && typeof record.vanity === 'string' && record.vanity) id = record.vanity;
      if (!id && numericId) id = numericId;
      if (id && !EXCLUDED_SLUGS.has(id) && isValidName(record.name)) {
        found.push({
          id,
          numericId,
          name: normalizeGroupNameCandidate(record.name),
          url: canonicalizeGroupUrl(id),
          nameSource: "graphql",
        });
        return found;
      }
    }

    for (const child of Object.values(record)) {
      found.push(...findGroups(child, depth + 1));
    }
    return found;
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const groupsFromLine = findGroups(JSON.parse(trimmed));
      let changed = false;
      for (const group of groupsFromLine) changed = addGroup(group) || changed;
      if (changed) sendGroups();
    } catch {
      // Facebook may include non-JSON lines in the response stream.
    }
  }
}

// ── Init ──

function initialize() {
  console.log("[PostFlow] Group collector started — manual sync only");

  connect();

  // Do NOT auto-scan and do NOT inject the GraphQL spy.
  // Groups are only synced when the user explicitly clicks
  // "Sync with Extension" in the PostFlow web app, which triggers SCAN_NOW.
}

initialize();

// Tell the background script that this content script is fully loaded and ready.
// The background listens for this before sending EXECUTE_JOB.
try {
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
} catch {
  // Silently ignore if context is already gone (e.g. during hot reload)
}

function findMatchingEnglishVideoCard(
  post: PendingFacebookPost,
  allowVideoIdMismatch = false,
): HTMLElement | null {
  const submittedText = (post.content ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const expectedVideoIds = new Set((post.videoIds ?? []).filter((value) => /^\d+$/.test(value)));

  let textMatch: HTMLElement | null = null;
  for (const item of Array.from(document.querySelectorAll<HTMLElement>('[aria-posinset]'))) {
    const storyMessage = item.querySelector<HTMLElement>('[data-ad-rendering-role="story_message"]');
    const storyText = (storyMessage?.innerText || storyMessage?.textContent || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!submittedText || storyText !== submittedText) continue;

    const candidateVideoIds = Array.from(item.querySelectorAll<HTMLElement>('[data-video-id]'))
      .map((element) => element.getAttribute('data-video-id') ?? '')
      .filter((value): value is string => /^\d+$/.test(value));
    const videoIdMatches = !expectedVideoIds.size ||
      !candidateVideoIds.length ||
      candidateVideoIds.some((videoId) => expectedVideoIds.has(videoId));
    if (videoIdMatches) return item;
    if (allowVideoIdMismatch && !textMatch) textMatch = item;
  }
  return textMatch;
}

function normalizeEnglishVideoShareUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.hostname !== 'facebook.com' && !url.hostname.endsWith('.facebook.com')) return null;
    const shareMatch = url.pathname.match(/^\/share\/v\/([A-Za-z0-9_-]+)\/?$/i);
    if (shareMatch) return `https://www.facebook.com/share/v/${shareMatch[1]}/`;
    const groupPostMatch = url.pathname.match(
      /^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)\/?$/i,
    );
    if (!groupPostMatch) return null;
    return `https://www.facebook.com/groups/${groupPostMatch[1]}/${groupPostMatch[2]}/${groupPostMatch[3]}/`;
  } catch {
    return null;
  }
}

async function copyMatchedEnglishVideoShareUrl(
  post: PendingFacebookPost,
  card: HTMLElement,
): Promise<string | null> {
  recordPostingStep(post.id, 'english_video_link_capture_started');
  const actionsButton = card.querySelector<HTMLElement>(
    '[role="button"][aria-haspopup="menu"][aria-label^="Actions for this post"]',
  );
  if (!actionsButton) {
    recordPostingStep(post.id, 'english_video_actions_button_missing');
    return null;
  }
  recordPostingStep(post.id, 'english_video_actions_button_found');

  clickLikeUser(actionsButton);
  recordPostingStep(post.id, 'english_video_actions_button_clicked');
  const copyLinkItem = await waitForValue(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => (item.innerText || item.textContent || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase() === 'copy link') ?? null;
  }, 4000, 100);
  if (!copyLinkItem) {
    recordPostingStep(post.id, 'english_video_copy_link_item_missing');
    return null;
  }
  recordPostingStep(post.id, 'english_video_copy_link_item_found');

  const capturedShareUrl = new Promise<{ shareUrl: string; captureMethod: string } | null>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, 4000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== 'postflow-facebook-copy-link') return;
      const shareUrl = typeof event.data?.text === 'string'
        ? normalizeEnglishVideoShareUrl(event.data.text)
        : null;
      if (!shareUrl) return;
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      resolve({
        shareUrl,
        captureMethod: typeof event.data?.captureMethod === 'string'
          ? event.data.captureMethod
          : 'unknown',
      });
    };
    window.addEventListener('message', onMessage);
  });

  recordPostingStep(post.id, 'english_video_share_link_capture_waiting');
  clickLikeUser(copyLinkItem);
  recordPostingStep(post.id, 'english_video_copy_link_item_clicked');
  const captured = await capturedShareUrl;
  if (captured) {
    recordPostingStep(post.id, 'english_video_share_link_captured', {
      shareUrl: captured.shareUrl,
      captureMethod: captured.captureMethod,
    });
    return captured.shareUrl;
  }
  recordPostingStep(post.id, 'english_video_share_link_not_captured');
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCAN_NOW') {
    console.log('[PostFlow] Manual scan triggered by Web App');
    void (async () => {
      try {
        scheduleScan();
        await fetchAllGroupsFromGraphQL();
        scheduleScan();
        sendResponse({ ok: true, groupsDetected: groups.size });
      } catch (err: any) {
        console.error(err);
        sendResponse({ ok: false, error: err?.message ?? 'Facebook group sync failed' });
      }
    })();
    return true;
  }

  if (message.type === 'GET_PROFILE_VIDEO_NOTIFICATIONS') {
    const notifications = getProcessedProfileVideoNotifications();
    const surfaceReady = location.pathname.startsWith('/notifications') && Boolean(
      document.querySelector(
        '[role="main"], [role="complementary"], [role="list"], ' +
        'a[href*="notif_t=fb_shorts_video_processed"]',
      ),
    );
    console.log('[PostFlow] Processed profile-video notifications scanned', {
      jobId: message.jobId,
      count: notifications.length,
      surfaceReady,
    });
    sendResponse({ ok: true, surfaceReady, notifications });
    return;
  }

  if (message.type === 'CHECK_PENDING_POST') {
    void (async () => {
      try {
        console.log('[PendingPostSync] Content script received pending post check', {
          postId: message.post?.id,
          requestId: message.requestId,
          url: location.href,
        });
        const pendingPost = message.post as PendingFacebookPost;
        const isEnglishPendingApprovalLookup = pendingPost.englishPendingApprovalLookup === true;
        let matchedEnglishPendingCard: HTMLElement | null = null;
        let resolvedEnglishPendingPostUrl: string | null = null;
        let englishPendingUrlSource: 'network' | 'dom' | null = null;
        if (isEnglishPendingApprovalLookup) {
          let lastLoggedNetworkCandidateCount = -1;
          recordPostingStep(pendingPost.id, 'english_pending_post_wait_started', {
            timeoutMs: POSTING_TIMING.profileVideoPermalinkTimeoutMs,
          });
          const pendingEvidence = await waitForValue(
            () => {
              if (pendingPostNetworkCandidates.length !== lastLoggedNetworkCandidateCount) {
                lastLoggedNetworkCandidateCount = pendingPostNetworkCandidates.length;
                recordPostingStep(pendingPost.id, 'english_pending_network_candidates_observed', {
                  candidateCount: pendingPostNetworkCandidates.length,
                  candidatesWithPostId: pendingPostNetworkCandidates.filter((candidate) => candidate.postIds.length > 0).length,
                  candidatesWithDirectUrl: pendingPostNetworkCandidates.filter((candidate) => candidate.postUrls.length > 0).length,
                  ...getPendingNetworkMatchDiagnostics(pendingPost),
                });
              }
              const networkPostUrl = findMatchingPendingNetworkPostUrl(pendingPost);
              if (networkPostUrl) return { postUrl: networkPostUrl, source: 'network' as const };

              const matchedCard = findMatchingEnglishVideoCard(pendingPost, true);
              if (!matchedCard) return null;
              matchedEnglishPendingCard = matchedCard;
              const directPostUrl = extractPostPermalink(
                matchedCard,
                getPendingLookupGroupId(pendingPost) ?? undefined,
              );
              return directPostUrl
                ? { postUrl: directPostUrl, source: 'dom' as const }
                : null;
            },
            POSTING_TIMING.profileVideoPermalinkTimeoutMs,
            1000,
          );
          resolvedEnglishPendingPostUrl = pendingEvidence?.postUrl ?? null;
          englishPendingUrlSource = pendingEvidence?.source ?? null;
        }
        const ready = isEnglishPendingApprovalLookup
          ? Boolean(resolvedEnglishPendingPostUrl)
          : await waitForCondition(
            () => Boolean(
              document.querySelector('[role="main"]') ||
              document.querySelector('[data-pagelet*="Feed"]') ||
              document.querySelector('[role="article"]') ||
              document.querySelector('[aria-posinset]'),
            ),
            POSTING_TIMING.groupPageReadyTimeoutMs,
          );
        if (!ready) {
          const reason = isEnglishPendingApprovalLookup
            ? matchedEnglishPendingCard
              ? 'The submitted pending post appeared, but Facebook exposed no post URL or network post ID before the lookup expired'
              : 'The submitted post did not appear in Facebook pending posts before the upload wait expired'
            : 'Facebook group feed did not load';
          if (isEnglishPendingApprovalLookup) {
            recordPostingStep(pendingPost.id, 'english_pending_lookup_surface_missing', {
              pendingLinkCount: document.querySelectorAll('a[href*="/pending_posts/"]').length,
              virtualizedItemCount: document.querySelectorAll('[aria-posinset]').length,
              storyMessageCount: document.querySelectorAll('[aria-posinset] [data-ad-rendering-role="story_message"]').length,
              actionButtonCount: document.querySelectorAll('[aria-posinset] [aria-label^="Actions for this post"]').length,
              networkCandidateCount: pendingPostNetworkCandidates.length,
              submittedCardMatched: Boolean(matchedEnglishPendingCard),
              currentUrl: location.href,
            });
          }
          sendResponse({
            ok: true,
            result: { status: 'CHECK_FAILED', reason },
          });
          return;
        }

        if (isEnglishPendingApprovalLookup) {
          const matchedPendingCard = matchedEnglishPendingCard as HTMLElement | null;
          recordPostingStep(pendingPost.id, 'english_pending_lookup_surface_ready', {
            pendingLinkCount: document.querySelectorAll('a[href*="/pending_posts/"]').length,
            virtualizedItemCount: document.querySelectorAll('[aria-posinset]').length,
            matchedAriaPosInSet: matchedPendingCard?.getAttribute('aria-posinset') ?? null,
            matchedVideoIdCount: matchedPendingCard?.querySelectorAll('[data-video-id]').length ?? 0,
            networkCandidateCount: pendingPostNetworkCandidates.length,
            urlSource: englishPendingUrlSource,
            postUrl: resolvedEnglishPendingPostUrl,
            currentUrl: location.href,
          });
        }
        let result: PendingPostSyncResult = resolvedEnglishPendingPostUrl
          ? { status: 'STILL_PENDING', postUrl: resolvedEnglishPendingPostUrl }
          : checkPendingFacebookPost(pendingPost);
        if (isEnglishPendingApprovalLookup && resolvedEnglishPendingPostUrl) {
          recordPostingStep(pendingPost.id, 'english_pending_post_url_captured', {
            source: englishPendingUrlSource,
            postUrl: resolvedEnglishPendingPostUrl,
            networkCandidateCount: pendingPostNetworkCandidates.length,
          });
        }
        if (pendingPost.englishGroupVideo === true && !isEnglishPendingApprovalLookup) {
          recordPostingStep(pendingPost.id, 'english_video_content_match_started', {
            virtualizedItemCount: document.querySelectorAll('[aria-posinset]').length,
          });
          const matchedCard = findMatchingEnglishVideoCard(pendingPost);
          if (matchedCard) {
            const matchedVideoIdCount = matchedCard.querySelectorAll('[data-video-id]').length;
            recordPostingStep(pendingPost.id, 'english_video_content_matched', {
              matchedVideoIdCount,
            });
            console.log('[PendingPostSync] English Group video content matched successfully', {
              postId: pendingPost.id,
              matchedVideoIdCount,
            });
            const copiedShareUrl = await copyMatchedEnglishVideoShareUrl(pendingPost, matchedCard);
            result = {
              status: 'CONTENT_MATCHED',
              ...(copiedShareUrl ? { copiedShareUrl } : {}),
            };
          } else {
            recordPostingStep(pendingPost.id, 'english_video_content_match_not_found');
          }
        }
        console.log('[PendingPostSync] Content script matched pending post', {
          postId: message.post?.id,
          result,
        });
        console.log('[PendingPostSync] Check result', {
          postId: message.post?.id,
          status: result.status,
        });
        sendResponse({ ok: true, result });
      } catch (err: any) {
        sendResponse({
          ok: true,
          result: { status: 'CHECK_FAILED', reason: err?.message ?? 'Pending post check failed' },
        });
      }
    })();
    return true;
  }

  if (message.type === 'CHECK_POST_ENGAGEMENT') {
    void (async () => {
      try {
        console.log('[PostAnalytics] Engagement check received', {
          postId: message.post?.id,
          postUrl: message.post?.postUrl,
          currentUrl: location.href,
        });
        const result = await waitForPostEngagement(
          message.post?.postUrl ?? '',
          POSTING_TIMING.facebookTabReadyTimeoutMs,
        );
        console.log('[PostAnalytics] Engagement extraction result', {
          postId: message.post?.id,
          result,
        });
        sendResponse({
          ok: true,
          result,
          emptySurface: result.status === 'CHECK_FAILED' && result.emptySurface === true,
        });
      } catch (err: any) {
        console.error('[PostAnalytics] Engagement extraction error', err);
        sendResponse({ ok: true, result: { status: 'CHECK_FAILED', reason: err?.message ?? 'Engagement check failed' } });
      }
    })();
    return true;
  }

  if (message.type === 'EXECUTE_JOB') {
    if (isExecutingJob && activeJobId === message.jobId) {
      console.warn('[PostFlow] Ignoring duplicate EXECUTE_JOB for active job:', message.jobId);
      recordPostingStep(message.jobId, 'duplicate_job_ignored');
      sendResponse({ ok: true, accepted: true, duplicate: true });
      return;
    }
    if (isExecutingJob) {
      console.warn('[PostFlow] Ignoring EXECUTE_JOB while another job is active:', activeJobId);
      sendResponse({ ok: false, accepted: false, error: 'Another job is already active' });
      return;
    }
    const target = message.target;
    if (!target || (target.type !== 'GROUP' && target.type !== 'PROFILE_FEED')) {
      console.warn('[PostFlow] Refusing job with an unsupported publishing target', { jobId: message.jobId });
      chrome.runtime.sendMessage({
        type: 'JOB_FAILED',
        jobId: message.jobId,
        postId: message.post?._id,
        error: 'Unsupported publishing target',
      });
      sendResponse({ ok: false, accepted: false, error: 'Unsupported publishing target' });
      return;
    }
    console.log('[PostFlow] Received job to execute', { jobId: message.jobId, targetType: target.type });
    recordPostingStep(message.jobId, 'job_received', {
      hasContent: Boolean(message.post?.content),
      mediaCount: Array.isArray(message.post?.mediaUrls) ? message.post.mediaUrls.length : 0,
      targetType: target.type,
    });
    activeJobId = message.jobId;
    activeJobUsesEnglishGroupFlow = false;
    activeJobPublishedVideoIds = [];
    sendResponse({ ok: true, accepted: true });
    const profileVideoNotificationBaselineKeys = Array.isArray(message.profileVideoNotificationBaselineKeys)
      ? message.profileVideoNotificationBaselineKeys.filter((value: unknown): value is string => typeof value === 'string')
      : null;
    executeFacebookPost(
      message.jobId,
      message.post,
      target,
      profileVideoNotificationBaselineKeys,
    )
      .then((submissionResult) => {
        const publishedVideoIds = activeJobPublishedVideoIds;
        activeJobPublishedVideoIds = [];
        if (isFacebookPublishFailureResult(submissionResult)) {
          chrome.runtime.sendMessage({
            type: 'JOB_FAILED',
            jobId: message.jobId,
            postId: message.post?._id,
            error: formatFacebookPublishFailure(submissionResult),
            publishStatus: submissionResult.status,
            shouldPauseQueue: submissionResult.shouldPauseQueue ?? false,
            detector: submissionResult.detector,
          });
          return;
        }

        // We actually use chrome.runtime.sendMessage to communicate status
        // because the tab might navigate or reload, but the background script listens for it.
        chrome.runtime.sendMessage({
          type: 'JOB_SUCCESS',
          jobId: message.jobId,
          postId: message.post?._id,
          submissionResult,
          englishGroupFlow: target.type === 'GROUP' && activeJobUsesEnglishGroupFlow,
          videoIds: publishedVideoIds,
        });
      })
      .catch((err) => {
        activeJobPublishedVideoIds = [];
        const isAccountMismatch = err?.name === 'PostFlowAccountMismatch';
        chrome.runtime.sendMessage({
          type: err?.name === 'PostFlowJobCanceled' ? 'JOB_CANCELED' : 'JOB_FAILED',
          jobId: message.jobId,
          postId: message.post?._id,
          error: err.message,
          ...(isAccountMismatch ? { publishStatus: 'ACCOUNT_MISMATCH', shouldPauseQueue: true } : {}),
        });
      });
  }
});

// ── Job Execution (DOM Manipulation) ──

function isFacebookPublishFailureResult(
  result: FacebookPostSubmissionResult,
): result is Extract<FacebookPostSubmissionResult, { status: FacebookPublishInterruptionStatus }> {
  return [
    'TEMPORARY_BLOCK',
    'CAPTCHA_OR_CHALLENGE',
    'CHECKPOINT_OR_VERIFICATION',
    'LOGIN_REQUIRED',
    'UNEXPECTED_INTERRUPTION',
  ].includes(result.status);
}

function formatFacebookPublishFailure(result: Extract<FacebookPostSubmissionResult, { status: FacebookPublishInterruptionStatus }>): string {
  return [
    result.status,
    result.reason,
    result.detector ? `detector=${result.detector}` : '',
  ].filter(Boolean).join(': ');
}

function extractFacebookGroupIdFromUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function hasEnglishGroupComposerTrigger(root: ParentNode = document): boolean {
  const searchRoot = root.querySelector?.('[role="main"]') ?? root;
  const candidates = Array.from(
    searchRoot.querySelectorAll<HTMLElement>('[role="button"], button'),
  );

  return candidates.some((candidate) => {
    if (candidate.closest('[role="article"], [role="dialog"], [aria-modal="true"]')) return false;
    if (candidate.hidden || candidate.getAttribute('aria-hidden') === 'true') return false;

    const style = window.getComputedStyle(candidate);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

    const text = [
      candidate.getAttribute('aria-label'),
      candidate.getAttribute('aria-placeholder'),
      candidate.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return text.length <= 120 && [
      'write something',
      "what's on your mind",
      'create a post',
    ].some((phrase) => text.includes(phrase));
  });
}

async function executeFacebookPost(
  jobId: string,
  post: any,
  target: any,
  profileVideoNotificationBaselineKeys: readonly string[] | null = null,
): Promise<FacebookPostSubmissionResult> {
  return new Promise<FacebookPostSubmissionResult>(async (resolve, reject) => {
    isExecutingJob = true;
    try {
      console.log(`[PostFlow] Starting job ${jobId}`);
      const mediaUrls = Array.isArray(post.mediaUrls) ? post.mediaUrls.filter((url: unknown) => typeof url === 'string') : [];
      const hasMedia = mediaUrls.length > 0;
      const hasVideo = mediaUrls.some((url: string) => url.startsWith('data:video/'));
      const isProfileTarget = target?.type === 'PROFILE_FEED';
      const currentGroupId = isProfileTarget
        ? undefined
        : target?.externalId ??
          extractFacebookGroupIdFromUrl(target?.url) ??
          extractFacebookGroupIdFromUrl(window.location.href);
      const isTargetDestinationRoot = () => {
        if (isProfileTarget) return isExpectedProfileFeed(target as ProfileFeedTarget);
        try {
          const url = new URL(window.location.href);
          const path = url.pathname.replace(/\/+$/, '');
          const groupId = path.match(/^\/groups\/([^/]+)/i)?.[1];
          return Boolean(
            groupId &&
            currentGroupId &&
            groupId.toLowerCase() === currentGroupId.toLowerCase() &&
            path.toLowerCase() === `/groups/${groupId}`.toLowerCase(),
          );
        } catch {
          return false;
        }
      };
      recordPostingStep(jobId, 'job_started', {
        targetType: target?.type,
        hasContent: Boolean(post.content),
        mediaCount: mediaUrls.length,
        ...(currentGroupId ? { currentGroupId } : {}),
      });

      // 1. Find the "Write something…" composer trigger on the group page.

      const pageReady = await waitForCondition(
        () => isProfileTarget
          ? isExpectedProfileFeed(target as ProfileFeedTarget) && Boolean(document.querySelector('[role="main"]'))
          : Boolean(document.querySelector('[role="main"], [data-pagelet="GroupInlineComposer"]')) && (
            Boolean(document.querySelector(
              '[data-pagelet="GroupInlineComposer"] [role="button"], ' +
              '[data-pagelet="GroupInlineComposer"] button, ' +
              '[aria-label*="Create a post" i], ' +
              '[aria-label*="Write something" i], ' +
              '[aria-placeholder*="Write something" i]',
            )) || hasEnglishGroupComposerTrigger()
          ),
        isProfileTarget ? POSTING_TIMING.facebookTabReadyTimeoutMs : POSTING_TIMING.groupPageReadyTimeoutMs,
      );
      if (!pageReady) {
        throw new Error(isProfileTarget
          ? 'The expected Facebook profile feed was not ready'
          : 'The Facebook group composer was not ready');
      }
      recordPostingStep(jobId, isProfileTarget ? 'profile_composer_surface_ready' : 'group_composer_surface_ready', {
        hasMain: Boolean(document.querySelector('[role="main"]')),
      });

      // Facebook places the composer in `data-pagelet="GroupInlineComposer"`
      // which is often a SIBLING to the actual feed (`data-pagelet="GroupFeed"`).
      // We must search a broader container like `role="main"` to ensure we see both.
      const searchRoot: Element =
        document.querySelector('[role="main"]') ??
        document.body;

      console.log('[PostFlow] Search root found:', searchRoot.tagName, searchRoot.getAttribute('role'));

      let composerTrigger: HTMLElement | null = isProfileTarget
        ? await waitForValue(() => findProfileComposerTrigger(), POSTING_TIMING.facebookTabReadyTimeoutMs)
        : null;

      if (!isProfileTarget) {
      // Method 0: The most direct and reliable Facebook selector (GroupInlineComposer)
      const inlineComposer = document.querySelector('[data-pagelet="GroupInlineComposer"]');
      if (inlineComposer) {
        // Find the first button inside it
        const btn = inlineComposer.querySelector<HTMLElement>('[role="button"], button, [tabindex="0"]');
        if (btn) {
          composerTrigger = btn;
          console.log('[PostFlow] Found composer via GroupInlineComposer data-pagelet');
        }
      }

      // Known placeholder texts Facebook uses in the composer trigger span
      const COMPOSER_TEXTS = [
        'اكتب شيئًا',   // Arabic (exact prefix from real FB HTML)
        'اكتب شيئ',     // Arabic variant without diacritics
        'ما الذي يدور', // Arabic "what's on your mind"
        'write something',
        "what's on your mind",
        'create a post',
        'écrivez quelque chose',
        'was möchtest du',
      ];

      /** True if `el` is nested inside a post card (role="article").
       *  The real composer trigger is ABOVE all posts, never inside one. */
      function isInsideArticle(el: HTMLElement): boolean {
        let cur: HTMLElement | null = el.parentElement;
        while (cur && cur !== searchRoot) {
          if (cur.getAttribute('role') === 'article') return true;
          cur = cur.parentElement;
        }
        return false;
      }

      function textMatchesComposer(el: HTMLElement): boolean {
        const text = (el.textContent ?? '').trim();
        if (text.length < 2 || text.length > 120) return false;
        const lower = text.toLowerCase();
        return COMPOSER_TEXTS.some(t => lower.includes(t.toLowerCase()));
      }

      // Method A: Find a span with the placeholder text, then walk UP to its
      // closest role="button" parent — this is exactly what Facebook renders.
      // Skip any span that lives inside a post card (role="article").
      const allSpans = Array.from(searchRoot.querySelectorAll<HTMLElement>('span'));
      for (const span of allSpans) {
        if (textMatchesComposer(span) && !isInsideArticle(span)) {
          // Walk up to find the clickable role="button" ancestor
          let el: HTMLElement | null = span;
          while (el && el !== searchRoot) {
            if (el.getAttribute('role') === 'button') {
              composerTrigger = el;
              console.log('[PostFlow] Found composer via span→button walk:', span.textContent?.trim().substring(0, 40));
              break;
            }
            el = el.parentElement;
          }
          if (composerTrigger) break;
        }
      }

      // Method B: aria-placeholder / aria-label on the element itself
      if (!composerTrigger) {
        const candidate = searchRoot.querySelector<HTMLElement>(
          '[aria-placeholder], [aria-label*="Create" i], [aria-label*="Write" i]' /* +
          '[aria-label*="What\\'s on your mind" i], [aria-label*="اكتب"]'
        */
        );
        if (candidate && !isInsideArticle(candidate)) {
          composerTrigger = candidate;
          console.log('[PostFlow] Found composer via aria attribute:', composerTrigger.getAttribute('aria-placeholder') ?? composerTrigger.getAttribute('aria-label'));
        }
      }

      // Method C: Last resort — any role="button" whose textContent matches,
      // but NOT inside a post article.
      if (!composerTrigger) {
        const roleButtons = Array.from(searchRoot.querySelectorAll<HTMLElement>('div[role="button"]'));
        for (const btn of roleButtons) {
          if (textMatchesComposer(btn) && !isInsideArticle(btn)) {
            composerTrigger = btn;
            console.log('[PostFlow] Found composer via role=button text match:', btn.textContent?.trim().substring(0, 40));
            break;
          }
        }
      }
      }

      if (!composerTrigger) {
        throw new Error(
          isProfileTarget
            ? 'Could not find the post composer on the expected Facebook profile feed.'
            : 'Could not find the post composer on this group page. Make sure the page has loaded.',
        );
      }

      const composerTriggerText = (
        (composerTrigger as HTMLElement).innerText ||
        composerTrigger.textContent ||
        ''
      )
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const isEnglishGroupComposerFlow = !isProfileTarget && [
        'write something',
        "what's on your mind",
        'create a post',
      ].some((phrase) => composerTriggerText.includes(phrase));
      activeJobUsesEnglishGroupFlow = isEnglishGroupComposerFlow;

      recordPostingStep(jobId, 'composer_trigger_found', {
        tag: composerTrigger.tagName,
        role: composerTrigger.getAttribute('role'),
        label: composerTrigger.getAttribute('aria-label'),
        text: composerTrigger.textContent?.trim().slice(0, 80),
        isEnglishGroupComposerFlow,
      });

      console.log('[PostFlow] Clicking composer trigger:', composerTrigger.getAttribute('aria-label') ?? composerTrigger.textContent?.substring(0, 40));
      clickLikeUser(composerTrigger);
      await sleep(POSTING_TIMING.composerOpenDelayMs);
      if (!isTargetDestinationRoot()) {
        throw new Error(`Facebook navigated away from the target destination before opening the composer: ${location.href}`);
      }
      recordPostingStep(jobId, 'composer_trigger_clicked', {
        dialogs: document.querySelectorAll('div[role="dialog"], [aria-modal="true"]').length,
      });

      // Facebook sometimes shows an intermediate "What do you want to create?" modal
      // with options: Post, Photo/Video, etc. We need to click "Post/Text" in that case.
      // Use .includes() not === because FB adds extra text like "منشور مجهول الهوية"
      const visibleDialogs = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"], [aria-modal="true"]')).filter((candidate) => {
        if (candidate.hidden || candidate.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(candidate);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
      const interimDialog = visibleDialogs.length ? visibleDialogs[visibleDialogs.length - 1] : null;
      if (interimDialog && !interimDialog.querySelector('[contenteditable="true"], [role="textbox"], textarea')) {
        recordPostingStep(jobId, 'intermediate_dialog_detected', {
          text: interimDialog.innerText?.trim().slice(0, 120),
        });
        console.log('[PostFlow] Intermediate modal detected, looking for Text/Post option...');
        const optionButtons = Array.from(interimDialog.querySelectorAll<HTMLElement>('[role="button"], button, [tabindex="0"]'));
        const textOption = optionButtons.find(el => {
          const txt   = (el.textContent ?? '').trim().toLowerCase();
          const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase();
          const combined = txt + ' ' + label;
          // Match any button whose text/label contains a known "post" keyword
          return ['post', 'منشور', 'text', 'نص', 'write'].some(kw => combined.includes(kw));
        });
        if (textOption) {
          console.log('[PostFlow] Clicking Post/Text option in intermediate modal:', textOption.textContent?.trim().substring(0, 30));
          textOption.click();
          await sleep(POSTING_TIMING.intermediateComposerOptionDelayMs);
          if (!isTargetDestinationRoot()) {
            throw new Error(`Facebook intermediate Post option navigated to a different destination: ${location.href}`);
          }
          recordPostingStep(jobId, 'intermediate_post_option_clicked', {
            text: textOption.textContent?.trim().slice(0, 80),
          });
        } else {
          console.log('[PostFlow] No Post/Text option found in intermediate modal; proceeding to composer detection');
          recordPostingStep(jobId, 'intermediate_post_option_missing');
        }
      }

      // 2. Wait for the actual editor. Facebook has used both a modal dialog and
      // an inline composer for this flow. Do not require role="dialog": the
      // GroupInlineComposer markup in some locales stays on the group page.
      console.log('[PostFlow] Waiting for create-post editor...');
      let dialog = await waitForCreatePostDialog(POSTING_TIMING.createPostDialogTimeoutMs, isProfileTarget);
      if (!dialog) {
        console.warn('[PostFlow] Create-post editor not found after first click; retrying composer trigger once');
        recordPostingStep(jobId, 'editor_surface_retrying_click');
        clickLikeUser(composerTrigger);
        await sleep(POSTING_TIMING.composerOpenDelayMs);
        dialog = await waitForCreatePostDialog(Math.floor(POSTING_TIMING.createPostDialogTimeoutMs / 2), isProfileTarget);
      }

      if (!dialog) {
        throw new Error(`Facebook create-post editor did not appear within ${Math.round(POSTING_TIMING.createPostDialogTimeoutMs / 1000)}s`);
      }
      recordPostingStep(jobId, 'editor_surface_found', {
        isDialog: dialog.getAttribute('role') === 'dialog' || dialog.getAttribute('aria-modal') === 'true',
        contenteditables: dialog.querySelectorAll('[contenteditable="true"]').length,
      });
      console.log('[PostFlow] Create Post dialog found');

      // The editor is the contenteditable we already confirmed exists in the dialog
      const editorSelectors = [
        'div[data-lexical-editor="true"]',
        'div[role="textbox"][contenteditable="true"]',
        '[role="textbox"]',
        'div[contenteditable="true"][tabindex="0"]',
        'div[contenteditable="true"]',
        'textarea',
      ];

      let editor: Element | null = null;
      if (isProfileTarget) {
        editor = Array.from(dialog.querySelectorAll<HTMLElement>(editorSelectors.join(', ')))
          .find((candidate) =>
            isVisibleProfileComposerElement(candidate) &&
            profileComposerTextMatches(candidate)
          ) ?? null;
        if (editor) console.log('[PostFlow] Found profile create-post editor inside modal dialog');
      } else {
        for (const sel of editorSelectors) {
          editor = dialog.querySelector(sel);
          if (editor) {
            console.log('[PostFlow] Found editor inside dialog with selector:', sel);
            break;
          }
        }
      }

      if (!editor) {
        throw new Error('Could not find the text editor inside the Create Post dialog');
      }

      // In the supplied English Group DOM, the labelled "Create post" dialog
      // is a header sibling rather than an ancestor of the editor. The editor
      // belongs to the outer aria-modal dialog.
      const facebookDocumentLocale = document.documentElement.lang.trim().toLowerCase();
      const englishEditorPlaceholder = (editor.getAttribute('aria-placeholder') ?? '').toLowerCase();
      const hasEnglishCreatePostSurface = Boolean(
        document.querySelector('[role="dialog"][aria-label="Create post"]'),
      );
      // Only the user-visible trigger selects the English-specific DOM path.
      // Facebook can expose English document/accessibility metadata while its
      // visible UI is Arabic, so those signals are diagnostics only. Letting
      // them activate this branch changes the previously reliable Arabic
      // editor, media, submit, and video-result behavior.
      const isEnglishGroupEditor = isEnglishGroupComposerFlow;
      const isEnglishProfileEditor = isProfileTarget &&
        englishEditorPlaceholder.includes("what's on your mind") &&
        dialog.getAttribute('aria-modal') === 'true';
      let englishGroupComposerResolution = 'not_english';
      let englishGroupComposerDialog = isEnglishGroupEditor
        ? editor.closest<HTMLElement>('[role="dialog"][aria-modal="true"]')
        : null;
      if (englishGroupComposerDialog) englishGroupComposerResolution = 'editor_ancestor';

      if (isEnglishGroupEditor && !englishGroupComposerDialog) {
        englishGroupComposerDialog = await waitForValue(() => (
          Array.from(
            document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
          ).find((candidate) => {
            if (candidate.hidden || candidate.getAttribute('aria-hidden') === 'true') return false;
            const style = window.getComputedStyle(candidate);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            return Boolean(
              candidate.querySelector('[data-lexical-editor="true"][contenteditable="true"]') &&
              candidate.querySelector('[aria-label="Post"]'),
            );
          }) ?? null
        ), POSTING_TIMING.createPostDialogTimeoutMs);

        const modalEditor = englishGroupComposerDialog?.querySelector<HTMLElement>(
          '[data-lexical-editor="true"][contenteditable="true"]',
        );
        if (modalEditor) {
          editor = modalEditor;
          englishGroupComposerResolution = 'visible_modal_controls';
        }
      }
      if (isEnglishGroupEditor && !englishGroupComposerDialog) {
        throw new Error('Could not resolve the English Create post dialog from its editor');
      }
      const englishComposerSurface = englishGroupComposerDialog ??
        (isEnglishProfileEditor ? dialog as HTMLElement : null);

      recordPostingStep(jobId, 'editor_found', {
        selector: editor.getAttribute('data-lexical-editor') === 'true' ? 'data-lexical-editor' : editor.tagName,
        role: editor.getAttribute('role'),
        facebookDocumentLocale: facebookDocumentLocale || 'unknown',
        englishEditorPlaceholder: englishEditorPlaceholder || undefined,
        hasEnglishCreatePostSurface,
        isEnglishGroupEditor,
        isEnglishProfileEditor,
        englishGroupComposerDialog: Boolean(englishGroupComposerDialog),
        englishComposerScoped: Boolean(englishComposerSurface),
        englishGroupComposerResolution,
      });

      console.log('[PostFlow] Focusing editor and injecting text...');
      const editorEl = editor as HTMLElement;

      // Step 1: Bring editor into view and give it user-like focus
      editorEl.scrollIntoView({ behavior: 'auto', block: 'center' });
      await sleep(POSTING_TIMING.editorScrollDelayMs);
      editorEl.focus();
      await sleep(POSTING_TIMING.editorFocusDelayMs);
      // Dispatch a real mousedown+mouseup to convince Lexical we interacted
      editorEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      editorEl.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
      editorEl.click();
      await sleep(POSTING_TIMING.editorClickDelayMs);

      // Step 2: Place the text cursor at the END of the editor content
      //         execCommand('insertText') only works when a Selection exists inside the element.
      const placeCaret = () => {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          const englishManagedLineBreak = englishComposerSurface
            ? editorEl.querySelector('br[data-lexical-managed-linebreak="true"]')
            : null;

          if (englishManagedLineBreak?.parentNode) {
            // The supplied English Lexical DOM starts with <p><br ...></p>.
            // Insert inside that paragraph so Lexical accepts the mutation;
            // inserting after the paragraph creates transient DOM that Lexical
            // removes without enabling the Post button.
            range.setStartBefore(englishManagedLineBreak);
            range.collapse(true);
          } else {
            // Preserve the existing caret behavior for Arabic and other
            // composer variants that do not use the supplied English shape.
            range.selectNodeContents(editorEl);
            range.collapse(false); // false = collapse to end
          }
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch {
          // Ignore if selection can't be set (e.g. inside shadow DOM)
        }
      };
      placeCaret();
      await sleep(POSTING_TIMING.editorCaretDelayMs);

      // Step 3a: execCommand — fires the correct synthetic InputEvent that Lexical handles
      let execResult = document.execCommand('insertText', false, post.content);
      console.log('[PostFlow] execCommand insertText result:', execResult);
      await sleep(POSTING_TIMING.textInsertDelayMs);

      const textAfterExec = editorEl.textContent ?? '';
      console.log('[PostFlow] Editor text after execCommand:', textAfterExec.substring(0, 50));
      recordPostingStep(jobId, 'text_insert_attempted', {
        execResult,
        textLength: textAfterExec.length,
        caretTarget: englishComposerSurface ? 'english_lexical_paragraph' : 'editor_root',
        englishPostButtonDisabled: englishComposerSurface
          ? englishComposerSurface
            .querySelector('[aria-label="Post"]')
            ?.getAttribute('aria-disabled') === 'true'
          : undefined,
      });

      if (!textAfterExec.trim()) {
        console.log('[PostFlow] execCommand did not work, trying keyboard simulation...');

        // Step 3b: Keyboard simulation — type character by character
        // This is guaranteed to work with React/Lexical because it mirrors real user input.
        placeCaret();
        await sleep(POSTING_TIMING.editorCaretDelayMs);

        for (const char of post.content) {
          editorEl.dispatchEvent(new KeyboardEvent('keydown',  { key: char, bubbles: true }));
          // beforeinput is what Lexical actually listens to
          editorEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char,
          }));
          editorEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char,
          }));
          editorEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        await sleep(POSTING_TIMING.keyboardFallbackDelayMs);
        console.log('[PostFlow] Editor text after keyboard sim:', (editorEl.textContent ?? '').substring(0, 50));
        recordPostingStep(jobId, 'keyboard_fallback_finished', { textLength: (editorEl.textContent ?? '').length });
      }

      if (!(editorEl.textContent ?? '').trim() && !hasMedia) {
        throw new Error('Failed to inject text into Facebook composer — all strategies failed');
      }

      if (hasMedia) {
        const mediaComposerSurface = englishComposerSurface ?? dialog;
        recordPostingStep(jobId, 'media_attach_started', {
          mediaCount: mediaUrls.length,
          englishComposerScoped: Boolean(englishComposerSurface),
        });
        await attachMediaToDialog(
          mediaComposerSurface,
          mediaUrls,
          Boolean(englishComposerSurface),
        );
        recordPostingStep(jobId, 'media_attach_finished', { mediaCount: mediaUrls.length });
      }

      console.log('[PostFlow] Text injected successfully, waiting for Post button to enable...');

      // 3. Find the Post / Submit button — search inside the dialog we already found
      const dialogSearchRoot = englishComposerSurface ?? dialog;

      // Try multiple labels since Facebook localizes these strings
      const postButtonSelectors = [
        '[aria-label="Post"]',
        '[aria-label="نشر"]',       // Arabic
        '[aria-label="Publier"]',   // French
        '[aria-label="Postar"]',    // Portuguese
        'div[role="button"][tabindex="0"]',
      ];

      const findPostButton = () => {
        const exactEnglishPostButton = englishComposerSurface
          ? dialogSearchRoot.querySelector<HTMLElement>('[aria-label="Post"]')
          : null;
        if (exactEnglishPostButton) {
          if (exactEnglishPostButton.getAttribute('aria-disabled') === 'true') return null;

          const style = window.getComputedStyle(exactEnglishPostButton);
          if (
            exactEnglishPostButton.hidden ||
            exactEnglishPostButton.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) return null;

          console.log('[PostFlow] Found exact English Post button inside Create post dialog');
          return exactEnglishPostButton;
        }

        for (const sel of postButtonSelectors) {
          const candidates = Array.from(dialogSearchRoot.querySelectorAll(sel));
          const enabled = candidates.find(el =>
            el.getAttribute('aria-disabled') !== 'true' &&
            el.textContent &&
            el.textContent.trim().length > 0 &&
            el.textContent.trim().length < 20
          );
          if (enabled) {
            console.log('[PostFlow] Found post button with selector:', sel, 'text:', enabled.textContent?.trim());
            return enabled;
          }
        }
        return null;
      };

      const postButton = await waitForValue(findPostButton, POSTING_TIMING.postButtonEnableTimeoutMs);

      if (!postButton) {
        throw new Error('Could not find the Post button — the text may not have registered in the editor');
      }

      recordPostingStep(jobId, 'post_button_found', {
        text: postButton.textContent?.trim().slice(0, 80),
        ariaLabel: postButton.getAttribute('aria-label'),
      });

      if (isProfileTarget) {
        const profileTarget = target as ProfileFeedTarget;
        const existingProfilePostElements = new Set<Element>([
          ...document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"]'),
        ]);
        const existingProfilePostUrls = new Set(
          Array.from(existingProfilePostElements)
            .map((element) => getProfilePostPermalink(element, profileTarget.facebookUserId, true))
            .filter((url): url is string => Boolean(url))
            .map((url) => url.replace(/\/$/, '').toLowerCase()),
        );
        const existingProfileConfirmationSurfaceText = new Map(
          Array.from(document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"], [aria-live]'))
            .map((element) => [element, `${element.innerText ?? element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`]),
        );
        const profileTrackingSession = createProfilePublishTrackingSession({
          jobId,
          facebookUserId: profileTarget.facebookUserId,
          submittedAt: Date.now(),
          existingPostUrls: existingProfilePostUrls,
        });
        activeProfileTrackingSession = profileTrackingSession;

        const latestJob = await chrome.runtime.sendMessage({
          type: 'GET_JOB_STATUS',
          jobId,
        }).catch(() => null);
        if (latestJob?.job?.status === 'CANCEL_REQUESTED') {
          recordPostingStep(jobId, 'job_canceled_before_final_submit');
          const cancelError = new Error('Canceled before clicking Facebook Post');
          cancelError.name = 'PostFlowJobCanceled';
          throw cancelError;
        }

        const identity = await chrome.runtime.sendMessage({
          type: 'VERIFY_EXECUTION_IDENTITY',
          jobId,
        }).catch(() => null);
        if (!identity?.verified || !isExpectedProfileFeed(target as ProfileFeedTarget)) {
          const mismatchError = new Error('Facebook account or profile feed no longer matches the publishing target');
          mismatchError.name = 'PostFlowAccountMismatch';
          throw mismatchError;
        }

        profileTrackingSession.acceptCandidatesAfter = Date.now();
        (postButton as HTMLElement).click();
        console.log('[PostFlow] Profile Post button clicked; waiting for explicit confirmation...');
        recordPostingStep(jobId, 'post_button_clicked', { targetType: target.type });
        const submissionResult = await waitForProfileSubmissionResult({
          jobId,
          root: document,
          dialog,
          hasVideo,
          expectedFacebookUserId: profileTarget.facebookUserId,
          submittedText: typeof post.content === 'string' ? post.content : '',
          submittedAt: profileTrackingSession.submittedAt,
          existingPostElements: existingProfilePostElements,
          existingPostUrls: existingProfilePostUrls,
          submittedMediaCount: mediaUrls.length,
          trackingSession: profileTrackingSession,
          existingConfirmationSurfaceText: existingProfileConfirmationSurfaceText,
          notificationBaselineIdentities: profileVideoNotificationBaselineKeys
            ? new Set(profileVideoNotificationBaselineKeys)
            : null,
          timeout: hasVideo
            ? POSTING_TIMING.profileVideoPermalinkTimeoutMs
            : POSTING_TIMING.publishConfirmationTimeoutMs,
          interval: POSTING_TIMING.publishPollIntervalMs,
        });
        if (!('postUrl' in submissionResult) || !submissionResult.postUrl) {
          const diagnostics = getProfilePostUrlDiagnostics(document);
          recordPostingStep(jobId, 'profile_post_url_not_found', {
            articleCount: diagnostics.articleCount,
            anchorCount: diagnostics.anchorCount,
            candidatePathSamples: diagnostics.candidatePathSamples,
            existingPostUrlCount: existingProfilePostUrls.size,
            networkCandidates: profileTrackingSession.candidates.length,
          });
        }
        recordPostingStep(jobId, 'submission_result_detected', {
          targetType: target.type,
          status: submissionResult.status,
          postUrl: 'postUrl' in submissionResult ? submissionResult.postUrl : undefined,
          reason: 'reason' in submissionResult ? submissionResult.reason : undefined,
          networkCandidates: profileTrackingSession.candidates.length,
        });
        resolve(submissionResult);
        return;
      }

      const existingPostElements = new Set<Element>([
        ...document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"]'),
      ]);
      const existingPostUrls = new Set(
        Array.from(existingPostElements)
          .map((element) => extractPostPermalink(element, currentGroupId))
          .filter((url): url is string => Boolean(url))
          .map((url) => normalizeTrackedPostUrl(url) ?? url.replace(/\/$/, '').toLowerCase()),
      );
      const submittedAt = Date.now();
      const initialPageUrl = location.href;
      const trackingSession = createPublishTrackingSession({
        jobId,
        groupId: currentGroupId,
        submittedAt,
        hasVideo,
        existingPostUrls,
      });
      activePublishTrackingSession = trackingSession;

      const latestJob = await chrome.runtime.sendMessage({
        type: 'GET_JOB_STATUS',
        jobId,
      }).catch(() => null);
      if (latestJob?.job?.status === 'CANCEL_REQUESTED') {
        recordPostingStep(jobId, 'job_canceled_before_final_submit');
        const cancelError = new Error('Canceled before clicking Facebook Post');
        cancelError.name = 'PostFlowJobCanceled';
        throw cancelError;
      }

      trackingSession.acceptCandidatesAfter = Date.now();
      (postButton as HTMLElement).click();
      console.log('[PostFlow] Post button clicked, waiting for publish confirmation...');
      recordPostingStep(jobId, 'post_button_clicked');

      // 4. Track the result separately from posting failures.
      const publishSuccessCues = [
        'your post is now published',
        'your post has been published',
        'post published',
        'published',
        '\u062a\u0645 \u0646\u0634\u0631',
        '\u062a\u0645 \u0646\u0634\u0631 \u0645\u0646\u0634\u0648\u0631\u0643',
        '\u062a\u0645 \u0646\u0634\u0631 \u0627\u0644\u0645\u0646\u0634\u0648\u0631',
        'تم نشر',
        'تم نشر منشورك',
      ];

      const publishErrorCues = [
        'something went wrong',
        "couldn't post",
        'could not post',
        'unable to post',
        'failed to publish',
        'post could not be shared',
        'try again later',
        'حدث خطأ',
        'تعذر النشر',
        'فشل النشر',
      ];

      const hasCue = (texts: string[], source: string) => {
        const lower = source.toLowerCase();
        return texts.some((text) => lower.includes(text.toLowerCase()));
      };
      const getVisibleText = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return '';
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return '';
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return '';
        return [
          element.innerText ?? element.textContent ?? '',
          element.getAttribute('aria-label') ?? '',
          element.getAttribute('title') ?? '',
        ].join(' ');
      };
      const videoProcessingCues = [
        'processing your video',
        'your video is being processed',
        'we are processing the video',
        'we\'re processing the video',
        'جارٍ معالجة الفيديو',
        'تجري الآن معالجة الفيديو',
        ...(isEnglishGroupEditor ? [
          'the video in your post is being processed',
          'dismiss inline feed notice about video processing',
        ] : []),
      ];
      const isVideoProcessingVisible = () => {
        if (!hasVideo) return false;
        const pageText = (document.body.innerText ?? '').toLowerCase();
        return videoProcessingCues.some((cue) => pageText.includes(cue.toLowerCase()));
      };
      const getPublishSuccessEvidence = () => {
        // This is an intermediate confirmation. Do not finish the job until
        // Facebook renders the submitted post/permalink or the longer video
        // polling window expires.
        if (isVideoProcessingVisible()) return 'Facebook accepted the video and is processing it';
        const semanticSurfaces = Array.from(document.querySelectorAll(
          '[role="alert"], [role="status"], [aria-live], [data-visualcompletion="ignore-dynamic"]',
        ));
        const surfaceText = semanticSurfaces.map(getVisibleText).join('\n');
        if (hasCue(publishSuccessCues, surfaceText)) return 'Facebook showed a publish success message';

        const dialogGone = !document.body.contains(dialog);
        const editorGone = dialogGone || !dialog.querySelector('[contenteditable="true"], [role="textbox"], textarea');
        const buttonGone = dialogGone || !dialog.contains(postButton);
        if (dialogGone || (editorGone && buttonGone)) {
          const pageText = document.body.innerText ?? '';
          if (hasCue(publishSuccessCues, pageText)) return 'Facebook closed the composer after a publish success message';
          return 'Facebook accepted the composer after the Post click';
        }
        return null;
      };

      const submissionResult = await waitForPostSubmissionResult({
        root: document,
        submittedText: post.content ?? '',
        submittedAt,
        timeout: hasVideo
          ? POSTING_TIMING.videoPublishConfirmationTimeoutMs
          : POSTING_TIMING.publishConfirmationTimeoutMs,
        interval: POSTING_TIMING.publishPollIntervalMs,
        existingPostElements,
        existingPostUrls,
        submittedMediaCount: mediaUrls.length,
        currentGroupId,
        initialPageUrl,
        getInterruption: () => detectFacebookPublishingInterruption({
          root: document,
          hasVideo,
          activeComposer: document.body.contains(dialog) ? dialog : null,
          initialPageUrl,
        }),
        getFailureReason: () => {
          const dialogText = document.body.contains(dialog) ? ((dialog as HTMLElement).innerText ?? '') : '';
          const pageText = (document.body.innerText ?? '').toLowerCase();
          return hasCue(publishErrorCues, `${dialogText}\n${pageText}`)
            ? 'Facebook rejected the post after clicking Post'
            : null;
        },
        getSuccessEvidence: getPublishSuccessEvidence,
        getPendingPostUrl: () => getBestNetworkPendingPostUrl(trackingSession),
        getNetworkPostUrl: () => getBestNetworkPostUrl(trackingSession),
        onStateChange: (status, details = {}) => {
          recordPostingStep(jobId, 'publish_state_changed', {
            status,
            detector: typeof details.detector === 'string' ? details.detector : undefined,
            source: typeof details.source === 'string' ? details.source : undefined,
            shouldPauseQueue: typeof details.shouldPauseQueue === 'boolean' ? details.shouldPauseQueue : undefined,
          });
        },
        onDiagnostic: (step, details = {}) => {
          recordPostingStep(jobId, step, details);
        },
      });

      recordPostingStep(jobId, 'submission_result_detected', {
        status: submissionResult.status,
        postUrl: 'postUrl' in submissionResult ? submissionResult.postUrl : undefined,
        reason: 'reason' in submissionResult ? submissionResult.reason : undefined,
        detector: 'detector' in submissionResult ? submissionResult.detector : undefined,
        shouldPauseQueue: 'shouldPauseQueue' in submissionResult ? submissionResult.shouldPauseQueue : undefined,
        networkCandidates: trackingSession.candidates.length,
        videoIds: trackingSession.mediaVideoIds.size,
        uploadSessionIds: trackingSession.uploadSessionIds.size,
      });
      console.log('[PostTracking] Publish tracking session ended', {
        jobId,
        status: submissionResult.status,
        postUrl: 'postUrl' in submissionResult ? submissionResult.postUrl : undefined,
        networkCandidates: trackingSession.candidates.length,
        videoIds: Array.from(trackingSession.mediaVideoIds),
        uploadSessionIds: Array.from(trackingSession.uploadSessionIds),
      });
      activeJobPublishedVideoIds = Array.from(trackingSession.mediaVideoIds);
      if (activePublishTrackingSession === trackingSession) activePublishTrackingSession = null;
      resolve(submissionResult);
      return;

      /* const publishStartedAt = Date.now();
      while (Date.now() - publishStartedAt < POSTING_TIMING.publishConfirmationTimeoutMs) {
        await sleep(POSTING_TIMING.publishPollIntervalMs);

        const dialogStillOpen = document.body.contains(dialog);
        const editorStillOpen = dialogStillOpen && dialog.querySelector('div[contenteditable="true"]');
        const buttonStillEnabled = dialogStillOpen && findPostButton();
        const pageText = (document.body.innerText ?? '').toLowerCase();
        const hasPublishCue = hasCue(publishSuccessCues, pageText) || [
          'your post is now published',
          'your post has been published',
          'post published',
          'تم نشر',
          'تم نشر منشورك',
        ].some((text) => pageText.includes(text.toLowerCase()));
        const dialogText = dialogStillOpen ? ((dialog as HTMLElement).innerText ?? '') : '';
        const hasPublishError = hasCue(publishErrorCues, `${dialogText}\n${pageText}`);

        if (hasPublishError) {
          recordPostingStep(jobId, 'publish_error_detected', { text: `${dialogText}\n${pageText}`.slice(0, 300) });
          throw new Error('Facebook rejected the post after clicking Post');
        }

        if (!dialogStillOpen || hasPublishCue || (!editorStillOpen && !buttonStillEnabled)) {
          console.log('[PostFlow] Publish accepted — post successful!');
          recordPostingStep(jobId, 'publish_confirmed', { hasPublishCue, dialogStillOpen });
          resolve();
          return;
        }
      }

      console.log('[PostFlow] No Facebook error after clicking Post - treating publish as accepted');
      recordPostingStep(jobId, 'publish_confirmation_timeout_accepted');
      resolve();
      return; */

    } catch (err: any) {
      recordPostingStep(jobId, 'job_failed_in_content_script', { error: err?.message ?? String(err) });
      reject(err);
    } finally {
      if (activeJobId === jobId) {
        activePublishTrackingSession = null;
        activeProfileTrackingSession = null;
      }
      isExecutingJob = false;
      activeJobId = null;
    }
  });
}

// Prefer a verified profile permalink. Video publishes may finish without one,
// so a closed composer is retained as acceptance evidence while the full video
// confirmation window continues looking for stronger proof.
async function waitForProfileSubmissionResult(options: {
  jobId: string;
  root: ParentNode;
  dialog: Element;
  hasVideo: boolean;
  expectedFacebookUserId: string;
  submittedText: string;
  submittedAt: number;
  existingPostElements: ReadonlySet<Element>;
  existingPostUrls: ReadonlySet<string>;
  submittedMediaCount: number;
  trackingSession: ProfilePublishTrackingSession;
  existingConfirmationSurfaceText: ReadonlyMap<Element, string>;
  notificationBaselineIdentities: ReadonlySet<string> | null;
  timeout: number;
  interval: number;
}): Promise<FacebookPostSubmissionResult> {
  const startedAt = Date.now();
  let acceptedVideoEvidence: string | null = null;
  let acceptedVideoPersisted = false;
  let lastTrackingHeartbeatAt = 0;
  const successCues = [
    'your post is now published',
    'your post has been published',
    'post published',
    '\u062a\u0645 \u0646\u0634\u0631',
    'ØªÙ… Ù†Ø´Ø±',
  ];
  const failureCues = [
    'something went wrong',
    "couldn't post",
    'could not post',
    'unable to post',
    'failed to publish',
    'Ø­Ø¯Ø« Ø®Ø·Ø£',
    'ØªØ¹Ø°Ø± Ø§Ù„Ù†Ø´Ø±',
  ];

  while (Date.now() - startedAt < options.timeout) {
    if (Date.now() - lastTrackingHeartbeatAt >= 10000) {
      lastTrackingHeartbeatAt = Date.now();
      await chrome.runtime.sendMessage({
        type: 'PROFILE_VIDEO_TRACKING_HEARTBEAT',
        jobId: options.jobId,
      }).catch(() => null);
    }

    const interruption = detectFacebookPublishingInterruption({
      root: options.root,
      hasVideo: options.hasVideo,
      activeComposer: document.body.contains(options.dialog) ? options.dialog : null,
    });
    if (interruption) {
      return {
        status: interruption.status,
        reason: interruption.reason,
        source: interruption.source,
        detector: interruption.detector,
        shouldPauseQueue: interruption.shouldPauseQueue,
      };
    }

    if (options.hasVideo && options.notificationBaselineIdentities) {
      const processedNotification = findNewProcessedProfileVideoNotification(
        options.root,
        options.notificationBaselineIdentities,
      );
      if (processedNotification) {
        recordPostingStep(options.jobId, 'profile_video_notification_detected_on_page', {
          postUrl: processedNotification.postUrl,
          notificationId: processedNotification.notificationId ?? null,
        });
        return { status: 'PUBLISHED', postUrl: processedNotification.postUrl };
      }
    }

    acceptedVideoEvidence = acceptedVideoEvidence ??
      getAcceptedProfileVideoEvidence(options.dialog, options.hasVideo);
    if (acceptedVideoEvidence && !acceptedVideoPersisted) {
      const acceptance = await chrome.runtime.sendMessage({
        type: 'PROFILE_VIDEO_PUBLISH_ACCEPTED',
        jobId: options.jobId,
      }).catch(() => null);
      acceptedVideoPersisted = acceptance?.ok === true;
      if (acceptedVideoPersisted) {
        recordPostingStep(options.jobId, 'profile_video_publish_accepted_persisted');
      }
    }

    const publishedProfilePost = findPublishedProfilePost({
      root: options.root,
      expectedFacebookUserId: options.expectedFacebookUserId,
      submittedText: options.submittedText,
      submittedAt: options.submittedAt,
      existingPostElements: options.existingPostElements,
      existingPostUrls: options.existingPostUrls,
      submittedMediaCount: options.submittedMediaCount,
      allowUndatedMedia: Boolean(acceptedVideoEvidence),
    });
    if (publishedProfilePost) {
      return { status: 'PUBLISHED', postUrl: publishedProfilePost.postUrl };
    }

    const networkPostUrl = getBestProfileNetworkPostUrl(options.trackingSession);
    if (networkPostUrl) return { status: 'PUBLISHED', postUrl: networkPostUrl };

    const currentPagePostUrl = normalizeFacebookProfilePostUrl(
      window.location.href,
      options.expectedFacebookUserId,
    );
    if (currentPagePostUrl) return { status: 'PUBLISHED', postUrl: currentPagePostUrl };

    const visibleSurfaces = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="alert"], [role="status"], [aria-live]',
    )).filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden && element.getAttribute('aria-hidden') !== 'true' &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
    const visibleText = visibleSurfaces
      .filter((element) => {
        const currentText = `${element.innerText ?? element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`;
        return options.existingConfirmationSurfaceText.get(element) !== currentText;
      })
      .map((element) => `${element.innerText ?? element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`)
      .join(' ')
      .toLowerCase();
    if (successCues.some((cue) => visibleText.includes(cue.toLowerCase()))) {
      return { status: 'PUBLISHED' };
    }
    if (failureCues.some((cue) => visibleText.includes(cue.toLowerCase()))) {
      return {
        status: 'UNKNOWN',
        reason: 'Facebook rejected the profile post after clicking Post',
      };
    }
    await sleep(options.interval);
  }

  if (acceptedVideoEvidence) {
    return {
      status: 'PUBLISHED',
    };
  }

  return {
    status: 'UNKNOWN',
    reason: 'Facebook accepted the profile composer without reliable publication evidence',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function clickLikeUser(element: HTMLElement) {
  element.scrollIntoView({ behavior: 'auto', block: 'center' });
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.click();
}

function dataUrlToFile(dataUrl: string, index: number): File {
  const match = dataUrl.match(/^data:((?:image|video)\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!match) {
    throw new Error('Unsupported media format');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  return new File([bytes], `postflow-media-${index + 1}.${extension}`, { type: mimeType });
}

async function attachMediaToDialog(
  dialog: Element,
  mediaUrls: string[],
  restrictToEnglishComposer = false,
) {
  console.log(`[PostFlow] Attaching ${mediaUrls.length} media file(s)`);

  const mediaFiles = mediaUrls.map((url, index) => dataUrlToFile(url, index));
  const transfer = new DataTransfer();
  mediaFiles.forEach((file) => transfer.items.add(file));

  const initialImages = new Set(dialog.querySelectorAll('img'));
  const initialVideos = new Set(dialog.querySelectorAll('video'));

  const findEnglishComposerFileInput = () => {
    if (!restrictToEnglishComposer) return null;
    const mediaControl = dialog.querySelector<HTMLElement>('[aria-label="Photo/video"]');
    let container = mediaControl?.parentElement ?? null;
    while (container && container !== dialog) {
      const directInput = Array.from(container.children).find((child) =>
        child instanceof HTMLInputElement && child.type === 'file'
      );
      if (directInput instanceof HTMLInputElement) return directInput;

      const nestedInput = container.querySelector<HTMLInputElement>('input[type="file"]');
      if (nestedInput) return nestedInput;
      container = container.parentElement;
    }
    return null;
  };

  const findDialogFileInput = () => {
    const pairedEnglishInput = findEnglishComposerFileInput();
    if (pairedEnglishInput) return pairedEnglishInput;
    if (restrictToEnglishComposer) return null;

    const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    return inputs.find((candidate) => {
      const accept = (candidate.getAttribute('accept') ?? '').toLowerCase();
      return !accept || accept.includes('image') || accept.includes('video') || accept.includes('*');
    }) ?? null;
  };

  const findAnyFileInput = () => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    return inputs.find((candidate) => {
      const accept = (candidate.getAttribute('accept') ?? '').toLowerCase();
      return !accept || accept.includes('image') || accept.includes('video') || accept.includes('*');
    }) ?? null;
  };

  let input = findDialogFileInput();
  if (!input) {
    const mediaButton = Array.from(dialog.querySelectorAll<HTMLElement>('[role="button"], button')).find((el) => {
      const combined = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
      return [
        'photo/video',
        'photo',
        'image',
        'add photos',
        'add photo',
        'صورة',
        'فيديو',
      ].some((keyword) => combined.includes(keyword.toLowerCase()));
    });

    if (mediaButton) {
      mediaButton.click();
      await sleep(POSTING_TIMING.mediaButtonDelayMs);
      input = await waitForValue(
        () => findDialogFileInput() ?? (restrictToEnglishComposer ? null : findAnyFileInput()),
        POSTING_TIMING.mediaInputTimeoutMs,
      );
    }
  }

  if (!input) {
    throw new Error('Could not find Facebook media upload input');
  }

  console.log('[PostFlow] Setting Facebook media input files:', input.getAttribute('accept') ?? 'no accept attr');
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  for (const type of ['dragenter', 'dragover', 'drop']) {
    dialog.dispatchEvent(new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  }

  const attached = await waitForCondition(() => {
    const text = ((dialog as HTMLElement).innerText ?? '').toLowerCase();
    const images = Array.from(dialog.querySelectorAll<HTMLImageElement>('img'));
    const hasPreviewImage = images.some((image) => {
      const src = image.currentSrc || image.src || '';
      const alt = image.alt.toLowerCase();
      if (restrictToEnglishComposer) {
        return !initialImages.has(image) &&
          (src.startsWith('blob:') || src.startsWith('data:')) &&
          !image.closest('[aria-label="Photo/video"]');
      }
      return src.startsWith('blob:') || src.startsWith('data:') || alt.includes('photo') || alt.includes('image');
    });
    const videos = Array.from(dialog.querySelectorAll<HTMLVideoElement>('video'));
    const hasPreviewVideo = videos.some((video) =>
      restrictToEnglishComposer
        ? !initialVideos.has(video) &&
          ((video.currentSrc || video.src).startsWith('blob:') || (video.currentSrc || video.src).startsWith('data:'))
        : Boolean(video.currentSrc || video.src)
    );
    if (restrictToEnglishComposer) return hasPreviewImage || hasPreviewVideo;
    return hasPreviewImage || hasPreviewVideo ||
      text.includes('photos/videos') ||
      text.includes('photo/video') ||
      text.includes('edit all') ||
      text.includes('add photos') ||
      text.includes('صورة') ||
      text.includes('صور');
  }, POSTING_TIMING.mediaPreviewTimeoutMs, POSTING_TIMING.mediaPreviewPollIntervalMs);

  if (!attached) {
    throw new Error('Facebook did not show the selected media in the composer');
  }

  console.log('[PostFlow] Media attached');
}

async function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return check();
}

async function waitForValue<T>(check: () => T | null, timeoutMs: number, intervalMs = 100): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await sleep(intervalMs);
  }
  return check();
}

function waitForCreatePostDialog(timeoutMs: number, isProfileTarget = false): Promise<Element | null> {
  return new Promise((resolve) => {
    const editorSelector = [
      'div[data-lexical-editor="true"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      'textarea',
    ].join(', ');

    const isVisible = (element: Element) => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    };

    const isInsideArticle = (element: Element) => Boolean(element.closest('[role="article"]'));
    const isLikelyComposerEditor = (element: Element) => {
      if (!isVisible(element) || isInsideArticle(element)) return false;
      const node = element as HTMLElement;
      if (isProfileTarget) {
        return (
          (node.getAttribute('data-lexical-editor') === 'true' ||
            (node.getAttribute('contenteditable') === 'true' && node.getAttribute('role') === 'textbox')) &&
          profileComposerTextMatches(node)
        );
      }
      const combined = [
        node.getAttribute('aria-label'),
        node.getAttribute('aria-placeholder'),
        node.getAttribute('placeholder'),
        node.getAttribute('data-lexical-editor'),
        node.textContent,
      ].filter(Boolean).join(' ').toLowerCase();

      if (node.getAttribute('data-lexical-editor') === 'true') return true;
      if (node.getAttribute('contenteditable') === 'true' && node.getAttribute('role') === 'textbox') return true;
      return [
        'write something',
        "what's on your mind",
        'create a post',
        'post',
      ].some((keyword) => combined.includes(keyword));
    };

    const findUsefulSurfaceForEditor = (editor: Element) => {
      const postButtonSelector = [
        '[aria-label="Post"]',
        '[aria-label="Publier"]',
        '[aria-label="Postar"]',
        '[role="button"]',
        'button',
      ].join(', ');

      let current = editor.parentElement;
      while (current && current !== document.body) {
        const hasPostButton = Array.from(current.querySelectorAll<HTMLElement>(postButtonSelector)).some((candidate) => {
          const text = (candidate.textContent ?? '').trim().toLowerCase();
          const label = (candidate.getAttribute('aria-label') ?? '').trim().toLowerCase();
          return ['post', 'publier', 'postar'].some((keyword) => text === keyword || label === keyword);
        });
        if (hasPostButton) return current;
        current = current.parentElement;
      }

      return editor.closest('[role="main"]') ?? editor.parentElement;
    };

    const check = () => {
      // Prefer the modal, because its Post button and editor belong together.
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"], [aria-modal="true"]'))
        .filter((candidate) => isVisible(candidate));
      const dialog = dialogs.find((candidate) =>
        (!isProfileTarget || candidate.getAttribute('aria-modal') === 'true') &&
        Array.from(candidate.querySelectorAll(editorSelector)).some(isLikelyComposerEditor) &&
        (!isProfileTarget || Boolean(candidate.querySelector(
          '[aria-label="Post"], [aria-label="\u0646\u0634\u0631"]',
        )))
      );
      if (dialog) return dialog;

      if (!isProfileTarget) {
        // Fallback for the newer inline group composer. Return its nearest useful
        // container so the existing editor/media/button lookup remains scoped.
        const inline = document.querySelector<HTMLElement>('[data-pagelet="GroupInlineComposer"]');
        const inlineEditor = inline && Array.from(inline.querySelectorAll(editorSelector)).find(isLikelyComposerEditor);
        if (inlineEditor) return inline;
      }

      // Profile publishing must remain inside the opened modal composer. A
      // loose profile-page Lexical editor can be a comment box, while a broad
      // ancestor can expose unrelated controls such as Add cover photo.
      if (isProfileTarget) return null;

      // Facebook sometimes mounts the opened composer in a sibling pagelet
      // instead of a dialog or GroupInlineComposer, especially after several
      // group pages have been opened in the same tab.
      const main = document.querySelector<HTMLElement>('[role="main"]') ?? document.body;
      const looseEditor = Array.from(main.querySelectorAll(editorSelector)).find(isLikelyComposerEditor);
      if (looseEditor) return findUsefulSurfaceForEditor(looseEditor);

      return null;
    };

    const found = check();
    if (found) {
      resolve(found);
      return;
    }

    const obs = new MutationObserver(() => {
      const el = check();
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

// Simple helper to wait for an element
function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    // Basic jQuery-like pseudo-selector handling for :has and :contains
    // Since document.querySelector doesn't support :contains, we do a manual check if needed.
    // For simplicity, we'll try a manual approach for the write button:
    const check = () => {
      if (selector.includes(':contains("Write something")')) {
        const spans = Array.from(document.querySelectorAll('span'));
        const span = spans.find(s => s.textContent?.includes('Write something'));
        if (span) {
          // Find closest role="button" parent
          let el: HTMLElement | null = span;
          while (el && el.getAttribute('role') !== 'button') {
            el = el.parentElement;
          }
          if (el) return el;
        }
        return null;
      }

      return document.querySelector(selector);
    };

    let el = check();
    if (el) {
      return resolve(el);
    }

    const observer = new MutationObserver(() => {
      el = check();
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

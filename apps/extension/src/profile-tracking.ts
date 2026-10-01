interface ProfilePublishTrackingCandidate {
  value: string;
  requestStartedAt: number;
  observedAt: number;
}

interface ProfilePublishTrackingSession {
  jobId: string;
  facebookUserId: string;
  submittedAt: number;
  acceptCandidatesAfter: number;
  existingPostUrls: ReadonlySet<string>;
  candidates: ProfilePublishTrackingCandidate[];
  candidateKeys: Set<string>;
}

interface FindPublishedProfilePostOptions {
  root?: ParentNode;
  expectedFacebookUserId: string;
  submittedText: string;
  submittedAt: number;
  existingPostElements?: ReadonlySet<Element>;
  existingPostUrls?: ReadonlySet<string>;
  submittedMediaCount?: number;
  allowUndatedMedia?: boolean;
}

interface PublishedProfilePostMatch {
  element: HTMLElement;
  postUrl: string;
}

let activeProfileTrackingSession: ProfilePublishTrackingSession | null = null;

function normalizeFacebookProfilePostUrl(
  value: string,
  expectedFacebookUserId: string,
  allowUnscopedProfileVideo = false,
): string | null {
  if (!/^\d+$/.test(expectedFacebookUserId)) return null;
  try {
    const url = new URL(value, window.location.origin);
    const hostname = url.hostname.toLowerCase();
    if (
      !['facebook.com', 'www.facebook.com'].includes(hostname) ||
      url.protocol !== 'https:'
    ) return null;

    const storyId = url.searchParams.get('story_fbid');
    const queryUserId = url.searchParams.get('id');
    if (
      (url.pathname === '/profile.php' || url.pathname === '/story.php') &&
      storyId &&
      queryUserId === expectedFacebookUserId
    ) {
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(expectedFacebookUserId)}&story_fbid=${encodeURIComponent(storyId)}`;
    }
    if (url.pathname === '/permalink.php' && storyId && queryUserId === expectedFacebookUserId) {
      return `https://www.facebook.com/permalink.php?id=${encodeURIComponent(expectedFacebookUserId)}&story_fbid=${encodeURIComponent(storyId)}`;
    }

    const ownedPathMatch = url.pathname.match(
      /^\/([^/]+)\/(posts|videos)\/([A-Za-z0-9_-]+)\/?$/i,
    );
    if (
      ownedPathMatch &&
      (
        ownedPathMatch[1] === expectedFacebookUserId ||
        (allowUnscopedProfileVideo && !['groups', 'pages', 'watch', 'reel', 'share'].includes(ownedPathMatch[1].toLowerCase()))
      )
    ) {
      return `https://www.facebook.com/${ownedPathMatch[1]}/${ownedPathMatch[2].toLowerCase()}/${ownedPathMatch[3]}/`;
    }

    if (allowUnscopedProfileVideo) {
      const reelMatch = url.pathname.match(/^\/reel\/([A-Za-z0-9_-]+)\/?$/i);
      if (reelMatch) return `https://www.facebook.com/reel/${reelMatch[1]}/`;

      const shareVideoMatch = url.pathname.match(/^\/share\/v\/([A-Za-z0-9_-]+)\/?$/i);
      if (shareVideoMatch) return `https://www.facebook.com/share/v/${shareVideoMatch[1]}/`;

      const watchVideoId = url.pathname === '/watch/' || url.pathname === '/watch'
        ? url.searchParams.get('v')
        : null;
      if (watchVideoId && /^[A-Za-z0-9_-]+$/.test(watchVideoId)) {
        return `https://www.facebook.com/watch/?v=${encodeURIComponent(watchVideoId)}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function profilePostTextMatches(element: Element, submittedText: string, submittedMediaCount = 0): boolean {
  const submitted = submittedText.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const candidate = (element.textContent ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!submitted) return submittedMediaCount > 0 && Boolean(element.querySelector('img, video'));
  if (!candidate) return false;
  if (candidate.includes(submitted)) return true;
  const minimumComparableLength = Math.min(40, Math.ceil(submitted.length * 0.6));
  return candidate.length >= minimumComparableLength && submitted.includes(candidate.slice(0, minimumComparableLength));
}

function profilePostIsVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function profilePostIsNew(
  element: Element,
  submittedAt: number,
  existingPostElements?: ReadonlySet<Element>,
  requireTimestamp = false,
): boolean {
  if (existingPostElements?.has(element)) return false;
  const timeElement = element.querySelector('time[datetime], [data-utime]');
  const rawTimestamp = timeElement?.getAttribute('datetime') ?? timeElement?.getAttribute('data-utime');
  if (!rawTimestamp) return !requireTimestamp;
  const timestamp = timeElement?.hasAttribute('data-utime') ? Number(rawTimestamp) * 1000 : Date.parse(rawTimestamp);
  return !Number.isFinite(timestamp) || timestamp >= submittedAt - 30_000;
}

function getProfilePostPermalink(
  element: Element,
  expectedFacebookUserId: string,
  allowUnscopedProfileVideo = false,
): string | null {
  for (const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const normalized = normalizeFacebookProfilePostUrl(
      link.href,
      expectedFacebookUserId,
      allowUnscopedProfileVideo,
    );
    if (normalized) return normalized;
  }
  if (allowUnscopedProfileVideo) {
    const videoIdentityElement = element.matches('[data-video-id]')
      ? element
      : element.querySelector('[data-video-id]');
    const videoId = videoIdentityElement?.getAttribute('data-video-id');
    if (videoId && /^[A-Za-z0-9_-]+$/.test(videoId)) {
      return `https://www.facebook.com/reel/${encodeURIComponent(videoId)}/`;
    }
  }
  return null;
}

function findPublishedProfilePost({
  root = document,
  expectedFacebookUserId,
  submittedText,
  submittedAt,
  existingPostElements,
  existingPostUrls,
  submittedMediaCount,
  allowUndatedMedia = false,
}: FindPublishedProfilePostOptions): PublishedProfilePostMatch | null {
  const selector = '[role="article"], [data-pagelet*="FeedUnit"]';
  const isMediaOnlySubmission = !submittedText.normalize('NFKC').trim() && Boolean(submittedMediaCount);
  const candidates: Element[] = [];
  if (root instanceof Element && root.matches(selector)) candidates.push(root);
  candidates.push(...Array.from(root.querySelectorAll(selector)));

  for (const candidate of candidates) {
    const postUrl = getProfilePostPermalink(
      candidate,
      expectedFacebookUserId,
      allowUndatedMedia,
    );
    const contentMatches = profilePostTextMatches(candidate, submittedText, submittedMediaCount) ||
      (isMediaOnlySubmission && allowUndatedMedia && Boolean(postUrl));
    if (!profilePostIsVisible(candidate) ||
      !contentMatches ||
      !profilePostIsNew(
        candidate,
        submittedAt,
        existingPostElements,
        isMediaOnlySubmission && !allowUndatedMedia,
      )) continue;
    if (!postUrl || existingPostUrls?.has(postUrl.replace(/\/$/, '').toLowerCase())) continue;
    return { element: candidate as HTMLElement, postUrl };
  }
  return null;
}

function getProfilePostUrlDiagnostics(root: ParentNode = document): {
  articleCount: number;
  anchorCount: number;
  candidatePathSamples: string;
} {
  const articles = Array.from(root.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"]'));
  const anchors = articles.flatMap((article) =>
    Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]')),
  );
  const samples = new Set<string>();
  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href, window.location.origin);
      if (!['facebook.com', 'www.facebook.com'].includes(url.hostname.toLowerCase())) continue;
      if (!/(?:posts|videos|reel|watch|share|story|permalink|profile)/i.test(`${url.pathname}${url.search}`)) continue;
      const queryKeys = Array.from(url.searchParams.keys()).sort();
      samples.add(`${url.pathname}${queryKeys.length ? `?${queryKeys.join('&')}` : ''}`);
      if (samples.size >= 12) break;
    } catch {
      // Ignore malformed Facebook links in diagnostics.
    }
  }
  return {
    articleCount: articles.length,
    anchorCount: anchors.length,
    candidatePathSamples: Array.from(samples).join(' | ').slice(0, 1000),
  };
}

function createProfilePublishTrackingSession(options: {
  jobId: string;
  facebookUserId: string;
  submittedAt: number;
  existingPostUrls: ReadonlySet<string>;
}): ProfilePublishTrackingSession {
  return {
    ...options,
    acceptCandidatesAfter: 0,
    candidates: [],
    candidateKeys: new Set(),
  };
}

function getProfileResponseCandidateUrls(
  detail: FacebookResponseCandidateDetail,
  facebookUserId: string,
): string[] {
  const videoCandidates = Array.isArray(detail.videoIds)
    ? detail.videoIds
      .filter((value): value is string => typeof value === 'string' && /^\d+$/.test(value))
      .map((value) => `https://www.facebook.com/${encodeURIComponent(facebookUserId)}/videos/${encodeURIComponent(value)}/`)
    : [];
  const directCandidates = Array.isArray(detail.postUrls)
    ? detail.postUrls.filter((value): value is string => typeof value === 'string')
    : [];
  const storyCandidates = Array.isArray(detail.storyFbids)
    ? detail.storyFbids
      .filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))
      .map((value) => `https://www.facebook.com/profile.php?id=${encodeURIComponent(facebookUserId)}&story_fbid=${encodeURIComponent(value)}`)
    : [];

  // Story permalinks are preferred when Facebook provides both a post and a
  // media identity; getBestProfileNetworkPostUrl reads newest candidates first.
  return [...videoCandidates, ...directCandidates, ...storyCandidates];
}

function trackProfileResponseCandidates(detail: FacebookResponseCandidateDetail): void {
  const session = activeProfileTrackingSession;
  if (!session) return;
  if (!isResponseForActivePublish(detail, session.acceptCandidatesAfter)) return;
  const requestStartedAt = detail.requestStartedAt as number;

  for (const value of getProfileResponseCandidateUrls(detail, session.facebookUserId)) {
    const normalized = normalizeFacebookProfilePostUrl(value, session.facebookUserId);
    if (!normalized || session.candidateKeys.has(normalized)) continue;
    session.candidateKeys.add(normalized);
    session.candidates.push({ value: normalized, requestStartedAt, observedAt: Date.now() });
  }
}

function getBestProfileNetworkPostUrl(session: ProfilePublishTrackingSession): string | null {
  for (let index = session.candidates.length - 1; index >= 0; index -= 1) {
    const candidate = session.candidates[index];
    if (candidate.observedAt < session.acceptCandidatesAfter) continue;
    if (candidate.requestStartedAt < session.acceptCandidatesAfter) continue;
    if (session.existingPostUrls.has(candidate.value.replace(/\/$/, '').toLowerCase())) continue;
    return candidate.value;
  }
  return null;
}

function getAcceptedProfileVideoEvidence(dialog: Element, hasVideo: boolean): string | null {
  if (!hasVideo || document.body.contains(dialog)) return null;
  return 'Facebook closed the profile composer after accepting the video';
}

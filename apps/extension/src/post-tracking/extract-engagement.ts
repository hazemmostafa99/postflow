interface EngagementExtraction {
  reactionCount: number | null;
  commentCount: number | null;
  diagnostics: string;
}

const ENGAGEMENT_POST_SELECTOR = '[role="article"], [data-pagelet*="FeedUnit"]';
const EMPTY_ENGAGEMENT_SURFACE_GRACE_MS = 7000;

function engagementTextCandidates(root: Element): string[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[aria-label], [title]'));
  return elements.flatMap((element) => [
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
    element.textContent ?? '',
  ]);
}

function extractLabeledFacebookCount(value: string, kind: 'reaction' | 'comment'): number | null {
  const text = value.trim();
  if (!text) return null;
  const numberPattern = '(\\d+(?:[.,]\\d+)?\\s*[KM]?)';
  const labels = kind === 'reaction'
    ? '(?:reaction|reactions|like|likes|reacted|إعجاب|إعجابات)'
    : '(?:comment|comments|تعليق|تعليقات)';
  const match = text.match(new RegExp(`${numberPattern}\\s*${labels}|${labels}[^0-9]*${numberPattern}`, 'i'));
  if (!match) return null;
  const raw = match[1] && /\d/.test(match[1]) ? match[1] : match[2];
  return raw ? parseFacebookCount(raw) : null;
}

function extractNumericCount(value: string): number | null {
  return parseFacebookCount(value.trim());
}

function engagementActionLabelPattern(role: 'like_button' | 'comment_button'): RegExp {
  return role === 'like_button'
    ? /(?:like|react|\u0625\u0639\u062c\u0627\u0628|\u0623\u0639\u062c\u0628\u0646\u064a)/i
    : /(?:comment|\u062a\u0639\u0644\u064a\u0642)/i;
}

function findEngagementAction(
  post: Element,
  role: 'like_button' | 'comment_button',
): HTMLElement | null {
  const explicit = post.querySelector<HTMLElement>(`[data-ad-rendering-role="${role}"]`);
  if (explicit) return explicit;

  const labelPattern = engagementActionLabelPattern(role);
  return Array.from(post.querySelectorAll<HTMLElement>('[role="button"][aria-label], button[aria-label]'))
    .find((element) => labelPattern.test(element.getAttribute('aria-label') ?? '')) ?? null;
}

function findVisibleEngagementActions(
  root: ParentNode,
  role: 'like_button' | 'comment_button',
): HTMLElement[] {
  const explicit = Array.from(
    root.querySelectorAll<HTMLElement>(`[data-ad-rendering-role="${role}"]`),
  ).filter(isEngagementVisible);
  if (explicit.length) return explicit;

  const labelPattern = engagementActionLabelPattern(role);
  return Array.from(root.querySelectorAll<HTMLElement>('[role="button"][aria-label], button[aria-label]'))
    .filter(isEngagementVisible)
    .filter((element) => labelPattern.test(element.getAttribute('aria-label') ?? ''));
}

function findUniqueEngagementControlScope(root: ParentNode): Element | null {
  const likeActions = findVisibleEngagementActions(root, 'like_button');
  const commentActions = findVisibleEngagementActions(root, 'comment_button');
  if (likeActions.length !== 1 || commentActions.length !== 1) return null;

  let common: Element | null = likeActions[0];
  while (common && !common.contains(commentActions[0])) common = common.parentElement;
  if (!common) return null;

  return common.closest('[role="article"], [role="dialog"], [role="main"]') ?? common;
}

function extractCountNearAction(post: Element, role: 'like_button' | 'comment_button'): number | null {
  const action = findEngagementAction(post, role);
  if (!action) return null;

  for (const element of Array.from(action.querySelectorAll<HTMLElement>('span[dir="auto"], span'))) {
    const count = extractNumericCount(element.textContent ?? '');
    if (count !== null) return count;
  }

  let container = action?.parentElement ?? null;
  for (let depth = 0; container && container !== post && depth < 3; depth += 1) {
    // Stop before climbing into the shared action row or another comment.
    const otherRole = role === 'like_button' ? 'comment_button' : 'like_button';
    if (findEngagementAction(container, otherRole)) break;
    const values = Array.from(container.querySelectorAll<HTMLElement>('span[dir="auto"], span'));
    for (const element of values) {
      const count = extractNumericCount(element.textContent ?? '');
      if (count !== null) return count;
    }
    container = container.parentElement;
  }
  return null;
}

function extractNumericReactionSummary(post: Element): number | null {
  const elements = Array.from(post.querySelectorAll<HTMLElement>('[aria-label]'));
  for (const element of elements) {
    if (element.closest('a[href], [role="textbox"], [data-ad-rendering-role="story_message"]')) continue;
    const count = extractLabeledFacebookCount(element.getAttribute('aria-label') ?? '', 'reaction');
    if (count !== null) return count;
  }
  return null;
}

function hasLoadedEngagementActions(post: Element): boolean {
  return Boolean(findEngagementAction(post, 'like_button') && findEngagementAction(post, 'comment_button'));
}

function hasExplicitNoCommentsMessage(post: Element): boolean {
  const text = post.textContent ?? '';
  return /no comments/i.test(text)
    || /\u0644\u0627\s+\u062a\u0648\u062c\u062f.*?\u062a\u0639\u0644\u064a\u0642/.test(text)
    || /\u062a\u0639\u0644\u064a\u0642\u0627\u062a.*?\u0644\u0627/.test(text)
    || /\u00d8\u00aa\u00d9\u0080\u00d8\u00ac\u00d8\u00af.*?\u00d8\u00aa\u00d9\u0084/.test(text)
    || /\u00d8\u00aa\u00d9\u0084\u00d9\u008a\u00d9\u0082\u00d8\u00a7\u00d8\u00aa.*?\u00d9\u0084\u00d8\u00a7/.test(text);
}

function normalizeFacebookPath(value: string): string | null {
  try {
    return new URL(value, window.location.href).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return null;
  }
}

interface FacebookEngagementIdentity {
  kind: 'POST' | 'REEL' | 'VIDEO';
  id: string;
}

function extractFacebookEngagementIdentity(value: string): FacebookEngagementIdentity | null {
  try {
    const url = new URL(value, window.location.href);
    const queryPostId = url.searchParams.get('multi_permalinks') ?? url.searchParams.get('story_fbid');
    if (queryPostId && /^[A-Za-z0-9_-]+$/.test(queryPostId)) {
      return { kind: 'POST', id: queryPostId };
    }

    const postMatch = url.pathname.match(/\/(?:posts|permalink)\/([A-Za-z0-9_-]+)/i);
    if (postMatch) return { kind: 'POST', id: postMatch[1] };

    const reelMatch = url.pathname.match(/^\/reel\/([A-Za-z0-9_-]+)\/?$/i);
    if (reelMatch) return { kind: 'REEL', id: reelMatch[1] };

    const videoMatch = url.pathname.match(/\/videos\/([A-Za-z0-9_-]+)/i);
    if (videoMatch) return { kind: 'VIDEO', id: videoMatch[1] };

    const watchId = /^\/watch\/?$/i.test(url.pathname) ? url.searchParams.get('v') : null;
    if (watchId && /^[A-Za-z0-9_-]+$/.test(watchId)) return { kind: 'VIDEO', id: watchId };

    const sharedVideoMatch = url.pathname.match(/^\/share\/v\/([A-Za-z0-9_-]+)\/?$/i);
    if (sharedVideoMatch) return { kind: 'VIDEO', id: sharedVideoMatch[1] };
    return null;
  } catch {
    return null;
  }
}

function sameFacebookEngagementIdentity(
  first: FacebookEngagementIdentity | null,
  second: FacebookEngagementIdentity | null,
): boolean {
  if (!first || !second) return false;
  const bothVideo = ['REEL', 'VIDEO'].includes(first.kind) && ['REEL', 'VIDEO'].includes(second.kind);
  return first.id === second.id && (first.kind === second.kind || bothVideo);
}

function findVideoIdentityElement(root: ParentNode, id: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-video-id]'))
    .find((element) => element.getAttribute('data-video-id') === id) ?? null;
}

interface EngagementTargetMatch {
  element: Element | null;
  identityFound: boolean;
}

function findEngagementTargetInRoot(
  root: ParentNode,
  targetIdentity: FacebookEngagementIdentity,
): EngagementTargetMatch {
  let identityFound = false;
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (!isEngagementVisible(link)) continue;
    let url: URL;
    try { url = new URL(link.href, window.location.href); } catch { continue; }
    if (url.hostname !== 'facebook.com' && !url.hostname.endsWith('.facebook.com')) continue;
    if (!sameFacebookEngagementIdentity(extractFacebookEngagementIdentity(url.href), targetIdentity)) continue;
    identityFound = true;
    const article = link.closest(ENGAGEMENT_POST_SELECTOR);
    if (article) return { element: article.closest('[role="dialog"]') ?? article, identityFound: true };
    const viewer = link.closest('[role="dialog"], [role="main"]');
    if (viewer) return { element: viewer, identityFound: true };
  }

  if (['REEL', 'VIDEO'].includes(targetIdentity.kind)) {
    const videoIdentity = findVideoIdentityElement(root, targetIdentity.id);
    identityFound ||= Boolean(videoIdentity);
    const article = videoIdentity?.closest(ENGAGEMENT_POST_SELECTOR);
    if (article) return { element: article.closest('[role="dialog"]') ?? article, identityFound: true };
    const viewer = videoIdentity?.closest('[role="dialog"], [role="main"]');
    if (viewer) return { element: viewer, identityFound: true };
  }

  return { element: null, identityFound };
}

function findTargetPublishedPost(root: ParentNode = document, targetUrl?: string): Element | null {
  const targetPath = targetUrl ? normalizeFacebookPath(targetUrl) : normalizeFacebookPath(window.location.href);
  const targetIdentity = extractFacebookEngagementIdentity(targetUrl ?? window.location.href);
  const posts = Array.from(root.querySelectorAll<HTMLElement>(ENGAGEMENT_POST_SELECTOR));
  if (targetIdentity?.kind === 'POST') {
    const permalinkLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="multi_permalinks"]'));
    for (const link of permalinkLinks) {
      try {
        if (new URL(link.href, window.location.href).searchParams.get('multi_permalinks') !== targetIdentity.id) continue;
        const article = link.closest<HTMLElement>(ENGAGEMENT_POST_SELECTOR);
        if (article) {
          console.log('[PostAnalytics] Matched target article directly from multi_permalinks', { targetId: targetIdentity.id });
          return article;
        }
      } catch {
        // Ignore malformed Facebook links and continue with article matching.
      }
    }
  }
  console.debug('[PostAnalytics] Target post candidates', {
    targetUrl,
    targetPath,
    targetIdentity,
    currentPath: normalizeFacebookPath(window.location.href),
    candidateCount: posts.length,
  });
  if (!posts.length) return null;

  if (targetPath) {
    for (const post of posts) {
      const links = Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const hasTargetIdentity = targetIdentity && links.some((link) =>
        sameFacebookEngagementIdentity(extractFacebookEngagementIdentity(link.href), targetIdentity),
      );
      const hasTargetPermalink = links.some((link) => {
        const path = normalizeFacebookPath(link.href);
        return path === targetPath;
      });
      const hasTargetVideoId = Boolean(
        targetIdentity && ['REEL', 'VIDEO'].includes(targetIdentity.kind) &&
        findVideoIdentityElement(post, targetIdentity.id),
      );
      if (hasTargetIdentity || hasTargetPermalink || hasTargetVideoId) {
        console.log('[PostAnalytics] Matched target article', {
          matchedBy: hasTargetIdentity ? 'identity' : hasTargetVideoId ? 'video-id' : 'pathname',
          targetIdentity,
        });
        return post;
      }
    }
  }

  // A direct permalink commonly renders one article without a permalink anchor.
  // Only use this fallback when the page has a single candidate, avoiding a
  // guessed match among recommended/related posts.
  if (posts.length === 1) {
    console.debug('[PostAnalytics] Using direct-post fallback article', { candidateCount: posts.length });
    return posts[0];
  }
  console.warn('[PostAnalytics] Could not safely identify target article', { candidateCount: posts.length });
  return null;
}

function findEngagementRoot(root: ParentNode = document, targetUrl?: string): Element | null {
  const targetIdentity = targetUrl ? extractFacebookEngagementIdentity(targetUrl) : null;
  if (!targetIdentity) return null;
  if (root instanceof Element && root.matches(ENGAGEMENT_POST_SELECTOR) && isEngagementVisible(root)) {
    return root;
  }
  const scopes = Array.from(root.querySelectorAll('[role="dialog"]')).filter(isEngagementVisible);
  // An open modal owns the foreground when it contains the target. If it is
  // unrelated, continue searching the page so it cannot hide the profile post.
  for (const scope of scopes) {
    const match = findEngagementTargetInRoot(scope, targetIdentity);
    if (match.element) return match.element;
    if (match.identityFound) return null;
  }

  const pageMatch = findEngagementTargetInRoot(root, targetIdentity);
  if (pageMatch.element) return pageMatch.element;

  if (sameFacebookEngagementIdentity(
    extractFacebookEngagementIdentity(window.location.href),
    targetIdentity,
  )) {
    const matchedPost = findTargetPublishedPost(root, targetUrl);
    if (matchedPost) return matchedPost.closest('[role="dialog"]') ?? matchedPost;

    // Direct reel viewers sometimes omit article, permalink, and video identity
    // markup. The browser URL proves which reel is open; accept its controls
    // only when there is one unambiguous visible Like/Comment pair.
    const controlScope = findUniqueEngagementControlScope(root);
    if (controlScope) {
      console.log('[PostAnalytics] Matched direct reel viewer by unique action controls', {
        scope: controlScope.getAttribute('role') ?? controlScope.tagName.toLowerCase(),
      });
      return controlScope;
    }
  }
  return null;
}

function isEngagementVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function getEngagementRenderDiagnostics(targetUrl: string, scope: Element | null) {
  return {
    extractor: 'v10',
    targetFound: Boolean(scope),
    targetActionsLoaded: Boolean(scope && hasLoadedEngagementActions(scope)),
    currentTarget: sameFacebookEngagementIdentity(
      extractFacebookEngagementIdentity(window.location.href),
      extractFacebookEngagementIdentity(targetUrl),
    ),
    articles: document.querySelectorAll(ENGAGEMENT_POST_SELECTOR).length,
    visibleDialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter(isEngagementVisible).length,
    visibleLikeActions: findVisibleEngagementActions(document, 'like_button').length,
    visibleCommentActions: findVisibleEngagementActions(document, 'comment_button').length,
    pageLikeButtons: document.querySelectorAll('[data-ad-rendering-role="like_button"]').length,
    targetLikeButtons: scope?.querySelectorAll('[data-ad-rendering-role="like_button"]').length ?? 0,
  };
}

function createEngagementRenderFailure(
  targetUrl: string,
  scope: Element | null,
): Extract<PostEngagementSyncResult, { status: 'CHECK_FAILED' }> {
  const diagnostics = getEngagementRenderDiagnostics(targetUrl, scope);
  const emptySurface = diagnostics.currentTarget &&
    diagnostics.articles === 0 &&
    diagnostics.visibleDialogs === 0 &&
    diagnostics.visibleLikeActions === 0 &&
    diagnostics.visibleCommentActions === 0;
  console.log('[PostAnalytics] Target render deadline', diagnostics);
  return {
    status: 'CHECK_FAILED',
    emptySurface,
    reason: [
      'Target post engagement controls did not finish rendering',
      `(extractor=v10, targetFound=${diagnostics.targetFound}`,
      `currentTarget=${diagnostics.currentTarget}`,
      `articles=${diagnostics.articles}`,
      `dialogs=${diagnostics.visibleDialogs}`,
      `likes=${diagnostics.visibleLikeActions}`,
      `comments=${diagnostics.visibleCommentActions})`,
    ].join(', '),
  };
}

/** Re-resolve the target on every poll because Facebook replaces modal nodes. */
async function waitForPostEngagement(targetUrl: string, timeoutMs: number): Promise<PostEngagementSyncResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let stableSince = 0;
  let previousScope: Element | null = null;
  let previousText = '';
  while (Date.now() < deadline) {
    const scope = findEngagementRoot(document, targetUrl);
    const ready = scope && hasLoadedEngagementActions(scope);
    const text = ready ? scope.textContent ?? '' : '';
    if (!ready || scope !== previousScope || text !== previousText) stableSince = Date.now();
    previousScope = scope;
    previousText = text;
    if (ready && Date.now() - stableSince >= 1000) {
      const result = extractPostEngagementResult(scope, targetUrl);
      if (result.status === 'SUCCESS') return result;
    }
    if (!scope && Date.now() - startedAt >= EMPTY_ENGAGEMENT_SURFACE_GRACE_MS) {
      const diagnostics = getEngagementRenderDiagnostics(targetUrl, scope);
      if (
        diagnostics.currentTarget &&
        diagnostics.articles === 0 &&
        diagnostics.visibleDialogs === 0 &&
        diagnostics.visibleLikeActions === 0 &&
        diagnostics.visibleCommentActions === 0
      ) return createEngagementRenderFailure(targetUrl, scope);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const scope = findEngagementRoot(document, targetUrl);
  if (scope && hasLoadedEngagementActions(scope) && scope === previousScope && Date.now() - stableSince >= 1000) {
    return extractPostEngagementResult(scope, targetUrl);
  }
  return createEngagementRenderFailure(targetUrl, scope);
}

/** Extract only counters belonging to the target post, never defaulting unknown values to zero. */
function extractFacebookEngagement(root: ParentNode = document, targetUrl?: string): EngagementExtraction {
  const post = findEngagementRoot(root, targetUrl);
  if (!post) {
    const diagnostics = [
      'extractor=v10',
      'targetArticle=false',
      `articles=${root.querySelectorAll(ENGAGEMENT_POST_SELECTOR).length}`,
      `permalinkLinks=${root.querySelectorAll('a[href*="multi_permalinks"]').length}`,
      `targetIdentity=${targetUrl ? JSON.stringify(extractFacebookEngagementIdentity(targetUrl)) : 'none'}`,
    ].join(', ');
    console.warn('[PostAnalytics] No target article found for engagement extraction');
    return { reactionCount: null, commentCount: null, diagnostics };
  }

  const candidates = engagementTextCandidates(post);
  console.debug('[PostAnalytics] Engagement label candidates', candidates.filter(Boolean).slice(0, 40));
  let reactionCount: number | null = extractCountNearAction(post, 'like_button') ?? extractNumericReactionSummary(post);
  const explicitNoComments = hasExplicitNoCommentsMessage(post);
  let commentCount: number | null = extractCountNearAction(post, 'comment_button') ?? (explicitNoComments ? 0 : null);
  for (const candidate of candidates) {
    reactionCount ??= extractLabeledFacebookCount(candidate, 'reaction');
    commentCount ??= extractLabeledFacebookCount(candidate, 'comment');
    if (reactionCount !== null && commentCount !== null) break;
  }
  if (reactionCount === null && hasLoadedEngagementActions(post)) {
    // Facebook omits the reaction summary entirely for zero reactions. Once
    // both action controls are rendered, that absence is positive zero-state
    // evidence. The post-age permalink is deliberately excluded above.
    reactionCount = 0;
  }
  const diagnostics = [
    'extractor=v10',
    `scope=${post.matches('[role="dialog"]') ? 'dialog' : 'article'}`,
    'targetArticle=true',
    `permalinkLinks=${post.querySelectorAll('a[href*="multi_permalinks"]').length}`,
    `labels=${candidates.filter(Boolean).length}`,
    `explicitNoComments=${explicitNoComments}`,
    `actionsLoaded=${hasLoadedEngagementActions(post)}`,
  ].join(', ');
  console.log('[PostAnalytics] Extracted engagement counters', { reactionCount, commentCount, diagnostics });
  return { reactionCount, commentCount, diagnostics };
}

function extractPostEngagementResult(root: ParentNode = document, targetUrl?: string): PostEngagementSyncResult {
  const { reactionCount, commentCount, diagnostics } = extractFacebookEngagement(root, targetUrl);
  if (reactionCount !== null && commentCount !== null) {
    return { status: 'SUCCESS', reactionCount, commentCount };
  }
  if (reactionCount !== null || commentCount !== null) {
    return {
      status: 'PARTIAL',
      ...(reactionCount !== null ? { reactionCount } : {}),
      ...(commentCount !== null ? { commentCount } : {}),
      reason: `One Facebook engagement counter was not detected (${diagnostics})`,
    };
  }
  return { status: 'CHECK_FAILED', reason: `Facebook engagement counters were not detected (${diagnostics})` };
}

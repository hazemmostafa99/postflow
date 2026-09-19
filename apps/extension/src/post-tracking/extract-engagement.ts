interface EngagementExtraction {
  reactionCount: number | null;
  commentCount: number | null;
  diagnostics: string;
}

const ENGAGEMENT_POST_SELECTOR = '[role="article"], [data-pagelet*="FeedUnit"]';

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

function extractCountNearAction(post: Element, role: 'like_button' | 'comment_button'): number | null {
  const action = post.querySelector<HTMLElement>(`[data-ad-rendering-role="${role}"]`);
  let container = action?.parentElement ?? null;
  for (let depth = 0; container && container !== post && depth < 3; depth += 1) {
    // Stop before climbing into the shared action row or another comment.
    const otherRole = role === 'like_button' ? 'comment_button' : 'like_button';
    if (container.querySelector(`[data-ad-rendering-role="${otherRole}"]`)) break;
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
  return Boolean(
    post.querySelector('[data-ad-rendering-role="like_button"]') &&
    post.querySelector('[data-ad-rendering-role="comment_button"]'),
  );
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

function extractFacebookPostId(value: string): string | null {
  const match = value.match(/\/posts\/(\d+)/i);
  return match?.[1] ?? null;
}

function findTargetPublishedPost(root: ParentNode = document, targetUrl?: string): Element | null {
  const targetPath = targetUrl ? normalizeFacebookPath(targetUrl) : normalizeFacebookPath(window.location.href);
  const targetPostId = targetUrl ? extractFacebookPostId(targetUrl) : extractFacebookPostId(window.location.href);
  const posts = Array.from(root.querySelectorAll<HTMLElement>(ENGAGEMENT_POST_SELECTOR));
  if (targetPostId) {
    const permalinkLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="multi_permalinks"]'));
    for (const link of permalinkLinks) {
      try {
        if (new URL(link.href, window.location.href).searchParams.get('multi_permalinks') !== targetPostId) continue;
        const article = link.closest<HTMLElement>(ENGAGEMENT_POST_SELECTOR);
        if (article) {
          console.log('[PostAnalytics] Matched target article directly from multi_permalinks', { targetPostId });
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
    targetPostId,
    currentPath: normalizeFacebookPath(window.location.href),
    candidateCount: posts.length,
  });
  if (!posts.length) return null;

  if (targetPath) {
    for (const post of posts) {
      const links = Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const hasTargetPostId = targetPostId && links.some((link) => {
        try {
          return new URL(link.href, window.location.href).searchParams.get('multi_permalinks') === targetPostId;
        } catch {
          return false;
        }
      });
      const hasTargetPermalink = links.some((link) => {
        const path = normalizeFacebookPath(link.href);
        return path === targetPath;
      });
      if (hasTargetPostId || hasTargetPermalink) {
        console.log('[PostAnalytics] Matched target article', {
          matchedBy: hasTargetPostId ? 'multi_permalinks' : 'pathname',
          targetPostId,
        });
        return post;
      }
    }
  }

  // A direct permalink commonly renders one article without a permalink anchor.
  // Only use this fallback when the page has a single candidate, avoiding a
  // guessed match among recommended/related posts.
  const currentPath = normalizeFacebookPath(window.location.href);
  if (posts.length === 1 || (targetPath && currentPath === targetPath)) {
    console.debug('[PostAnalytics] Using direct-post fallback article', { candidateCount: posts.length });
    return posts[0];
  }
  console.warn('[PostAnalytics] Could not safely identify target article', { candidateCount: posts.length });
  return null;
}

function findEngagementRoot(root: ParentNode = document, targetUrl?: string): Element | null {
  const targetId = targetUrl ? extractFacebookPostId(targetUrl) : null;
  if (!targetId) return null;
  const scopes = Array.from(root.querySelectorAll('[role="dialog"]')).filter(isEngagementVisible);
  // An open modal owns the foreground. Background feed controls cannot make it ready.
  const searchRoots: ParentNode[] = scopes.length ? scopes : [root];
  for (const searchRoot of searchRoots) {
    for (const link of Array.from(searchRoot.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (!isEngagementVisible(link)) continue;
      let url: URL;
      try { url = new URL(link.href, window.location.href); } catch { continue; }
      if (url.hostname !== 'facebook.com' && !url.hostname.endsWith('.facebook.com')) continue;
      if (extractFacebookPostId(url.href) !== targetId && url.searchParams.get('multi_permalinks') !== targetId) continue;
      const article = link.closest(ENGAGEMENT_POST_SELECTOR);
      if (article) return article.closest('[role="dialog"]') ?? article;
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

/** Re-resolve the target on every poll because Facebook replaces modal nodes. */
async function waitForPostEngagement(targetUrl: string, timeoutMs: number): Promise<PostEngagementSyncResult> {
  const deadline = Date.now() + timeoutMs;
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const scope = findEngagementRoot(document, targetUrl);
  console.log('[PostAnalytics] Target render deadline', {
    extractor: 'v6', targetFound: Boolean(scope),
    targetActionsLoaded: Boolean(scope && hasLoadedEngagementActions(scope)),
    pageLikeButtons: document.querySelectorAll('[data-ad-rendering-role="like_button"]').length,
    targetLikeButtons: scope?.querySelectorAll('[data-ad-rendering-role="like_button"]').length ?? 0,
  });
  if (scope && hasLoadedEngagementActions(scope) && scope === previousScope && Date.now() - stableSince >= 1000) {
    return extractPostEngagementResult(scope, targetUrl);
  }
  return { status: 'CHECK_FAILED', reason: `Target post engagement controls did not finish rendering (extractor=v6, targetFound=${Boolean(scope)})` };
}

/** Extract only counters belonging to the target post, never defaulting unknown values to zero. */
function extractFacebookEngagement(root: ParentNode = document, targetUrl?: string): EngagementExtraction {
  const post = findEngagementRoot(root, targetUrl);
  if (!post) {
    const diagnostics = [
      'extractor=v6',
      'targetArticle=false',
      `articles=${root.querySelectorAll(ENGAGEMENT_POST_SELECTOR).length}`,
      `permalinkLinks=${root.querySelectorAll('a[href*="multi_permalinks"]').length}`,
      `targetPostId=${targetUrl ? extractFacebookPostId(targetUrl) ?? 'none' : 'none'}`,
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
    'extractor=v6',
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

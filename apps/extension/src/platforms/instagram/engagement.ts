type InstagramEngagementResult =
  | { status: 'SUCCESS'; reactionCount: number; commentCount: number }
  | { status: 'PARTIAL'; reactionCount?: number; commentCount?: number; reason?: string }
  | { status: 'CHECK_FAILED'; reason?: string };

type InstagramPostEngagementApi = {
  check: (targetUrl: string, timeoutMs?: number) => Promise<InstagramEngagementResult>;
};

function normalizePath(value: string): string | null {
  try {
    const url = new URL(value, window.location.href);
    return url.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return null;
  }
}

function instagramEngagementTargetPathPattern(targetUrl: string): RegExp | null {
  const path = normalizePath(targetUrl);
  if (!path) return null;
  const match = path.match(/^(?:\/[^/]+)?\/(p|reel)\/([a-z0-9_-]+)$/i);
  return match ? new RegExp(`(?:^|/)${match[1]}/${match[2]}(?:/|$)`, 'i') : null;
}

function instagramEngagementVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function findPostScope(targetUrl: string): Element | null {
  const pattern = instagramEngagementTargetPathPattern(targetUrl);
  if (!pattern) return null;

  const matchingLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    // A matching permalink is the strongest identity signal. Instagram's
    // full-page layout can report the anchor as hidden while its engagement
    // controls are already rendered and usable, so do not gate this lookup on
    // the CSS visibility heuristic.
    .find((link) => pattern.test(normalizePath(link.href) ?? ''));
  if (matchingLink) {
    const actionSelector = 'svg[aria-label="Like"], svg[aria-label="Unlike"], svg[aria-label="Comment"]';
    let firstActionScope: Element | null = null;
    let scope = matchingLink.parentElement;
    for (let depth = 0; scope && depth < 40; depth += 1, scope = scope.parentElement) {
      const hasLike = Boolean(scope.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]'));
      const hasComment = Boolean(scope.querySelector('svg[aria-label="Comment"]'));
      if (!hasLike || !hasComment || !scope.querySelector(actionSelector)) continue;
      firstActionScope ??= scope;

      // The toolbar itself can be the first ancestor with both icons. Prefer
      // the smallest ancestor that also contains a rendered counter or the
      // explicit empty-comments state, so extraction sees the whole post.
      const text = (scope.textContent ?? '').replace(/\s+/g, ' ');
      const hasRenderedEngagementState = /(?:no comments yet|start the conversation)/i.test(text)
        || /(?:unlike|like|comment)\s*\d+(?:[.,]\d+)?\s*[KMB]?/i.test(text);
      if (hasRenderedEngagementState) return scope;
    }
    if (firstActionScope) return firstActionScope;
    return matchingLink.closest('[role="dialog"], article, [role="article"], main') ?? matchingLink.parentElement;
  }

  const matchingDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .find((dialog) => instagramEngagementVisible(dialog) && pattern.test(dialog.innerHTML));
  if (matchingDialog) return matchingDialog;

  const currentPath = normalizePath(window.location.href);
  if (currentPath && pattern.test(currentPath)) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], article, [role="article"], main'))
      .filter(instagramEngagementVisible);
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

function parseCount(raw: string): number | null {
  const normalized = raw.replace(/,/g, '').trim().toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

function countFromText(text: string, labels: RegExp): number | null {
  const match = text.replace(/\s+/g, ' ').match(new RegExp(`(\\d+(?:[.,]\\d+)?\\s*[KMB]?)\\s*${labels.source}`, 'i'));
  return match ? parseCount(match[1]) : null;
}

function numericOnly(text: string): number | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return /^(?:\d+(?:[.,]\d+)?\s*[KMB]?)$/i.test(normalized)
    ? parseCount(normalized)
    : null;
}

function extractActionCountFromText(scope: Element, action: 'like' | 'comment'): number | null {
  const text = (scope.textContent ?? '').replace(/\s+/g, ' ');
  // Match the standalone action labels used by Instagram's compact toolbar
  // (`Unlike1Comment1`), but not plural prose such as `12 likes` or
  // `3 comments`; those are handled by countFromText below.
  const labelPattern = action === 'like'
    ? /(?:Unlike|Like)(?=\d|[^A-Za-z]|$)/gi
    : /Comment(?=\d|[^A-Za-z]|$)/gi;
  const matches = Array.from(text.matchAll(labelPattern));
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const remainder = text.slice(start, start + 80);
    const nextAction = remainder.search(/(?:Unlike|Like|Comment|Repost|Share|Save)/i);
    const segment = nextAction >= 0 ? remainder.slice(0, nextAction) : remainder;
    const count = segment.match(/(\d+(?:[.,]\d+)?\s*[KMB]?)/i);
    if (count) return parseCount(count[1]);
  }
  return null;
}

function extractActionCount(scope: Element, action: 'like' | 'comment'): number | null {
  const textCount = extractActionCountFromText(scope, action);
  if (textCount !== null) return textCount;
  const icons = Array.from(scope.querySelectorAll<SVGElement>(
    'svg[aria-label="Like"], svg[aria-label="Unlike"], svg[aria-label="Comment"]',
  ));
  const unlikeIcons = icons.filter((icon) => icon.getAttribute('aria-label') === 'Unlike');
  const likeIcons = icons.filter((icon) => icon.getAttribute('aria-label') === 'Like');
  const targetIcons = action === 'like'
    ? (unlikeIcons.length ? unlikeIcons : likeIcons)
    : icons.filter((icon) => icon.getAttribute('aria-label') === 'Comment');
  const icon = targetIcons[targetIcons.length - 1];
  if (!icon) return null;
  const iconIndex = icons.indexOf(icon);
  const nextAction = action === 'like'
    ? icons.slice(iconIndex + 1).find((candidate) => candidate.getAttribute('aria-label') === 'Comment')
    : undefined;
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('[role="button"], span'))
    .filter((element) => numericOnly(element.textContent ?? '') !== null)
    .filter((element) => (icon.compareDocumentPosition(element) & 4) !== 0)
    .filter((element) => !nextAction || (element.compareDocumentPosition(nextAction) & 4) !== 0);
  return numericOnly(candidates[0]?.textContent ?? '') ?? null;
}

function collectText(scope: Element): string[] {
  return [
    scope.textContent ?? '',
    ...Array.from(scope.querySelectorAll<HTMLElement>('[aria-label], [title]')).flatMap((element) => [
      element.getAttribute('aria-label') ?? '',
      element.getAttribute('title') ?? '',
    ]),
  ].filter(Boolean);
}

function extract(scope: Element): InstagramEngagementResult {
  const candidates = collectText(scope);
  let reactionCount: number | null = extractActionCount(scope, 'like');
  let commentCount: number | null = extractActionCount(scope, 'comment');
  for (const text of candidates) {
    reactionCount ??= countFromText(text, /(?:like|likes|reaction|reactions)/i);
    commentCount ??= countFromText(text, /(?:comment|comments)/i);
    if (/(?:no likes yet|be the first to like this)/i.test(text)) reactionCount ??= 0;
    if (/(?:no comments yet|start the conversation)/i.test(text)) commentCount ??= 0;
  }

  // Some Instagram layouts render a verified Like/Unlike control but omit the
  // numeric counter when nobody has liked the post. The product policy treats
  // that loaded, counter-less state as zero likes; a missing post scope still
  // fails separately in check().
  if (reactionCount === null && scope.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]')) {
    reactionCount = 0;
  }

  if (reactionCount !== null && commentCount !== null) {
    return { status: 'SUCCESS', reactionCount, commentCount };
  }
  if (reactionCount !== null || commentCount !== null) {
    return {
      status: 'PARTIAL',
      ...(reactionCount !== null ? { reactionCount } : {}),
      ...(commentCount !== null ? { commentCount } : {}),
      reason: 'Instagram did not expose a numeric Comment count; the value remains unknown',
    };
  }
  return {
    status: 'CHECK_FAILED',
    reason: 'Instagram engagement counters were not detected',
  };
}

async function check(targetUrl: string, timeoutMs = 12_000): Promise<InstagramEngagementResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const scope = findPostScope(targetUrl);
    if (scope) {
      const result = extract(scope);
      if (result.status !== 'CHECK_FAILED') return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { status: 'CHECK_FAILED', reason: 'Instagram post details did not finish rendering' };
}

const api: InstagramPostEngagementApi = { check };
(globalThis as typeof globalThis & { PostFlowInstagramEngagement?: InstagramPostEngagementApi }).PostFlowInstagramEngagement = api;

console.info('[PostFlow][Instagram] Engagement extractor ready');

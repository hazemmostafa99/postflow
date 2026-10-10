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
  const match = path.match(/^(?:\/[^/]+)?\/(p|reels?)\/([a-z0-9_-]+)$/i);
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

const instagramEngagementActionLabels = {
  like: ['Like', 'Unlike', 'أعجبني', 'إلغاء الإعجاب'],
  comment: ['Comment', 'تعليق'],
};
const instagramEngagementActionSelector = Object.values(instagramEngagementActionLabels)
  .flat().map((label) => `svg[aria-label="${label}"]`).join(', ');

function engagementActionIcons(scope: Element, action: 'like' | 'comment'): Element[] {
  return Array.from(scope.querySelectorAll(instagramEngagementActionSelector))
    .filter((icon) => instagramEngagementVisible(icon)
      && instagramEngagementActionLabels[action].includes(icon.getAttribute('aria-label') ?? ''));
}

function normalizeEngagementNumber(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/٬/g, ',').replace(/٫/g, '.');
}

function hasInstagramEngagementActions(scope: Element): boolean {
  return engagementActionIcons(scope, 'like').length > 0
    && engagementActionIcons(scope, 'comment').length > 0;
}

function hasRenderedInstagramEngagementState(scope: Element): boolean {
  const text = (scope.textContent ?? '').replace(/\s+/g, ' ');
  return /(?:no comments yet|start the conversation|لا توجد تعليقات)/i.test(text)
    || extractActionCount(scope, 'like') !== null
    || extractActionCount(scope, 'comment') !== null;
}

function findInstagramReelViewerScope(): Element | null {
  // Reel viewer pages may render the active video and toolbar without any
  // permalink anchor. Start at the first visible video and climb only until
  // its own Like/Comment toolbar is included; never use the whole <main>,
  // which can contain counters for many virtualized reels.
  const video = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
    .find((candidate) => instagramEngagementVisible(candidate));
  if (!video) return null;

  let firstActionScope: Element | null = null;
  let scope = video.parentElement;
  for (let depth = 0; scope && depth < 40; depth += 1, scope = scope.parentElement) {
    if (!hasInstagramEngagementActions(scope)) continue;
    // The first matching ancestor is the active video's own toolbar. A
    // larger ancestor may contain virtualized neighboring reels and their
    // counters, which would make extraction select unrelated numbers.
    firstActionScope = scope;
    break;
  }
  return firstActionScope;
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
    let firstActionScope: Element | null = null;
    let scope = matchingLink.parentElement;
    for (let depth = 0; scope && depth < 40; depth += 1, scope = scope.parentElement) {
      if (!hasInstagramEngagementActions(scope)) continue;
      firstActionScope ??= scope;

      // The toolbar itself can be the first ancestor with both icons. Prefer
      // the smallest ancestor that also contains a rendered counter or the
      // explicit empty-comments state, so extraction sees the whole post.
      // In the Reel viewer, a larger stateful ancestor can contain several
      // virtualized posts. Keep the smallest video-bound scope in that case.
      if (hasRenderedInstagramEngagementState(scope) && !scope.querySelector('video')) return scope;
    }
    if (firstActionScope) return firstActionScope;
    return matchingLink.closest('[role="dialog"], article, [role="article"], main') ?? matchingLink.parentElement;
  }

  const targetPath = normalizePath(targetUrl);
  if (targetPath?.match(/\/(?:reels?|p)\//i)) {
    const viewerScope = findInstagramReelViewerScope();
    if (viewerScope) return viewerScope;
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
  const normalized = normalizeEngagementNumber(raw).replace(/[,\s]/g, '').toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

function countFromText(text: string, labels: RegExp): number | null {
  const match = normalizeEngagementNumber(text).replace(/\s+/g, ' ').match(new RegExp(`(\\d+(?:[.,]\\d+)*\\s*[KMB]?)\\s+${labels.source}(?=\\s|[.!،]|$)`, 'i'));
  return match ? parseCount(match[1]) : null;
}

function numericOnly(text: string): number | null {
  const normalized = normalizeEngagementNumber(text).replace(/\s+/g, ' ').trim();
  return /^(?:\d+(?:[.,]\d+)*\s*[KMB]?)$/i.test(normalized)
    ? parseCount(normalized)
    : null;
}

function extractActionCount(scope: Element, action: 'like' | 'comment'): number | null {
  const targetIcons = engagementActionIcons(scope, action);
  const icon = targetIcons[targetIcons.length - 1];
  if (!icon) return null;
  // Read only this action's own wrapper. In Reels the Like count may be a
  // sibling button, whereas the Comment count is inside its icon button.
  // Stop before the shared toolbar; never scan later post/caption numbers.
  for (let wrapper: Element | null = icon; wrapper && scope.contains(wrapper); wrapper = wrapper.parentElement) {
    if (wrapper === scope || wrapper.querySelector('video')) break;
    if (Array.from(wrapper.querySelectorAll('svg[aria-label]')).some((other) => other !== icon)) break;
    const candidates = Array.from(wrapper.querySelectorAll<HTMLElement>('[role="button"], span'));
    for (const candidate of candidates) {
      if (!instagramEngagementVisible(candidate)) continue;
      const count = numericOnly(candidate.textContent ?? '');
      if (count !== null) return count;
    }
    // Photo counters are siblings of the span containing the icon button.
    // Only the immediately adjacent numeric-only node belongs to this action;
    // never cross the next icon, caption, or another post's toolbar.
    const adjacent = wrapper.nextElementSibling;
    if (adjacent && !adjacent.matches('svg') && !adjacent.querySelector('svg')
      && instagramEngagementVisible(adjacent)) {
      const count = numericOnly(adjacent.textContent ?? '');
      if (count !== null) return count;
    }
  }
  // Compact unwrapped toolbars place the counter immediately after the SVG.
  const sibling = icon.nextElementSibling;
  return sibling && !sibling.querySelector('svg') && instagramEngagementVisible(sibling)
    ? numericOnly(sibling.textContent ?? '') : null;
}

function collectText(scope: Element): string[] {
  // SVG <title> is an icon name, not engagement copy. Flattening it produces
  // strings like `Unlike1Comment`, incorrectly assigning the Like to Comment.
  const copy = scope.cloneNode(true) as Element;
  copy.querySelectorAll('svg').forEach((icon) => icon.remove());
  return [
    copy.textContent ?? '',
    ...Array.from(copy.querySelectorAll('span, p')).map((element) => element.textContent ?? ''),
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
    reactionCount ??= countFromText(text, /(?:likes?|reactions?|إعجاب|إعجابات)/i);
    commentCount ??= countFromText(text, /(?:comments?|تعليق|تعليقات)/i);
    if (/(?:no likes yet|be the first to like this|كن أول من يسجل إعجابه)/i.test(text)) reactionCount ??= 0;
    if (/(?:no comments yet|start the conversation|لا توجد تعليقات)/i.test(text)) commentCount ??= 0;
  }

  // Some Instagram layouts render a verified Like/Unlike control but omit the
  // numeric counter when nobody has liked the post. The product policy treats
  // that loaded, counter-less state as zero likes; a missing post scope still
  // fails separately in check().
  if (reactionCount === null && engagementActionIcons(scope, 'like').length) {
    reactionCount = 0;
  }

  // In the active Reel viewer, a rendered Like/Comment toolbar with no
  // numeric labels represents an empty engagement state. This is scoped to a
  // video container so counters from neighboring virtualized reels are never
  // interpreted as this post's values.
  if (
    commentCount === null
    && scope.querySelector('video')
    && engagementActionIcons(scope, 'comment').length
  ) {
    commentCount = 0;
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

async function check(targetUrl: string, timeoutMs = 45_000): Promise<InstagramEngagementResult> {
  const startedAt = Date.now();
  let lastProgressLogAt = startedAt;
  console.info('[PostFlow][Instagram] Waiting for engagement counters', {
    targetUrl,
    timeoutMs,
  });
  while (Date.now() - startedAt < timeoutMs) {
    const scope = findPostScope(targetUrl);
    const scopeFound = Boolean(scope);
    if (scope) {
      const result = extract(scope);
      if (result.status !== 'CHECK_FAILED') return result;
    }
    const now = Date.now();
    if (now - lastProgressLogAt >= 5_000) {
      console.info('[PostFlow][Instagram] Engagement details still rendering', {
        targetUrl,
        elapsedMs: now - startedAt,
        scopeFound,
      });
      lastProgressLogAt = now;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn('[PostFlow][Instagram] Engagement details render timeout', {
    targetUrl,
    elapsedMs: Date.now() - startedAt,
  });
  return { status: 'CHECK_FAILED', reason: 'Instagram post details did not finish rendering' };
}

const api: InstagramPostEngagementApi = { check };
(globalThis as typeof globalThis & { PostFlowInstagramEngagement?: InstagramPostEngagementApi }).PostFlowInstagramEngagement = api;

console.info('[PostFlow][Instagram] Engagement extractor ready');

type TikTokEngagementResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
  reactionCount?: number;
  commentCount?: number;
  reason?: string;
};

type TikTokPostIdentity = {
  username: string;
  kind: 'video' | 'photo';
  id: string;
};

const COUNT_SELECTORS = {
  reactionCount: ['[data-e2e="like-count"]', '[data-e2e="like-icon"]'],
  commentCount: ['[data-e2e="comment-count"]', '[data-e2e="comment-icon"]'],
} as const;

type TikTokCounterName = keyof typeof COUNT_SELECTORS;
type CounterDiagnostic = {
  value: number | null;
  source: 'count-element' | 'action-label' | 'conflict' | 'unavailable';
  countText: string[];
  actionLabels: string[];
  parsedCountValues: number[];
  parsedActionValues: number[];
};

function extractTikTokIdentity(value: string): TikTokPostIdentity | null {
  try {
    const url = new URL(value, location.href);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'tiktok.com' && hostname !== 'www.tiktok.com') return null;
    const match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d+)\/?$/i);
    if (!match) return null;
    return {
      username: match[1],
      kind: match[2].toLowerCase() as TikTokPostIdentity['kind'],
      id: match[3],
    };
  } catch {
    return null;
  }
}

function normalizeDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function parseTikTokCount(value: string): number | null {
  const normalized = normalizeDigits(value).replace(/[\u00a0\u202f]/g, ' ').trim();
  const match = normalized.match(/^(\d[\d,.]*?)\s*([KMB])?$/i);
  if (!match) return null;

  let numeric = match[1];
  const suffix = match[2]?.toUpperCase();
  if (suffix) {
    numeric = numeric.replace(',', '.');
    if ((numeric.match(/\./g) ?? []).length > 1) return null;
  } else if (/^\d{1,3}(?:[,.]\d{3})+$/.test(numeric)) {
    numeric = numeric.replace(/[,.]/g, '');
  } else if (numeric.includes(',') || numeric.includes('.')) {
    return null;
  }

  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
  const count = Math.round(parsed * multiplier);
  return Number.isSafeInteger(count) ? count : null;
}

function countFromActionLabel(value: string, counter: TikTokCounterName): number | null {
  const text = normalizeDigits(value).replace(/[\u00a0\u202f]/g, ' ');
  const suffix = '(\\d[\\d,.]*\\s*[KMB]?)';
  const labels: Record<TikTokCounterName, RegExp> = {
    reactionCount: new RegExp(`${suffix}\\s*(?:likes?)`, 'i'),
    commentCount: new RegExp(`${suffix}\\s*(?:comments?)`, 'i'),
  };
  const match = text.match(labels[counter]);
  return match ? parseTikTokCount(match[1]) : null;
}

function elementText(element: Element): string[] {
  return [
    element.textContent ?? '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
  ];
}

function readCounter(post: Element, counter: TikTokCounterName): CounterDiagnostic {
  const selectors = COUNT_SELECTORS[counter];
  const countElementSelector = selectors[0];
  const actionElementSelector = selectors[1];
  const countElements = Array.from(post.querySelectorAll<HTMLElement>(countElementSelector));
  const countText = countElements.flatMap(elementText).map((value) => value.trim()).filter(Boolean);
  const parsedCountValues = countText.map(parseTikTokCount).filter((value): value is number => value !== null);
  if (parsedCountValues.length) {
    const unique = [...new Set(parsedCountValues)];
    return {
      value: unique.length === 1 ? unique[0] : null,
      source: unique.length === 1 ? 'count-element' : 'conflict',
      countText,
      actionLabels: [],
      parsedCountValues,
      parsedActionValues: [],
    };
  }

  const actionElements = Array.from(post.querySelectorAll<HTMLElement>(actionElementSelector));
  const actionLabels = actionElements.flatMap(elementText).map((value) => value.trim()).filter(Boolean);
  const actionCounts = actionLabels.map((value) => countFromActionLabel(value, counter))
    .filter((value): value is number => value !== null);
  const unique = [...new Set(actionCounts)];
  return {
    value: unique.length === 1 ? unique[0] : null,
    source: unique.length > 1 ? 'conflict' : unique.length === 1 ? 'action-label' : 'unavailable',
    countText,
    actionLabels,
    parsedCountValues,
    parsedActionValues: actionCounts,
  };
}

function closestPostContainer(element: Element): Element | null {
  return element.closest('[data-e2e="recommend-list-item-container"], article');
}

function findTargetPost(identity: TikTokPostIdentity): Element | null {
  const containers = new Set<Element>();
  for (const marker of Array.from(document.querySelectorAll<HTMLElement>(
    '[data-video-id], [id^="xgwrapper-"], [data-more-menu-item-id], a[href]',
  ))) {
    const videoId = marker.getAttribute('data-video-id') ?? '';
    const idMatch = marker.id.match(/^xgwrapper-\d+-(\d+)$/)?.[1] ?? '';
    const menuItemId = marker.getAttribute('data-more-menu-item-id') ?? '';
    const linkIdentity = marker.tagName === 'A'
      ? extractTikTokIdentity((marker as HTMLAnchorElement).href)
      : null;
    const matches = videoId === identity.id || idMatch === identity.id || menuItemId === identity.id || Boolean(
      linkIdentity && linkIdentity.id === identity.id && linkIdentity.kind === identity.kind,
    );
    if (!matches) continue;
    const container = closestPostContainer(marker);
    if (container) containers.add(container);
  }
  if (containers.size === 1) return [...containers][0];
  if (containers.size > 1) return null;

  // Photo permalinks can render the action bar without an article wrapper or
  // a permalink/video ID marker. On the exact requested permalink, accept one
  // uniquely identifiable like/comment action bar as the post container.
  const current = extractTikTokIdentity(location.href);
  if (current && current.id === identity.id && current.kind === identity.kind &&
    current.username.toLowerCase() === identity.username.toLowerCase()) {
    const actionBars = new Set<Element>();
    for (const likeCount of Array.from(document.querySelectorAll<HTMLElement>(COUNT_SELECTORS.reactionCount[0]))) {
      let ancestor = likeCount.parentElement;
      for (let depth = 0; ancestor && depth < 12; depth += 1, ancestor = ancestor.parentElement) {
        const hasOneLike = ancestor.querySelectorAll(COUNT_SELECTORS.reactionCount[0]).length === 1;
        const hasOneComment = ancestor.querySelectorAll(COUNT_SELECTORS.commentCount[0]).length === 1;
        const hasLikeAction = Boolean(ancestor.querySelector(COUNT_SELECTORS.reactionCount[1]));
        const hasCommentAction = Boolean(ancestor.querySelector(COUNT_SELECTORS.commentCount[1]));
        if (hasOneLike && hasOneComment && hasLikeAction && hasCommentAction) {
          actionBars.add(ancestor);
          break;
        }
      }
    }
    if (actionBars.size === 1) return [...actionBars][0];
  }

  // On a direct permalink page TikTok sometimes omits a permalink anchor and
  // the xgplayer ID. Accept the lone post card only; never guess among a feed.
  const cards = Array.from(document.querySelectorAll('[data-e2e="recommend-list-item-container"], article'));
  return cards.length === 1 ? cards[0] : null;
}

function readResult(post: Element): { result: TikTokEngagementResult; counters: Record<TikTokCounterName, CounterDiagnostic> } {
  const counters = {
    reactionCount: readCounter(post, 'reactionCount'),
    commentCount: readCounter(post, 'commentCount'),
  };
  const reactionCount = counters.reactionCount.value;
  const commentCount = counters.commentCount.value;
  const result = {
    ...(reactionCount !== null ? { reactionCount } : {}),
    ...(commentCount !== null ? { commentCount } : {}),
  };
  const count = Object.keys(result).length;
  if (count === 2) return { result: { status: 'SUCCESS', ...result }, counters };
  if (count > 0) return { result: { status: 'PARTIAL', ...result, reason: 'TikTok did not expose both likes and comments' }, counters };
  return { result: { status: 'CHECK_FAILED', reason: 'TikTok engagement counters were not detected' }, counters };
}

function logInspection(target: TikTokPostIdentity, post: Element, counters: Record<TikTokCounterName, CounterDiagnostic>, result: TikTokEngagementResult): void {
  const postIds = Array.from(post.querySelectorAll<HTMLElement>('[data-more-menu-item-id], [data-video-id], [id^="xgwrapper-"]'))
    .map((element) => element.getAttribute('data-more-menu-item-id') ?? element.getAttribute('data-video-id') ?? element.id)
    .filter(Boolean);
  globalThis.console?.info('[PostFlow][TikTok] Engagement counters inspected', {
    target: { username: target.username, kind: target.kind, id: target.id },
    currentUrl: location.href,
    selectedCard: { id: post.id || null, e2e: post.getAttribute('data-e2e'), postIds: [...new Set(postIds)] },
    counters,
    result,
  });
}

async function checkTikTokPostEngagement(targetUrl: string, timeoutMs = 20_000): Promise<TikTokEngagementResult> {
  const target = extractTikTokIdentity(targetUrl);
  const current = extractTikTokIdentity(location.href);
  if (!target) return { status: 'CHECK_FAILED', reason: 'Stored TikTok post URL is invalid' };
  if (!current || current.id !== target.id || current.kind !== target.kind || current.username.toLowerCase() !== target.username.toLowerCase()) {
    return { status: 'CHECK_FAILED', reason: 'TikTok page does not match the requested post' };
  }

  const startedAt = Date.now();
  let partial: TikTokEngagementResult | null = null;
  let partialSince: number | null = null;
  let partialSignature = '';
  let lastInspection: { post: Element; counters: Record<TikTokCounterName, CounterDiagnostic>; result: TikTokEngagementResult } | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const post = findTargetPost(target);
    if (post) {
      const inspection = readResult(post);
      const result = inspection.result;
      lastInspection = { post, ...inspection };
      if (result.status === 'SUCCESS') {
        logInspection(target, post, inspection.counters, result);
        return result;
      }
      if (result.status === 'PARTIAL') {
        const signature = JSON.stringify(result);
        if (signature !== partialSignature) {
          partialSince = Date.now();
          partialSignature = signature;
        }
        partial = result;
        if (partialSince !== null && Date.now() - partialSince >= 1_500) {
          logInspection(target, post, inspection.counters, result);
          return result;
        }
      } else {
        partial = null;
        partialSince = null;
        partialSignature = '';
      }
    } else {
      partial = null;
      partialSince = null;
      partialSignature = '';
      lastInspection = null;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  const result = partial ?? { status: 'CHECK_FAILED' as const, reason: 'TikTok engagement counters were not detected' };
  if (lastInspection) logInspection(target, lastInspection.post, lastInspection.counters, result);
  else globalThis.console?.warn('[PostFlow][TikTok] Engagement target card not found', { target, currentUrl: location.href });
  return result;
}

const tikTokEngagementHelpers = {
  check: checkTikTokPostEngagement,
  parseTikTokCount,
  extractTikTokIdentity,
};
(globalThis as typeof globalThis & { PostFlowTikTokEngagement?: typeof tikTokEngagementHelpers }).PostFlowTikTokEngagement = tikTokEngagementHelpers;

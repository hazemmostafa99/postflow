type TikTokEngagementResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
  reactionCount?: number;
  commentCount?: number;
  favoriteCount?: number;
  shareCount?: number;
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
  favoriteCount: ['[data-e2e="favorite-count"]', '[data-e2e="favorite-icon"]'],
  shareCount: ['[data-e2e="share-count"]', '[data-e2e="share-icon"]'],
} as const;

type TikTokCounterName = keyof typeof COUNT_SELECTORS;

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
    favoriteCount: new RegExp(`${suffix}\\s*(?:(?:added\\s+to\\s+)?favorites?)`, 'i'),
    shareCount: new RegExp(`${suffix}\\s*(?:shares?)`, 'i'),
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

function readCounter(post: Element, counter: TikTokCounterName): number | null {
  const selectors = COUNT_SELECTORS[counter];
  const countElementSelector = selectors[0];
  const actionElementSelector = selectors[1];
  const countElements = Array.from(post.querySelectorAll<HTMLElement>(countElementSelector));
  const values = countElements.flatMap(elementText).map(parseTikTokCount).filter((value): value is number => value !== null);
  if (values.length) return new Set(values).size === 1 ? values[0] : null;

  const actionElements = Array.from(post.querySelectorAll<HTMLElement>(actionElementSelector));
  const actionCounts = actionElements.flatMap((element) =>
    elementText(element).map((value) => countFromActionLabel(value, counter)),
  ).filter((value): value is number => value !== null);
  return actionCounts.length && new Set(actionCounts).size === 1 ? actionCounts[0] : null;
}

function closestPostContainer(element: Element): Element | null {
  return element.closest('[data-e2e="recommend-list-item-container"], article');
}

function findTargetPost(identity: TikTokPostIdentity): Element | null {
  const containers = new Set<Element>();
  for (const marker of Array.from(document.querySelectorAll<HTMLElement>('[data-video-id], [id^="xgwrapper-"], a[href]'))) {
    const videoId = marker.getAttribute('data-video-id') ?? '';
    const idMatch = marker.id.match(/^xgwrapper-\d+-(\d+)$/)?.[1] ?? '';
    const linkIdentity = marker.tagName === 'A'
      ? extractTikTokIdentity((marker as HTMLAnchorElement).href)
      : null;
    const matches = videoId === identity.id || idMatch === identity.id || Boolean(
      linkIdentity && linkIdentity.id === identity.id && linkIdentity.kind === identity.kind,
    );
    if (!matches) continue;
    const container = closestPostContainer(marker);
    if (container) containers.add(container);
  }
  if (containers.size === 1) return [...containers][0];
  if (containers.size > 1) return null;

  // On a direct permalink page TikTok sometimes omits a permalink anchor and
  // the xgplayer ID. Accept the lone post card only; never guess among a feed.
  const cards = Array.from(document.querySelectorAll('[data-e2e="recommend-list-item-container"], article'));
  return cards.length === 1 ? cards[0] : null;
}

function readResult(post: Element): TikTokEngagementResult {
  const reactionCount = readCounter(post, 'reactionCount');
  const commentCount = readCounter(post, 'commentCount');
  const favoriteCount = readCounter(post, 'favoriteCount');
  const shareCount = readCounter(post, 'shareCount');
  const result = {
    ...(reactionCount !== null ? { reactionCount } : {}),
    ...(commentCount !== null ? { commentCount } : {}),
    ...(favoriteCount !== null ? { favoriteCount } : {}),
    ...(shareCount !== null ? { shareCount } : {}),
  };
  const count = Object.keys(result).length;
  if (count === 4) return { status: 'SUCCESS', ...result };
  if (count > 0) return { status: 'PARTIAL', ...result, reason: 'TikTok did not expose every engagement counter' };
  return { status: 'CHECK_FAILED', reason: 'TikTok engagement counters were not detected' };
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
  while (Date.now() - startedAt < timeoutMs) {
    const post = findTargetPost(target);
    if (post) {
      const result = readResult(post);
      if (result.status === 'SUCCESS') return result;
      if (result.status === 'PARTIAL') {
        partial = result;
        partialSince ??= Date.now();
        if (Date.now() - partialSince >= 1_500) return partial;
      } else {
        partialSince = null;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return partial ?? { status: 'CHECK_FAILED', reason: 'TikTok engagement counters were not detected' };
}

const tikTokEngagementHelpers = {
  check: checkTikTokPostEngagement,
  parseTikTokCount,
  extractTikTokIdentity,
};
(globalThis as typeof globalThis & { PostFlowTikTokEngagement?: typeof tikTokEngagementHelpers }).PostFlowTikTokEngagement = tikTokEngagementHelpers;

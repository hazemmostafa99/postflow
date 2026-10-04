export type EngagementSyncMode = 'AUTOMATIC' | 'MANUAL';

export type EngagementTabBehavior = {
  initiallyActive: false;
  allowForegroundRetry: boolean;
};

export function getEngagementTabBehavior(
  mode: EngagementSyncMode,
): EngagementTabBehavior {
  return {
    initiallyActive: false,
    allowForegroundRetry: mode === 'MANUAL',
  };
}

/** Accept only a URL that identifies one Facebook post or video. */
export function normalizeFacebookEngagementPermalink(
  value: string,
): string | null {
  const markdownMatch = value
    .trim()
    .match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  const candidate = markdownMatch?.[1] ?? value.trim();

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com')) {
      return null;
    }

    const path = url.pathname;
    const supportedPath =
      /^\/groups\/[^/]+\/(?:posts|permalink)\/[A-Za-z0-9_-]+\/?$/i.test(
        path,
      ) ||
      /^\/(?:reel|share\/v)\/[A-Za-z0-9_-]+\/?$/i.test(path) ||
      /^\/[^/]+\/posts\/[A-Za-z0-9_-]+\/?$/i.test(path) ||
      (path.toLowerCase() === '/permalink.php' &&
        Boolean(url.searchParams.get('story_fbid') ?? url.searchParams.get('fbid'))) ||
      (/^\/watch\/?$/i.test(path) && Boolean(url.searchParams.get('v')));

    return supportedPath ? url.href : null;
  } catch {
    return null;
  }
}

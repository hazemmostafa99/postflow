export type TikTokAnalyticsTargetType = 'TIKTOK_VIDEO' | 'TIKTOK_PHOTO';

/** Normalize stored TikTok URLs to the route matching the published media type. */
export function normalizeTikTokAnalyticsPermalink(
  value: string,
  targetType?: TikTokAnalyticsTargetType,
): string | null {
  const markdownMatch = value.trim().match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  const candidate = markdownMatch?.[1] ?? value.trim();
  try {
    const url = new URL(candidate);
    if (!['www.tiktok.com', 'tiktok.com'].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d+)\/?$/i);
    if (!match || url.protocol !== 'https:' || url.username || url.password) return null;
    const kind = targetType === 'TIKTOK_PHOTO'
      ? 'photo'
      : targetType === 'TIKTOK_VIDEO'
        ? 'video'
        : match[2].toLowerCase();
    return `https://www.tiktok.com/@${match[1]}/${kind}/${match[3]}`;
  } catch {
    return null;
  }
}

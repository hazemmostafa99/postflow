export function normalizeInstagramPostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) {
      return null;
    }
    if (!/^\/(p|reel)\/[^/]+\/?$/i.test(url.pathname)) return null;
    return `https://www.instagram.com${url.pathname.replace(/\/$/, '')}/`;
  } catch {
    return null;
  }
}

export function isInstagramSuccessNotice(value: string): boolean {
  return /your post has been shared|post shared|تمت مشاركة|تم نشر/i.test(value);
}

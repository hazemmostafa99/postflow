export function normalizeTikTokPostUrl(value: string, expectedUsername?: string): string | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d+)\/?$/);
    if (url.protocol !== 'https:' || !['www.tiktok.com', 'tiktok.com'].includes(url.hostname) ||
      url.username || url.password || !match ||
      (expectedUsername && match[1].toLowerCase() !== expectedUsername.toLowerCase())) return null;
    return `https://www.tiktok.com/@${match[1]}/${match[2].toLowerCase()}/${match[3]}`;
  } catch { return null; }
}

export function isTikTokUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.tiktok.com' && !url.username && !url.password &&
      /^\/(?:tiktokstudio\/upload|creator-center\/upload|upload)\/?$/.test(url.pathname);
  } catch { return false; }
}

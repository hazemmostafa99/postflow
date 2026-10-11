export function normalizeInstagramPostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) {
      return null;
    }
    const match = url.pathname.match(/^\/(?:[^/]+\/)?(p|reels?)\/([^/]+)\/?$/i);
    if (!match) return null;
    const kind = match[1].toLowerCase() === 'p' ? 'p' : 'reel';
    return `https://www.instagram.com/${kind}/${match[2]}/`;
  } catch {
    return null;
  }
}

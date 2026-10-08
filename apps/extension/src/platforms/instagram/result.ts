export function normalizeInstagramPostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) {
      return null;
    }
    const match = url.pathname.match(/^\/(?:[^/]+\/)?(p|reel)\/([^/]+)\/?$/i);
    if (!match) return null;
    return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
  } catch {
    return null;
  }
}

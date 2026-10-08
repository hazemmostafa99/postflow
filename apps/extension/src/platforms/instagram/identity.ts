type InstagramIdentityDetection = {
  sessionDetected: boolean;
  externalUsername?: string;
  source: 'canonical' | 'open-graph' | 'profile-link' | 'pathname' | 'none';
};

const RESERVED_INSTAGRAM_PATHS = new Set([
  'accounts',
  'direct',
  'directory',
  'emails',
  'explore',
  'legal',
  'reels',
  'p',
  'privacy',
  'session',
  'settings',
  'stories',
  'web',
]);

function normalizeUsername(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('/') || RESERVED_INSTAGRAM_PATHS.has(normalized.toLowerCase())) {
    return undefined;
  }
  return /^[A-Za-z0-9._]+$/.test(normalized) ? normalized : undefined;
}

function usernameFromUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (url.hostname !== 'instagram.com' && !url.hostname.endsWith('.instagram.com')) {
      return undefined;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1 ? normalizeUsername(segments[0]) : undefined;
  } catch {
    return undefined;
  }
}

function findFromLinks(documentRef: Document): string | undefined {
  const links = Array.from(
    documentRef.querySelectorAll<HTMLAnchorElement>(
      'header a[href], nav a[href], [role="navigation"] a[href]',
    ),
  );
  for (const link of links) {
    const username = usernameFromUrl(link.href);
    if (username && (link.getAttribute('aria-label') || link.title || link.textContent?.trim())) {
      return username;
    }
  }
  return undefined;
}

function detectInstagramIdentity(documentRef: Document = document): InstagramIdentityDetection {
  const canonical = documentRef.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const canonicalUsername = usernameFromUrl(canonical?.href);
  if (canonicalUsername) {
    return { sessionDetected: true, externalUsername: canonicalUsername, source: 'canonical' };
  }

  const openGraph = documentRef.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  const openGraphUsername = usernameFromUrl(openGraph?.content);
  if (openGraphUsername) {
    return { sessionDetected: true, externalUsername: openGraphUsername, source: 'open-graph' };
  }

  const profileLinkUsername = findFromLinks(documentRef);
  if (profileLinkUsername) {
    return { sessionDetected: true, externalUsername: profileLinkUsername, source: 'profile-link' };
  }

  const pathnameUsername = usernameFromUrl(window.location.href);
  if (pathnameUsername) {
    return { sessionDetected: true, externalUsername: pathnameUsername, source: 'pathname' };
  }

  return { sessionDetected: false, source: 'none' };
}

// Content scripts are loaded as classic scripts by the MV3 manifest. Expose
// the pure detector through a small typed global instead of bundling imports.
(globalThis as typeof globalThis & {
  PostFlowInstagramIdentity?: { detect: typeof detectInstagramIdentity };
}).PostFlowInstagramIdentity = { detect: detectInstagramIdentity };

type InstagramIdentityDetection = {
  evidenceState: 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED';
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
  'reel',
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
  // Instagram's authenticated home page often renders the sidebar as divs
  // instead of a semantic <nav>. Prefer an explicitly labelled Profile link
  // anywhere in the document before considering generic navigation links.
  const labelledLinks = Array.from(
    documentRef.querySelectorAll<HTMLAnchorElement>('a[href]'),
  );
  for (const link of labelledLinks) {
    const username = usernameFromUrl(link.href);
    if (!username) continue;
    const labels = [
      link.getAttribute('aria-label'),
      link.title,
      link.textContent,
      ...Array.from(link.querySelectorAll('[aria-label], svg title')).map((node) => node.getAttribute('aria-label') || node.textContent),
    ].filter(Boolean).map((value) => value!.replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E]/g, '').trim().toLowerCase());
    if (labels.some((label) => /\u0645\u0644\u0641|\u0627\u0644\u0634\u062e\u0635\u064a/u.test(label))) return username;
    if (labels.some((label) => /^(?:profile|your profile|الملف الشخصي|ملفك الشخصي)$/.test(label))) return username;
  }

  const links = Array.from(
    documentRef.querySelectorAll<HTMLAnchorElement>(
      'header a[href], nav a[href], [role="navigation"] a[href]',
    ),
  );
  for (const link of links) {
    const username = usernameFromUrl(link.href);
    // Avatar fallback is navigation-only: a post author's profile picture
    // elsewhere in the page must never identify the signed-in account.
    const avatarAlt = Array.from(link.querySelectorAll<HTMLImageElement>('img[alt]'))
      .map((image) => image.getAttribute('alt') || '')
      .join(' ')
      .toLowerCase();
    if (username && /\u0645\u0644\u0641|\u0627\u0644\u0634\u062e\u0635\u064a/u.test(avatarAlt)) return username;
    if (username && link.querySelector('img[alt*="profile" i], img[alt*="الملف الشخصي"]')) {
      return username;
    }
  }
  return undefined;
}

function detectInstagramIdentity(documentRef: Document = document): InstagramIdentityDetection {
  if (/^\/accounts\/login(?:\/|$)/i.test(window.location.pathname)) {
    return { evidenceState: 'LOGIN_REQUIRED', sessionDetected: false, source: 'none' };
  }
  const profileLinkUsername = findFromLinks(documentRef);
  if (profileLinkUsername) {
    return { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: profileLinkUsername, source: 'profile-link' };
  }

  // Public profile metadata identifies the page owner, not the viewer. Only
  // use it on a self-profile with the Edit profile control.
  const ownProfile = Array.from(documentRef.querySelectorAll('a[href], button, [role="button"]'))
    .some((node) => /^(?:edit profile|تعديل الملف الشخصي|تعديل ملفك الشخصي)$/i.test((node.textContent ?? '').trim())
      || node.getAttribute('href')?.startsWith('/accounts/edit'));
  if (!ownProfile) return { evidenceState: 'CHECKING', sessionDetected: false, source: 'none' };
  const canonical = documentRef.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const canonicalUsername = usernameFromUrl(canonical?.href);
  if (canonicalUsername) {
    return { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: canonicalUsername, source: 'canonical' };
  }

  const openGraph = documentRef.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  const openGraphUsername = usernameFromUrl(openGraph?.content);
  if (openGraphUsername) {
    return { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: openGraphUsername, source: 'open-graph' };
  }

  const pathnameUsername = usernameFromUrl(window.location.href);
  if (pathnameUsername) {
    return { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: pathnameUsername, source: 'pathname' };
  }

  return { evidenceState: 'CHECKING', sessionDetected: false, source: 'none' };
}

function getInstagramProfileUrl(documentRef: Document = document): string | undefined {
  const identity = detectInstagramIdentity(documentRef);
  if (!identity.externalUsername) return undefined;
  return `https://www.instagram.com/${encodeURIComponent(identity.externalUsername)}/`;
}

// Content scripts are loaded as classic scripts by the MV3 manifest. Expose
// the pure detector through a small typed global instead of bundling imports.
(globalThis as typeof globalThis & {
  PostFlowInstagramIdentity?: {
    detect: typeof detectInstagramIdentity;
    getProfileUrl: typeof getInstagramProfileUrl;
  };
}).PostFlowInstagramIdentity = { detect: detectInstagramIdentity, getProfileUrl: getInstagramProfileUrl };

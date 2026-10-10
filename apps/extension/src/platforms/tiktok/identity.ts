type TikTokIdentityDetection = {
  evidenceState: 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED';
  sessionDetected: boolean;
  externalUsername?: string;
  source: 'profile-link' | 'pathname' | 'none';
};

type TikTokIdentityDiagnostics = {
  pathname: string;
  profileLinkCount: number;
  profileNavigationLinkCount: number;
  profileControlCount: number;
  editProfileControlCount: number;
};

const TIKTOK_PROFILE_LABEL = /^(?:profile|view profile|your profile|الملف الشخصي|ملفك الشخصي)$/i;
const TIKTOK_EDIT_PROFILE_LABEL = /^(?:edit profile|تعديل الملف الشخصي|تعديل ملفك الشخصي)$/i;

function normalizeTikTokUsername(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim().replace(/^@/, '');
  return normalized && /^[A-Za-z0-9._]{1,24}$/.test(normalized)
    ? normalized
    : undefined;
}

function tiktokUsernameFromUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (url.hostname !== 'tiktok.com' && !url.hostname.endsWith('.tiktok.com')) {
      return undefined;
    }
    const match = decodeURIComponent(url.pathname).match(/^\/@([^/]+)\/?$/);
    return normalizeTikTokUsername(match?.[1]);
  } catch {
    return undefined;
  }
}

function normalizedLabels(node: Element): string[] {
  return [
    node.getAttribute('aria-label'),
    node.getAttribute('title'),
    node.textContent,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().replace(/\s+/g, ' '));
}

function findOwnProfileLink(documentRef: Document): string | undefined {
  const links = Array.from(
    documentRef.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]'),
  );
  for (const link of links) {
    const username = tiktokUsernameFromUrl(link.href);
    if (!username) continue;
    const dataE2e = link.getAttribute('data-e2e')?.toLowerCase() ?? '';
    const explicitlyProfile =
      /(?:nav-)?profile|profile-entrance|avatar/.test(dataE2e) ||
      normalizedLabels(link).some((label) =>
        TIKTOK_PROFILE_LABEL.test(label) || /\bprofile\b/i.test(label),
      );
    const inViewerNavigation = Boolean(
      link.closest(
        'header, nav, aside, [role="navigation"], [data-e2e*="nav"], [data-e2e*="profile"], [data-e2e*="avatar"]',
      ),
    );
    if (explicitlyProfile || (inViewerNavigation && link.querySelector('img'))) {
      return username;
    }
  }
  return undefined;
}

function findProfileControlIdentity(documentRef: Document): string | undefined {
  const controls = Array.from(
    documentRef.querySelectorAll<HTMLElement>(
      '[data-e2e*="profile"], [data-e2e*="avatar"], [aria-label*="profile" i], [title*="profile" i]',
    ),
  );
  for (const control of controls) {
    const inViewerNavigation = Boolean(
      control.closest('header, nav, aside, [role="navigation"], [data-e2e*="nav"]'),
    );
    if (!inViewerNavigation && !/profile|avatar/i.test(control.getAttribute('data-e2e') ?? '')) continue;
    const linkedUsername = tiktokUsernameFromUrl(control.closest('a[href*="/@"]')?.getAttribute('href'));
    if (linkedUsername) return linkedUsername;
    const labels = normalizedLabels(control).join(' ');
    const match = labels.match(/@([A-Za-z0-9._]{1,24})/);
    const username = normalizeTikTokUsername(match?.[1]);
    if (username) return username;
  }
  return undefined;
}

function isOwnProfile(documentRef: Document): boolean {
  return Array.from(
    documentRef.querySelectorAll('button, a[href], [role="button"], [data-testid]'),
  ).some((node) => {
    const dataE2e = node.getAttribute('data-e2e')?.toLowerCase() ?? '';
    const testId = node.getAttribute('data-testid')?.toLowerCase() ?? '';
    const editProfileMarker = /edit[\s_-]*profile/.test(`${dataE2e} ${testId}`);
    return editProfileMarker || normalizedLabels(node).some((label) =>
      TIKTOK_EDIT_PROFILE_LABEL.test(label) ||
      /\bedit\s+profile\b/i.test(label),
    );
  });
}

function detectTikTokIdentity(
  documentRef: Document = document,
): TikTokIdentityDetection {
  if (/^\/(?:login|signup)(?:\/|$)/i.test(window.location.pathname)) {
    return {
      evidenceState: 'LOGIN_REQUIRED',
      sessionDetected: false,
      source: 'none',
    };
  }
  const profileLinkUsername = findOwnProfileLink(documentRef);
  if (profileLinkUsername) {
    return {
      evidenceState: 'VERIFIED',
      sessionDetected: true,
      externalUsername: profileLinkUsername,
      source: 'profile-link',
    };
  }
  const profileControlUsername = findProfileControlIdentity(documentRef);
  if (profileControlUsername) {
    return {
      evidenceState: 'VERIFIED',
      sessionDetected: true,
      externalUsername: profileControlUsername,
      source: 'profile-link',
    };
  }
  if (isOwnProfile(documentRef)) {
    const pathnameUsername = tiktokUsernameFromUrl(window.location.href);
    if (pathnameUsername) {
      return {
        evidenceState: 'VERIFIED',
        sessionDetected: true,
        externalUsername: pathnameUsername,
        source: 'pathname',
      };
    }
  }
  return {
    evidenceState: 'CHECKING',
    sessionDetected: false,
    source: 'none',
  };
}

function identityDiagnostics(
  documentRef: Document = document,
): TikTokIdentityDiagnostics {
  const profileLinks = Array.from(
    documentRef.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]'),
  );
  const profileControls = Array.from(
    documentRef.querySelectorAll<HTMLElement>(
      '[data-e2e*="profile"], [data-e2e*="avatar"], [aria-label*="profile" i], [title*="profile" i]',
    ),
  );
  const editProfileControls = Array.from(
    documentRef.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [data-testid]'),
  ).filter((node) => {
    const marker = `${node.getAttribute('data-e2e') ?? ''} ${node.getAttribute('data-testid') ?? ''}`;
    return /edit[\s_-]*profile/i.test(marker) ||
      normalizedLabels(node).some((label) =>
        TIKTOK_EDIT_PROFILE_LABEL.test(label) || /\bedit\s+profile\b/i.test(label),
      );
  });
  return {
    pathname: window.location.pathname,
    profileLinkCount: profileLinks.length,
    profileNavigationLinkCount: profileLinks.filter((link) => Boolean(
      link.closest('header, nav, aside, [role="navigation"], [data-e2e*="nav"], [data-e2e*="profile"], [data-e2e*="avatar"]'),
    )).length,
    profileControlCount: profileControls.length,
    editProfileControlCount: editProfileControls.length,
  };
}

(globalThis as typeof globalThis & {
  PostFlowTikTokIdentity?: {
    detect: typeof detectTikTokIdentity;
    diagnostics: typeof identityDiagnostics;
  };
}).PostFlowTikTokIdentity = {
  detect: detectTikTokIdentity,
  diagnostics: identityDiagnostics,
};

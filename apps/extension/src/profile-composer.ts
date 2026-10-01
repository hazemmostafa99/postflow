interface ProfileFeedTarget {
  type: 'PROFILE_FEED';
  facebookConnectionId: string;
  facebookUserId: string;
  name?: string;
  url: string;
}

const PROFILE_COMPOSER_TEXTS = [
  "what's on your mind",
  'what are you thinking',
  'write something',
  'write a public post',
  'post something',
  'create a post',
  'share an update',
  '\u0628\u0645 \u062a\u0641\u0643\u0631',
  '\u0645\u0627 \u0627\u0644\u0630\u064a \u064a\u062f\u0648\u0631',
  '\u0645\u0627\u0630\u0627 \u064a\u062f\u0648\u0631',
  '\u0645\u0627\u0630\u0627 \u064a\u062e\u0637\u0631 \u0628\u0628\u0627\u0644\u0643',
  '\u0627\u0643\u062a\u0628 \u0634\u064a\u0621',
  '\u0627\u0643\u062a\u0628 \u0634\u064a\u0626',
];

const PROFILE_COMPOSER_SURFACE_SELECTOR = '[data-pagelet="ProfileComposer"]';
const PROFILE_COMPOSER_TRIGGER_SELECTOR = '[role="button"], button, [aria-label], [aria-placeholder]';

function isVisibleProfileComposerElement(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function profileComposerTextMatches(element: HTMLElement): boolean {
  const text = [
    element.getAttribute('aria-label'),
    element.getAttribute('aria-placeholder'),
    element.textContent,
  ].filter(Boolean).join(' ').trim().toLowerCase();
  return PROFILE_COMPOSER_TEXTS.some((candidate) => text.includes(candidate.toLowerCase()));
}

function isProfileComposerCandidate(element: HTMLElement): boolean {
  if (!isVisibleProfileComposerElement(element)) return false;
  const insideProfileComposerSurface = Boolean(element.closest(PROFILE_COMPOSER_SURFACE_SELECTOR));
  if (element.closest('[role="dialog"], [aria-modal="true"]')) return false;
  if (!insideProfileComposerSurface && element.closest('[role="article"]')) return false;
  const labels = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
  return !['story', 'reel', 'audience', 'privacy'].some((value) => labels.includes(value));
}

function getProfileComposerSearchRoots(root: ParentNode): ParentNode[] {
  const main = root.querySelector?.('[role="main"]') ?? root;
  const surfaces = Array.from(main.querySelectorAll<HTMLElement>(PROFILE_COMPOSER_SURFACE_SELECTOR));
  const rootElement = root as HTMLElement;
  if (typeof rootElement.matches === 'function' && rootElement.matches(PROFILE_COMPOSER_SURFACE_SELECTOR)) {
    surfaces.unshift(rootElement);
  }
  return surfaces.length ? surfaces : [main];
}

// Confirms the page is the canonical profile feed chosen by the API, not a
// similarly shaped profile or a generic Facebook feed.
function isExpectedProfileFeed(target: ProfileFeedTarget, href = window.location.href): boolean {
  if (!/^\d+$/.test(target.facebookUserId)) return false;
  try {
    const url = new URL(href, window.location.origin);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (hostname === 'www.facebook.com' || hostname === 'facebook.com') &&
      url.pathname === '/profile.php' &&
      url.searchParams.get('id') === target.facebookUserId
    );
  } catch {
    return false;
  }
}

// Uses profile-only semantic candidates and never falls back to GroupInlineComposer.
function findProfileComposerTrigger(root: ParentNode = document): HTMLElement | null {
  for (const searchRoot of getProfileComposerSearchRoots(root)) {
    const candidates = Array.from(searchRoot.querySelectorAll<HTMLElement>(PROFILE_COMPOSER_TRIGGER_SELECTOR));
    const trigger = candidates.find((candidate) =>
      isProfileComposerCandidate(candidate) && profileComposerTextMatches(candidate),
    );
    if (trigger) return trigger;
  }
  return null;
}

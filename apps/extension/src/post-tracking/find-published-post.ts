interface FindPublishedPostOptions {
  root?: ParentNode;
  submittedText: string;
  submittedAt: number;
  /** Capture visible post elements before clicking Post. */
  existingPostElements?: ReadonlySet<Element>;
  /** Capture post permalinks before clicking Post; Facebook may re-render old nodes. */
  existingPostUrls?: ReadonlySet<string>;
  submittedMediaCount?: number;
  currentGroupId?: string;
}

interface PublishedPostMatch {
  element: HTMLElement;
  postUrl?: string;
}

const POST_SELECTOR = '[role="article"], [data-pagelet*="FeedUnit"]';

function normalizePostText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisiblePostElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

/** Match text while tolerating Facebook whitespace changes and truncation. */
function isSubmittedPostMatch(
  postElement: Element,
  submittedText: string,
  submittedMediaCount = 0,
): boolean {
  const submitted = normalizePostText(submittedText);
  const candidate = normalizePostText(postElement.textContent ?? "");
  if (!submitted) {
    return submittedMediaCount > 0 && Boolean(postElement.querySelector('img, video'));
  }
  if (!candidate) return false;
  if (candidate.includes(submitted)) return true;

  const minimumComparableLength = Math.min(40, Math.ceil(submitted.length * 0.6));
  if (candidate.length < minimumComparableLength) return false;
  return submitted.includes(candidate.slice(0, minimumComparableLength));
}

function extractPostTimestamp(postElement: Element): number | null {
  const datetime = postElement.querySelector("time[datetime]")?.getAttribute("datetime");
  if (datetime) {
    const timestamp = Date.parse(datetime);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  const unixValue = postElement.querySelector("[data-utime]")?.getAttribute("data-utime");
  if (unixValue && /^\d+$/.test(unixValue)) {
    const timestamp = Number(unixValue) * 1000;
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "facebook.com" || host.endsWith(".facebook.com");
}

function getCurrentFacebookGroupId(): string | undefined {
  try {
    return window.location.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1];
  } catch {
    return undefined;
  }
}

function normalizeGroupId(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed, window.location.origin);
    const fromPath = url.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1];
    return (fromPath ?? trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Facebook can identify the same group with a numeric id in the API and a
 * vanity slug in the permalink. Keep the page's group segment as an alias so
 * a valid permalink is not discarded as belonging to another group.
 */
function getGroupIdAliases(currentGroupId?: string): Set<string> {
  const aliases = new Set<string>();
  const requested = normalizeGroupId(currentGroupId);
  const current = normalizeGroupId(getCurrentFacebookGroupId());
  if (requested) aliases.add(requested);
  if (current) aliases.add(current);
  return aliases;
}

function normalizeFacebookGroupPostUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (!isFacebookHost(url.hostname)) return null;
    const match = url.pathname.match(/^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)/i);
    if (!match) return null;
    return `https://www.facebook.com/groups/${match[1]}/${match[2]}/${match[3]}/`;
  } catch {
    return null;
  }
}

/** Extract a Facebook Group post permalink from a post container. */
function extractPostPermalink(postElement: Element, currentGroupId?: string): string | null {
  const groupAliases = getGroupIdAliases(currentGroupId);
  const links = Array.from(postElement.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const link of links) {
    try {
      const url = new URL(link.href, window.location.origin);
      const path = url.pathname.replace(/\/$/, "");
      if (!isFacebookHost(url.hostname)) continue;
      if (!/^\/groups\/[^/]+\/(?:posts|permalink|pending_posts)\//i.test(path)) continue;
      const groupId = path.match(/^\/groups\/([^/]+)\//i)?.[1]?.toLowerCase();
      if (groupAliases.size && (!groupId || !groupAliases.has(groupId))) continue;
      return normalizeFacebookGroupPostUrl(url.href);
    } catch {
      // Inspect the next anchor when Facebook exposes a malformed href.
    }
  }
  return null;
}

function isNewEvidence(
  postElement: Element,
  submittedAt: number,
  existingPostElements?: ReadonlySet<Element>,
): boolean {
  if (existingPostElements?.has(postElement)) return false;
  const timestamp = extractPostTimestamp(postElement);
  // Facebook frequently inserts the new article/link before hydrating its
  // <time> element. A new DOM node is still valid evidence in that window;
  // existing nodes remain rejected so an old post cannot be reused.
  return timestamp === null || timestamp >= submittedAt - 30_000;
}

/** Find positive evidence that the submitted post appeared in the feed. */
function findPublishedPost({
  root = document,
  submittedText,
  submittedAt,
  existingPostElements,
  existingPostUrls,
  submittedMediaCount,
  currentGroupId,
}: FindPublishedPostOptions): PublishedPostMatch | null {
  const expectedGroupId = currentGroupId ?? getCurrentFacebookGroupId();
  const candidates: Element[] = [];
  if (root instanceof Element && root.matches(POST_SELECTOR)) candidates.push(root);
  candidates.push(...Array.from(root.querySelectorAll(POST_SELECTOR)));

  const seen = new Set<Element>();
  for (const candidate of candidates) {
    if (seen.has(candidate) || !isVisiblePostElement(candidate)) continue;
    seen.add(candidate);
    if (!isSubmittedPostMatch(candidate, submittedText, submittedMediaCount)) continue;
    if (!isNewEvidence(candidate, submittedAt, existingPostElements)) continue;
    const postUrl = extractPostPermalink(candidate, currentGroupId) ?? undefined;
    if (postUrl && existingPostUrls?.has((normalizeFacebookGroupPostUrl(postUrl) ?? postUrl).replace(/\/$/, '').toLowerCase())) continue;
    if (expectedGroupId && !postUrl) continue;

    return {
      element: candidate as HTMLElement,
      postUrl,
    };
  }
  return null;
}

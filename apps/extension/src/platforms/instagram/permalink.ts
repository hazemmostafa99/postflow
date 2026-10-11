import { normalizeInstagramPostUrl } from './result.js';

export type InstagramPostProbe = {
  urls: string[];
  available: boolean;
};

const PROFILE_PROBE_ATTEMPTS = 10;
const PROFILE_PROBE_INTERVAL_MS = 500;
const PERMALINK_RESOLVE_ATTEMPTS = 8;
const PERMALINK_RESOLVE_INTERVAL_MS = 750;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function extractInstagramPermalinks(values: unknown[]): string[] {
  return [...new Set(
    values
      .flatMap((value) => String(value).replace(/\\/g, '').match(
        /(?:https?:\/\/(?:www\.)?instagram\.com)?\/(?:[^/]+\/)?(?:p|reels?)\/[A-Za-z0-9_-]+\/?/gi,
      ) ?? [])
      .map((value) => normalizeInstagramPostUrl(new URL(value, 'https://www.instagram.com/').toString()))
      .filter((value): value is string => Boolean(value)),
  )];
}

export async function probeInstagramPostUrls(tabId: number): Promise<InstagramPostProbe> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hrefs = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .map((anchor) => anchor.getAttribute('href'))
          .filter((href): href is string => Boolean(href));
        const markup = document.documentElement?.outerHTML ?? '';
        const markupUrls = markup.match(
          /(?:https?:\/\/(?:www\.)?instagram\.com)?\/(?:[^/]+\/)?(?:p|reels?)\/[A-Za-z0-9_-]+\/?/gi,
        ) ?? [];
        return [...hrefs, ...markupUrls];
      },
    });
    const rawUrls = Array.isArray(result?.result) ? result.result : [];
    return { urls: extractInstagramPermalinks(rawUrls), available: true };
  } catch {
    return { urls: [], available: false };
  }
}

export async function waitForInstagramBaselineProbe(tabId: number): Promise<InstagramPostProbe> {
  let latest: InstagramPostProbe = { urls: [], available: false };
  for (let attempt = 0; attempt < PROFILE_PROBE_ATTEMPTS; attempt += 1) {
    latest = await probeInstagramPostUrls(tabId);
    if (latest.urls.length > 0) return latest;
    if (attempt < PROFILE_PROBE_ATTEMPTS - 1) await delay(PROFILE_PROBE_INTERVAL_MS);
  }
  return latest;
}

export async function resolveInstagramPostUrl(
  tabId: number,
  existingProbe: InstagramPostProbe,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < PERMALINK_RESOLVE_ATTEMPTS; attempt += 1) {
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    const directUrl = currentTab?.url ? normalizeInstagramPostUrl(currentTab.url) : null;
    if (directUrl) return directUrl;

    const probe = await probeInstagramPostUrls(tabId);
    if (existingProbe.available && probe.available) {
      const newUrl = probe.urls.find((url) => !existingProbe.urls.includes(url));
      if (newUrl) return newUrl;
    }
    if (attempt < PERMALINK_RESOLVE_ATTEMPTS - 1) await delay(PERMALINK_RESOLVE_INTERVAL_MS);
  }
  return undefined;
}

export async function refreshAndResolveInstagramPostUrl(
  tabId: number,
  existingProbe: InstagramPostProbe,
): Promise<string | undefined> {
  if (!existingProbe.available) return undefined;
  console.info('[PostFlow][Instagram] Refreshing profile to resolve the new post permalink', { tabId });
  await chrome.tabs.reload(tabId).catch(() => undefined);
  await delay(1_500);
  const postUrl = await resolveInstagramPostUrl(tabId, existingProbe);
  if (!postUrl) {
    console.warn('[PostFlow][Instagram] Permalink could not be resolved after profile refresh', {
      tabId,
      baselineAvailable: existingProbe.available,
      baselineCount: existingProbe.urls.length,
    });
  }
  return postUrl;
}

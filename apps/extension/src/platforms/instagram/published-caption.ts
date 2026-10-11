import { normalizeInstagramPostUrl } from './result.js';

const CAPTION_CHECK_TIMEOUT_MS = 20_000;

/** Confirm a caption on the account-owned permalink after Instagram shares it. */
export async function verifyPublishedInstagramCaption(postUrl: string, expected: string): Promise<boolean> {
  const normalizedUrl = normalizeInstagramPostUrl(postUrl);
  if (!normalizedUrl || !expected.trim()) return false;
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
    tabId = tab.id;
    if (tabId === undefined) return false;
    const deadline = Date.now() + CAPTION_CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(tabId).catch(() => null);
      if (!current) return false;
      if (current.status === 'complete') {
        // A newly created tab can briefly report its previous blank URL as
        // complete before the requested permalink starts navigating.
        if (!current.url || current.url === 'about:blank') {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        if (normalizeInstagramPostUrl(current.url) !== normalizedUrl) return false;
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (caption: string) => {
            const normalize = (value: string) => value.normalize('NFKC')
              .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
              .replace(/\u00A0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const expectedText = normalize(caption);
            const descriptions = Array.from(document.querySelectorAll<HTMLMetaElement>(
              'meta[property="og:description"], meta[name="description"]',
            )).map((node) => node.content);
            const postBodies = Array.from(document.querySelectorAll<HTMLElement>('article, main h1, [role="dialog"] h1'))
              .map((node) => node.innerText || node.textContent || '');
            return [...descriptions, ...postBodies].some((value) => normalize(value).includes(expectedText));
          },
          args: [expected],
        }).catch(() => []);
        if (probe?.result === true) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return false;
  } catch {
    return false;
  } finally {
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

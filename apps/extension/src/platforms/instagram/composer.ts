type InstagramComposerResult = {
  success: boolean;
  status: 'PUBLISHED' | 'UNKNOWN' | 'FAILED';
  canceled?: boolean;
  reason?: string;
  postUrl?: string;
};
type InstagramSelectors = {
  findCreateTrigger: (documentRef: Document) => HTMLElement | null;
  findDialog: (documentRef: Document) => HTMLElement | null;
  findMediaInput: (root: ParentNode) => HTMLInputElement | null;
  findCaptionField: (root: ParentNode) => HTMLElement | null;
  findNextButton: (root: ParentNode) => HTMLButtonElement | null;
  findShareButton: (root: ParentNode) => HTMLButtonElement | null;
};
type InstagramComposerBridgeApi = {
  execute: (message: {
    jobId?: string;
    expectedUsername?: string;
    targetType?: string;
    post?: { content?: string; caption?: string; text?: string; mediaUrls?: string[] };
  }) => Promise<InstagramComposerResult>;
};

const instagramCaption = (globalThis as typeof globalThis & {
  PostFlowInstagramCaption?: InstagramCaptionApi;
}).PostFlowInstagramCaption;
const instagramComposerSelectors = (globalThis as typeof globalThis & {
  PostFlowInstagramSelectors?: InstagramSelectors;
}).PostFlowInstagramSelectors;
function instagramComposerDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
async function waitForInstagramElement<T>(read: () => T | null, timeoutMs = 15_000): Promise<T | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value) return value;
    await instagramComposerDelay(250);
  }
  return null;
}

function instagramDataUrlToFile(dataUrl: string): File | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    return new File([bytes], 'postflow-upload', { type: match[1] });
  } catch {
    return null;
  }
}

async function attachMedia(input: HTMLInputElement, dataUrl: string): Promise<boolean> {
  const file = instagramDataUrlToFile(dataUrl);
  if (!file) return false;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await instagramComposerDelay(800);
  return true;
}

function normalizeInstagramPostUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) return undefined;
    const match = url.pathname.match(/^\/(?:[^/]+\/)?(p|reel)\/([^/]+)\/?$/i);
    if (!match) return undefined;
    return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
  } catch {
    return undefined;
  }
}

function findPublishedInstagramUrl(): string | undefined {
  return normalizeInstagramPostUrl(window.location.href);
}

function findInstagramPostUrls(): Set<string> {
  const urls = new Set<string>();
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (!href) return;
    try {
      const normalized = normalizeInstagramPostUrl(new URL(href, window.location.origin).toString());
      if (normalized) urls.add(normalized);
    } catch {
      // Ignore non-URL links and navigation placeholders.
    }
  });
  return urls;
}

async function waitForInstagramPostUrl(
  existingPostUrls: Set<string>,
  timeoutMs = 5_000,
): Promise<string | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentPageUrl = findPublishedInstagramUrl();
    if (currentPageUrl) return currentPageUrl;

    for (const candidate of findInstagramPostUrls()) {
      if (!existingPostUrls.has(candidate)) return candidate;
    }
    await instagramComposerDelay(500);
  }
  return undefined;
}

function hasInstagramSuccessNotice(): boolean {
  const successPattern = /your (?:post|reel) has been shared|(?:post|reel) shared/i;
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  return dialogs.some((dialog) => (
    successPattern.test(dialog.getAttribute('aria-label') ?? '')
    || successPattern.test(dialog.textContent ?? '')
  )) || successPattern.test(document.body?.textContent ?? '');
}

async function waitForInstagramOutcome(
  existingPostUrls: Set<string>,
): Promise<{ status: 'PUBLISHED' | 'UNKNOWN'; postUrl?: string }> {
  const startedAt = Date.now();
  // Instagram may upload and render the confirmation dialog asynchronously.
  // Keep this window long enough to cover slower uploads without retrying the job.
  while (Date.now() - startedAt < 15_000) {
    const postUrl = findPublishedInstagramUrl();
    if (postUrl || hasInstagramSuccessNotice()) {
      // Do not click Instagram's Done control here. Instagram may reload the
      // profile when the modal closes, destroying this content-script context
      // before the async runtime response reaches the background worker.
      const discoveredPostUrl = postUrl ?? await waitForInstagramPostUrl(existingPostUrls);
      console.info('[PostFlow][Instagram] Publish confirmation detected', {
        postUrl: discoveredPostUrl,
        postUrlDetected: Boolean(discoveredPostUrl),
      });
      return { status: 'PUBLISHED', ...(discoveredPostUrl ? { postUrl: discoveredPostUrl } : {}) };
    }
    await instagramComposerDelay(500);
  }
  return { status: 'UNKNOWN' };
}

async function executeInstagramComposer(
  message: {
    jobId?: string;
    expectedUsername?: string;
    targetType?: string;
    post?: { content?: string; caption?: string; text?: string; mediaUrls?: string[] };
  },
): Promise<InstagramComposerResult> {
  if (!instagramComposerSelectors) return { success: false, status: 'FAILED', reason: 'Instagram selectors are unavailable' };
  const mediaUrls = message.post?.mediaUrls ?? [];
  const isReel = message.targetType === 'INSTAGRAM_REEL';
  if (mediaUrls.length !== 1 || (isReel ? !mediaUrls[0].startsWith('data:video/') : !mediaUrls[0].startsWith('data:image/'))) {
    return { success: false, status: 'FAILED', reason: isReel ? 'Instagram Reel requires one video' : 'Instagram Feed requires one image' };
  }

  const existingPostUrls = findInstagramPostUrls();
  const trigger = await waitForInstagramElement(() => instagramComposerSelectors.findCreateTrigger(document));
  if (!trigger) return { success: false, status: 'FAILED', reason: 'Instagram create button was not found' };
  console.info('[PostFlow][Instagram] Create trigger found');
  trigger.click();

  const dialog = await waitForInstagramElement(() => instagramComposerSelectors.findDialog(document));
  if (!dialog) return { success: false, status: 'FAILED', reason: 'Instagram composer did not open' };
  console.info('[PostFlow][Instagram] Composer dialog opened');
  const input = await waitForInstagramElement(() => instagramComposerSelectors.findMediaInput(dialog));
  if (!input || !(await attachMedia(input, mediaUrls[0]))) {
    return { success: false, status: 'FAILED', reason: 'Instagram media input was not found' };
  }
  console.info('[PostFlow][Instagram] Media attached');

  for (let step = 0; step < 2; step += 1) {
    const next = await waitForInstagramElement(
      () => instagramComposerSelectors.findNextButton(
        instagramComposerSelectors.findDialog(document) ?? document,
      ),
      3_000,
    );
    if (!next) break;
    next.click();
    console.info('[PostFlow][Instagram] Composer next clicked', { step: step + 1 });
    await instagramComposerDelay(700);
  }

  const captionPayload = instagramCaption?.read(message.post) ?? { text: '', source: 'none' as const };
  const caption = captionPayload.text;
  console.info('[PostFlow][Instagram] Caption payload received', {
    targetType: message.targetType,
    provided: Boolean(caption),
    source: captionPayload.source,
    length: caption.length,
  });
  if (caption) {
    const field = await waitForInstagramElement(
      () => instagramComposerSelectors.findCaptionField(
        instagramComposerSelectors.findDialog(document) ?? document,
      ),
      5_000,
    );
    if (!field) return { success: false, status: 'FAILED', reason: 'Instagram caption field was not found' };
    const captionInserted = instagramCaption?.insert(field, caption) === true;
    if (!captionInserted) {
      await instagramComposerDelay(250);
      if (!instagramCaption?.matches(field, caption)) {
        console.warn('[PostFlow][Instagram] Caption verification failed', {
          targetType: message.targetType,
          expectedLength: caption.length,
          actualText: (field.innerText || field.textContent || '').slice(0, 120),
        });
        return { success: false, status: 'FAILED', reason: 'Instagram caption could not be inserted' };
      }
    }
    console.info('[PostFlow][Instagram] Caption inserted', {
      targetType: message.targetType,
      length: caption.length,
    });
  }

  const share = await waitForInstagramElement(
    () => instagramComposerSelectors.findShareButton(
      instagramComposerSelectors.findDialog(document) ?? document,
    ),
    5_000,
  );
  if (!share) return { success: false, status: 'FAILED', reason: 'Instagram Share button was not ready' };
  console.info('[PostFlow][Instagram] Share control found');
  if (share.disabled || share.getAttribute('aria-disabled') === 'true') {
    return { success: false, status: 'FAILED', reason: 'Instagram Share button is disabled' };
  }

  const preShareCheck = await new Promise<{
    ok: boolean;
    canceled?: boolean;
    reason?: string;
  }>((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: 'INSTAGRAM_PRE_SHARE_CHECK',
        jobId: message.jobId,
        expectedUsername: message.expectedUsername,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          resolve({ ok: false, reason: runtimeError.message });
          return;
        }
        resolve(response ?? { ok: false, reason: 'Instagram pre-share check returned no response' });
      },
    );
  });
  if (!preShareCheck.ok) {
    console.warn('[PostFlow][Instagram] Pre-share check rejected', preShareCheck);
    return {
      success: false,
      status: 'FAILED',
      canceled: preShareCheck.canceled === true,
      reason: preShareCheck.reason || 'Instagram job was not verified before Share',
    };
  }

  share.click();
  const outcome = await waitForInstagramOutcome(existingPostUrls);

  return {
    success: true,
    status: outcome.status,
    ...(outcome.postUrl ? { postUrl: outcome.postUrl } : {}),
    reason: outcome.status === 'PUBLISHED'
      ? 'Instagram confirmed the Share action.'
      : 'Instagram accepted the Share action; permalink detection is pending.',
  };
}

(globalThis as typeof globalThis & {
  PostFlowInstagramComposer?: InstagramComposerBridgeApi;
}).PostFlowInstagramComposer = { execute: executeInstagramComposer };

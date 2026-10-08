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
    post?: { content?: string; mediaUrls?: string[] };
  }) => Promise<InstagramComposerResult>;
};

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

function insertCaption(field: HTMLElement, content: string): void {
  if (field instanceof HTMLTextAreaElement) {
    field.value = content;
  } else {
    field.textContent = content;
  }
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizeInstagramPostUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) return undefined;
    if (!/^\/(p|reel)\/[^/]+\/?$/i.test(url.pathname)) return undefined;
    return `https://www.instagram.com${url.pathname.replace(/\/$/, '')}/`;
  } catch {
    return undefined;
  }
}

function findPublishedInstagramUrl(): string | undefined {
  return normalizeInstagramPostUrl(window.location.href);
}

function hasInstagramSuccessNotice(): boolean {
  const bodyText = document.body?.textContent ?? '';
  return /your (?:post|reel) has been shared|post shared|reel shared/i.test(bodyText);
}

async function waitForInstagramOutcome(): Promise<{ status: 'PUBLISHED' | 'UNKNOWN'; postUrl?: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const postUrl = findPublishedInstagramUrl();
    if (postUrl || hasInstagramSuccessNotice()) {
      return { status: 'PUBLISHED', ...(postUrl ? { postUrl } : {}) };
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
    post?: { content?: string; mediaUrls?: string[] };
  },
): Promise<InstagramComposerResult> {
  if (!instagramComposerSelectors) return { success: false, status: 'FAILED', reason: 'Instagram selectors are unavailable' };
  const mediaUrls = message.post?.mediaUrls ?? [];
  const isReel = message.targetType === 'INSTAGRAM_REEL';
  if (mediaUrls.length !== 1 || (isReel ? !mediaUrls[0].startsWith('data:video/') : !mediaUrls[0].startsWith('data:image/'))) {
    return { success: false, status: 'FAILED', reason: isReel ? 'Instagram Reel requires one video' : 'Instagram Feed requires one image' };
  }

  const trigger = await waitForInstagramElement(() => instagramComposerSelectors.findCreateTrigger(document));
  if (!trigger) return { success: false, status: 'FAILED', reason: 'Instagram create button was not found' };
  trigger.click();

  const dialog = await waitForInstagramElement(() => instagramComposerSelectors.findDialog(document));
  if (!dialog) return { success: false, status: 'FAILED', reason: 'Instagram composer did not open' };
  const input = await waitForInstagramElement(() => instagramComposerSelectors.findMediaInput(dialog));
  if (!input || !(await attachMedia(input, mediaUrls[0]))) {
    return { success: false, status: 'FAILED', reason: 'Instagram media input was not found' };
  }

  for (let step = 0; step < 2; step += 1) {
    const next = await waitForInstagramElement(
      () => instagramComposerSelectors.findNextButton(
        instagramComposerSelectors.findDialog(document) ?? document,
      ),
      3_000,
    );
    if (!next) break;
    next.click();
    await instagramComposerDelay(700);
  }

  const caption = message.post?.content?.trim() ?? '';
  if (caption) {
    const field = await waitForInstagramElement(
      () => instagramComposerSelectors.findCaptionField(
        instagramComposerSelectors.findDialog(document) ?? document,
      ),
      5_000,
    );
    if (!field) return { success: false, status: 'FAILED', reason: 'Instagram caption field was not found' };
    insertCaption(field, caption);
  }

  const share = await waitForInstagramElement(
    () => instagramComposerSelectors.findShareButton(
      instagramComposerSelectors.findDialog(document) ?? document,
    ),
    5_000,
  );
  if (!share) return { success: false, status: 'FAILED', reason: 'Instagram Share button was not ready' };
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
    return {
      success: false,
      status: 'FAILED',
      canceled: preShareCheck.canceled === true,
      reason: preShareCheck.reason || 'Instagram job was not verified before Share',
    };
  }

  share.click();
  const outcome = await waitForInstagramOutcome();

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

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
    expectedAccountId?: string;
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

function findInstagramCaptionFieldNow(): HTMLElement | null {
  if (!instagramComposerSelectors) return null;
  return instagramComposerSelectors.findCaptionField(
    instagramComposerSelectors.findDialog(document) ?? document,
  );
}

/**
 * Instagram may replace the Lexical editor node immediately after an input
 * event. Re-find the field after every attempt and require two consecutive
 * reads before continuing to Share; checking one stale HTMLElement is what
 * made caption insertion appear intermittent.
 */
async function insertAndVerifyInstagramCaption(caption: string): Promise<HTMLElement | null> {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const field = findInstagramCaptionFieldNow();
    if (!field) {
      await instagramComposerDelay(150);
      continue;
    }
    const inserted = instagramCaption?.insert(field, caption) === true;
    console.info('[PostFlow][Instagram] Caption insertion attempt', {
      attempt,
      inserted,
      fieldConnected: field.isConnected,
      method: field instanceof HTMLTextAreaElement ? 'native_value_setter' : 'native_edit_transaction',
    });
    if (!inserted) {
      await instagramComposerDelay(180);
      continue;
    }
    // Give the framework a focus transition as it would receive when the
    // user leaves the editor to press Share, then inspect the live field.
    field.blur();

    let consecutiveMatches = 0;
    for (let check = 0; check < 3; check += 1) {
      await instagramComposerDelay(180);
      const currentField = findInstagramCaptionFieldNow();
      if (currentField && instagramCaption?.verified(currentField, caption)) {
        consecutiveMatches += 1;
        if (consecutiveMatches >= 2) return currentField;
      } else {
        consecutiveMatches = 0;
      }
    }
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

async function attachMedia(input: HTMLInputElement, dataUrls: string[]): Promise<boolean> {
  const files = dataUrls.map(instagramDataUrlToFile);
  if (files.some((file) => file === null)) return false;
  const validFiles = files as File[];
  const transfer = new DataTransfer();
  validFiles.forEach((file) => transfer.items.add(file));
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
    const match = url.pathname.match(/^\/(?:[^/]+\/)?(p|reels?)\/([^/]+)\/?$/i);
    if (!match) return undefined;
    const kind = match[1].toLowerCase() === 'p' ? 'p' : 'reel';
    return `https://www.instagram.com/${kind}/${match[2]}/`;
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
  // Require a completed-share phrase, not the Share button or upload progress.
  // Instagram can use the generic post dialog label even for a video/Reel.
  const successPattern = /your\s+(?:post|reel)\s+has\s+been\s+shared|shared\s+(?:post|reel)|(?:post|reel)\s+shared|(?:^|\s)تمت?\s+مشاركة\s+(?:المنشور|منشورك|(?:مقطع\s+)?(?:ريلز|الريل|ريل)|الفيديو|فيديو[ك]?)/i;
  const matchesSuccess = (text: string) => successPattern.test(
    text.replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, ''),
  );
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  return dialogs.some((dialog) => (
    matchesSuccess(dialog.getAttribute('aria-label') ?? '')
    || matchesSuccess(dialog.textContent ?? '')
  )) || matchesSuccess(document.body?.textContent ?? '');
}

async function waitForInstagramOutcome(
  existingPostUrls: Set<string>,
  targetType: string | undefined,
): Promise<{ status: 'PUBLISHED' | 'UNKNOWN'; postUrl?: string }> {
  // A Reel can remain in the upload/processing state well beyond the normal
  // Feed confirmation window. We wait for a terminal DOM signal rather than
  // treating the first short window as a failure. The cap is only a safety
  // boundary so a broken tab cannot hold the worker forever.
  const timeoutMs = targetType === 'INSTAGRAM_REEL' ? 90_000 : 45_000;
  const startedAt = Date.now();
  let lastProgressLogAt = startedAt;
  console.info('[PostFlow][Instagram] Waiting for publish confirmation', {
    targetType,
    timeoutMs,
  });
  while (Date.now() - startedAt < timeoutMs) {
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
    const now = Date.now();
    if (now - lastProgressLogAt >= 5_000) {
      console.info('[PostFlow][Instagram] Still waiting for publish confirmation', {
        targetType,
        elapsedMs: now - startedAt,
      });
      lastProgressLogAt = now;
    }
    await instagramComposerDelay(500);
  }
  console.warn('[PostFlow][Instagram] Publish confirmation timeout', {
    targetType,
    elapsedMs: Date.now() - startedAt,
  });
  return { status: 'UNKNOWN' };
}

async function executeInstagramComposer(
  message: {
    jobId?: string;
    expectedAccountId?: string;
    expectedUsername?: string;
    targetType?: string;
    post?: { content?: string; caption?: string; text?: string; mediaUrls?: string[] };
  },
): Promise<InstagramComposerResult> {
  if (!instagramComposerSelectors) return { success: false, status: 'FAILED', reason: 'Instagram selectors are unavailable' };
  const mediaUrls = message.post?.mediaUrls ?? [];
  const isReel = message.targetType === 'INSTAGRAM_REEL';
  const imageCount = mediaUrls.filter((url) => url.startsWith('data:image/')).length;
  const videoCount = mediaUrls.filter((url) => url.startsWith('data:video/')).length;
  const validMedia = isReel
    ? mediaUrls.length === 1 && videoCount === 1
    : imageCount >= 1 && imageCount <= 4 && imageCount === mediaUrls.length;
  if (!validMedia) {
    return { success: false, status: 'FAILED', reason: isReel ? 'Instagram Reel requires one video' : 'Instagram Feed requires one to four images' };
  }

  const existingPostUrls = findInstagramPostUrls();
  const trigger = await waitForInstagramElement(() => instagramComposerSelectors.findCreateTrigger(document));
  if (!trigger) return { success: false, status: 'FAILED', reason: 'Instagram create button was not found' };
  console.info('[PostFlow][Instagram] Create trigger found');
  trigger.click();

  const dialog = await waitForInstagramElement(() => instagramComposerSelectors.findDialog(document));
  if (!dialog) return { success: false, status: 'FAILED', reason: 'Instagram composer did not open' };
  console.info('[PostFlow][Instagram] Composer dialog opened');
  // Instagram can replace the entire dialog while hydrating the upload form.
  // Re-resolve it on every poll; the original reference can be detached.
  const input = await waitForInstagramElement(() => {
    const liveDialog = instagramComposerSelectors.findDialog(document);
    const candidate = liveDialog && instagramComposerSelectors.findMediaInput(liveDialog);
    return candidate?.isConnected && !candidate.disabled ? candidate : null;
  });
  if (!input) {
    console.warn('[PostFlow][Instagram] Media input readiness timed out', {
      jobId: message.jobId,
      dialogDetected: Boolean(instagramComposerSelectors.findDialog(document)),
    });
    return { success: false, status: 'FAILED', reason: 'Instagram media input was not found' };
  }
  console.info('[PostFlow][Instagram] Media input ready', {
    jobId: message.jobId,
    accept: input.accept,
    connected: input.isConnected,
  });
  if (!(await attachMedia(input, mediaUrls))) {
    return { success: false, status: 'FAILED', reason: 'Instagram media could not be attached' };
  }
  console.info('[PostFlow][Instagram] Media attached');

  for (let step = 0; step < 3; step += 1) {
    const currentRoot = () => instagramComposerSelectors.findDialog(document) ?? document;
    const currentDialog = currentRoot();
    if (
      instagramComposerSelectors.findCaptionField(currentDialog)
      || instagramComposerSelectors.findShareButton(currentDialog)
    ) {
      console.info('[PostFlow][Instagram] Final composer stage detected', { step });
      break;
    }
    const next = await waitForInstagramElement(
      () => instagramComposerSelectors.findNextButton(currentRoot()),
      12_000,
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
    const verifiedCaptionField = await insertAndVerifyInstagramCaption(caption);
    if (!verifiedCaptionField) {
      const currentField = findInstagramCaptionFieldNow();
      console.warn('[PostFlow][Instagram] Caption verification failed', {
        targetType: message.targetType,
        expectedLength: caption.length,
        fieldDetected: Boolean(currentField),
        domMatches: Boolean(currentField && instagramCaption?.matches(currentField, caption)),
        transactionVerified: Boolean(currentField && instagramCaption?.verified(currentField, caption)),
      });
      return { success: false, status: 'FAILED', reason: 'Instagram caption could not be inserted' };
    }
    console.info('[PostFlow][Instagram] Caption inserted', {
      targetType: message.targetType,
      length: caption.length,
    });
  }

  let share = await waitForInstagramElement(
    () => instagramComposerSelectors.findShareButton(
      instagramComposerSelectors.findDialog(document) ?? document,
    ),
    5_000,
  );
  if (!share) return { success: false, status: 'FAILED', reason: 'Instagram Share button was not ready' };
  if (caption) {
    const finalCaptionField = findInstagramCaptionFieldNow();
    if (!finalCaptionField || !instagramCaption?.verified(finalCaptionField, caption)) {
      console.warn('[PostFlow][Instagram] Caption changed before Share; repairing');
      if (!(await insertAndVerifyInstagramCaption(caption))) {
        return { success: false, status: 'FAILED', reason: 'Instagram caption could not be inserted' };
      }
      share = await waitForInstagramElement(
        () => instagramComposerSelectors.findShareButton(
          instagramComposerSelectors.findDialog(document) ?? document,
        ),
        5_000,
      );
      if (!share) return { success: false, status: 'FAILED', reason: 'Instagram Share button was not ready after caption repair' };
    }
  }
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
        expectedAccountId: message.expectedAccountId,
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

  // Account/job checks are asynchronous; Instagram can re-render the editor
  // during that wait. Validate its editing transaction again and re-acquire
  // Share immediately before clicking it.
  const finalCaptionField = caption ? findInstagramCaptionFieldNow() : null;
  if (caption && (!finalCaptionField || !instagramCaption?.verified(finalCaptionField, caption))) {
    console.warn('[PostFlow][Instagram] Caption verification lost after pre-share checks', {
      jobId: message.jobId,
      expectedLength: caption.length,
    });
    return { success: false, status: 'FAILED', reason: 'Instagram caption changed before Share; publishing stopped' };
  }
  share = instagramComposerSelectors.findShareButton(
    instagramComposerSelectors.findDialog(document) ?? document,
  );
  if (!share || !share.isConnected || share.disabled || share.getAttribute('aria-disabled') === 'true') {
    return { success: false, status: 'FAILED', reason: 'Instagram Share button changed before submission' };
  }
  console.info('[PostFlow][Instagram] Caption transaction verified before Share', {
    jobId: message.jobId,
    captionLength: caption.length,
  });
  share.click();
  const outcome = await waitForInstagramOutcome(existingPostUrls, message.targetType);

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

type InstagramElementFinder = {
  findCreateTrigger: (documentRef: Document) => HTMLElement | null;
  findDialog: (documentRef: Document) => HTMLElement | null;
  findMediaInput: (root: ParentNode) => HTMLInputElement | null;
  findCaptionField: (root: ParentNode) => HTMLElement | null;
  findNextButton: (root: ParentNode) => HTMLButtonElement | null;
  findShareButton: (root: ParentNode) => HTMLButtonElement | null;
};

const CREATE_LABEL = /new post|create|إنشاء|منشور جديد/i;
const NEXT_LABEL = /next|التالي/i;
const SHARE_LABEL = /share|مشاركة/i;
const CAPTION_LABEL = /caption|(?:شرحا?|تسمية)\s+توضيحي[ةا]?|(?:أضف|إضافة|اكتب)\s+(?:وصف|تعليق)/i;

function visible(element: Element): boolean {
  const node = element as HTMLElement;
  const style = globalThis.getComputedStyle?.(node);
  return Boolean(
    node.offsetWidth ||
      node.offsetHeight ||
      (style && style.visibility !== 'hidden' && style.display !== 'none'),
  );
}

function labelFor(element: Element): string {
  const descendantLabels = Array.from(
    element.querySelectorAll<HTMLElement>('[aria-label], [aria-placeholder], [data-placeholder], [title], svg title'),
  ).flatMap((descendant) => [
    descendant.getAttribute('aria-label'),
    descendant.getAttribute('aria-placeholder'),
    descendant.getAttribute('data-placeholder'),
    descendant.getAttribute('title'),
    descendant.textContent,
  ]);
  return [
    element.getAttribute('aria-label'),
    element.getAttribute('aria-placeholder'),
    element.getAttribute('data-placeholder'),
    element.getAttribute('title'),
    element.textContent,
    ...descendantLabels,
  ].filter(Boolean).join(' ')
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
}

function isDisabled(element: Element): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

function findButton(root: ParentNode, pattern: RegExp): HTMLButtonElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button, [role="button"], a[role="link"]'),
  );
  return candidates.find((candidate) => visible(candidate) && !isDisabled(candidate) && pattern.test(labelFor(candidate))) as HTMLButtonElement | undefined ?? null;
}

const instagramSelectors: InstagramElementFinder = {
  findCreateTrigger(documentRef) {
    return findButton(documentRef, CREATE_LABEL);
  },
  findDialog(documentRef) {
    const dialogs = Array.from(documentRef.querySelectorAll<HTMLElement>('[role="dialog"], dialog'));
    const visibleDialogs = dialogs.filter(visible);
    // During a modal transition the outgoing dialog can coexist with the
    // upload composer. Prefer the actual upload form, not the first dialog.
    return visibleDialogs.find((dialog) => dialog.querySelector('input[type="file"]'))
      ?? visibleDialogs.find((dialog) => CREATE_LABEL.test(labelFor(dialog)))
      ?? visibleDialogs[0] ?? null;
  },
  findMediaInput(root) {
    return root.querySelector<HTMLInputElement>('input[type="file"]');
  },
  findCaptionField(root) {
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]'),
    );
    const captionCandidates = candidates.filter((candidate) =>
      CAPTION_LABEL.test(labelFor(candidate)),
    );
    const visibleCaption = captionCandidates.find(visible);
    if (visibleCaption) return visibleCaption;
    const visibleCandidates = candidates.filter(visible);
    // Do not guess when Instagram has multiple editors (for example caption,
    // alt text, or accessibility fields) and the caption label has not
    // hydrated yet. A single visible editor is a safe legacy fallback.
    return visibleCandidates.length === 1 ? visibleCandidates[0] : null;
  },
  findNextButton(root) {
    return findButton(root, NEXT_LABEL);
  },
  findShareButton(root) {
    const button = findButton(root, SHARE_LABEL);
    return button && !isDisabled(button) ? button : null;
  },
};

(globalThis as typeof globalThis & {
  PostFlowInstagramSelectors?: InstagramElementFinder;
}).PostFlowInstagramSelectors = instagramSelectors;

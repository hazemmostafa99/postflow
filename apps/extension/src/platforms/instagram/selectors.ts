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
    element.querySelectorAll<HTMLElement>('[aria-label], [title], svg title'),
  ).flatMap((descendant) => [
    descendant.getAttribute('aria-label'),
    descendant.getAttribute('title'),
    descendant.textContent,
  ]);
  return [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.textContent,
    ...descendantLabels,
  ].filter(Boolean).join(' ');
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
    return dialogs.find(visible) ?? null;
  },
  findMediaInput(root) {
    return root.querySelector<HTMLInputElement>('input[type="file"]');
  },
  findCaptionField(root) {
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]'),
    );
    return candidates.find(visible) ?? null;
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

type InstagramCaptionPost = {
  content?: string;
  caption?: string;
  text?: string;
};

type InstagramCaptionApi = {
  read: (post?: InstagramCaptionPost) => { text: string; source: 'content' | 'caption' | 'text' | 'none' };
  insert: (field: HTMLElement, content: string) => boolean;
  confirmBrowserInsert: (field: HTMLElement, content: string) => boolean;
  matches: (field: HTMLElement, expected: string) => boolean;
  verified: (field: HTMLElement, expected: string) => boolean;
};

// A DOM value alone does not prove React/Lexical received an editing event.
const instagramCaptionTransactions = new WeakMap<HTMLElement, string>();

function normalizeCaptionText(value: string): string {
  return value
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function captionMatches(field: HTMLElement, expected: string): boolean {
  const actual = normalizeCaptionText(
    field instanceof HTMLTextAreaElement
      ? field.value
      : field.innerText || field.textContent || '',
  );
  const normalizedExpected = normalizeCaptionText(expected);
  // Require an exact normalized value. `includes` treats a duplicated caption
  // (for example, "hellohello") as valid and hides a second insertion.
  return actual === normalizedExpected;
}

function insertCaption(field: HTMLElement, content: string): boolean {
  if (captionVerified(field, content)) return true;
  instagramCaptionTransactions.delete(field);
  field.focus();

  if (field instanceof HTMLTextAreaElement) {
    // React tracks assignments through the instance setter. Calling the
    // browser's prototype setter lets the following input event reach onChange
    // with a changed value instead of being discarded by React's tracker.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(field, content);
    field.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: content,
    }));
  } else {
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (!selection || !range || !document.execCommand) return false;
    // Replace the entire selection, including any previous or duplicated
    // caption, through the browser's editing transaction. Never mutate
    // textContent/children: that can look correct while Lexical stays empty.
    range.selectNodeContents(field);
    selection.removeAllRanges();
    selection.addRange(range);
    let receivedInput = false;
    const onInput = () => { receivedInput = true; };
    field.addEventListener('input', onInput);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, content);
    } finally {
      field.removeEventListener('input', onInput);
    }
    if (!inserted || !receivedInput) return false;
  }
  if (!captionMatches(field, content)) return false;
  instagramCaptionTransactions.set(field, normalizeCaptionText(content));
  return true;
}

function captionVerified(field: HTMLElement, expected: string): boolean {
  return instagramCaptionTransactions.get(field) === normalizeCaptionText(expected) &&
    captionMatches(field, expected);
}

function confirmBrowserInsert(field: HTMLElement, content: string): boolean {
  if (!field.isConnected || !captionMatches(field, content)) return false;
  instagramCaptionTransactions.set(field, normalizeCaptionText(content));
  return true;
}

function readCaption(post?: InstagramCaptionPost): { text: string; source: 'content' | 'caption' | 'text' | 'none' } {
  if (typeof post?.content === 'string') return { text: post.content.trim(), source: 'content' };
  if (typeof post?.caption === 'string') return { text: post.caption.trim(), source: 'caption' };
  if (typeof post?.text === 'string') return { text: post.text.trim(), source: 'text' };
  return { text: '', source: 'none' };
}

(globalThis as typeof globalThis & { PostFlowInstagramCaption?: InstagramCaptionApi }).PostFlowInstagramCaption = {
  read: readCaption,
  insert: insertCaption,
  confirmBrowserInsert,
  matches: captionMatches,
  verified: captionVerified,
};

type InstagramCaptionPost = {
  content?: string;
  caption?: string;
  text?: string;
};

type InstagramCaptionApi = {
  read: (post?: InstagramCaptionPost) => { text: string; source: 'content' | 'caption' | 'text' | 'none' };
  insert: (field: HTMLElement, content: string) => boolean;
  matches: (field: HTMLElement, expected: string) => boolean;
};

function normalizeCaptionText(value: string): string {
  return value
    .replace(/[\u200B\uFEFF]/g, '')
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
  return actual === normalizedExpected || actual.includes(normalizedExpected);
}

function insertCaption(field: HTMLElement, content: string): boolean {
  if (field instanceof HTMLTextAreaElement) {
    field.value = content;
  } else {
    field.focus();
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (range) {
      range.selectNodeContents(field);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const inserted = document.execCommand?.('insertText', false, content) === true;
    if (!inserted || !captionMatches(field, content)) {
      field.textContent = '';
      const paragraph = document.createElement('p');
      paragraph.textContent = content;
      field.appendChild(paragraph);
    }
  }
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return captionMatches(field, content);
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
  matches: captionMatches,
};

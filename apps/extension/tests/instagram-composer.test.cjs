const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadScript(context, relativePath) {
  const source = readFileSync(resolve(__dirname, relativePath), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
}

function createContext(html, preShareResponse = { ok: true }) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  const runtimeMessages = [];
  let simulatedTime = 0;
  let selectedField = null;
  const selection = {
    removeAllRanges: () => { selectedField = null; },
    addRange: (range) => { selectedField = range.field; },
  };
  document.createRange = () => ({ selectNodeContents(field) { this.field = field; } });
  document.execCommand = (command, _showUi, value) => {
    if (command !== 'insertText' || !selectedField) return false;
    selectedField.textContent = value;
    selectedField.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  };
  const context = vm.createContext({
    document,
    URL,
    Date: class extends Date { static now() { return simulatedTime; } },
    window: {
      ...window,
      location: new URL('https://www.instagram.com/'),
      setTimeout: (callback, milliseconds) => {
        simulatedTime += milliseconds;
        callback();
        return 0;
      },
      getSelection: () => selection,
      getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    },
    getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event,
    InputEvent: window.InputEvent,
    File: window.File,
    atob: global.atob,
    DataTransfer: class {
      constructor() {
        this.items = { add: (file) => { this.files.push(file); } };
        this.files = [];
      }
    },
    chrome: {
      runtime: {
        sendMessage: (message, callback) => {
          runtimeMessages.push(message);
          callback(preShareResponse);
        },
        lastError: undefined,
      },
    },
  });
  context.__runtimeMessages = runtimeMessages;
  return context;
}

function loadComposer(context, captionSelector = 'textarea') {
  context.PostFlowInstagramSelectors = {
    findCreateTrigger: (documentRef) => documentRef.querySelector('#create'),
    findDialog: (documentRef) => documentRef.querySelector('[role="dialog"]'),
    findMediaInput: (root) => root.querySelector('input[type="file"]'),
    findCaptionField: (root) => root.querySelector(captionSelector),
    findNextButton: () => null,
    findShareButton: (root) => root.querySelector('#share'),
  };
  loadScript(context, '../src/platforms/instagram/caption.ts');
  loadScript(context, '../src/platforms/instagram/composer.ts');
}

test('Instagram selectors identify the safe create, media, caption, next, and share controls', () => {
  const context = createContext(`
    <button aria-label="Create new post">Create</button>
    <div role="dialog">
      <input type="file" />
      <textarea></textarea>
      <button>Next</button>
      <button>Share</button>
    </div>
  `);
  loadScript(context, '../src/platforms/instagram/selectors.ts');
  const selectors = context.PostFlowInstagramSelectors;
  const dialog = selectors.findDialog(context.document);

  assert.ok(selectors.findCreateTrigger(context.document));
  assert.ok(dialog);
  assert.ok(selectors.findMediaInput(dialog));
  assert.ok(selectors.findCaptionField(dialog));
  assert.ok(selectors.findNextButton(dialog));
  assert.ok(selectors.findShareButton(dialog));
});

test('Instagram selectors prefer the Lexical caption textbox', () => {
  const context = createContext(`
    <div role="dialog">
      <div contenteditable="true" role="textbox" aria-label="Add a caption..."></div>
      <div contenteditable="true" aria-label="Other editor"></div>
    </div>
  `);
  loadScript(context, '../src/platforms/instagram/selectors.ts');

  const field = context.PostFlowInstagramSelectors.findCaptionField(
    context.document.querySelector('[role="dialog"]'),
  );
  assert.equal(field?.getAttribute('aria-label'), 'Add a caption...');
});

test('Instagram selectors support the current sidebar link with a nested New post SVG', () => {
  const context = createContext(`
    <a href="#" role="link">
      <div aria-selected="false">
        <svg aria-label="New post" role="img"><title>New post</title></svg>
      </div>
      <span style="display: none">Create</span>
    </a>
  `);
  loadScript(context, '../src/platforms/instagram/selectors.ts');

  const create = context.PostFlowInstagramSelectors.findCreateTrigger(context.document);
  assert.ok(create);
  assert.equal(create.getAttribute('role'), 'link');
});

test('Instagram composer attaches one image, inserts caption, and checks before Share', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <textarea></textarea>
      <button id="share">Share</button>
    </div>
  `);
  const share = context.document.querySelector('#share');
  let shareClicks = 0;
  share.click = () => { shareClicks += 1; };
  loadComposer(context);

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-1',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_FEED',
    post: { content: 'Hello Instagram', mediaUrls: ['data:image/png;base64,AA=='] },
  });

  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.success, true);
  assert.equal(shareClicks, 1);
  assert.equal(context.document.querySelector('textarea').value, 'Hello Instagram');
  assert.equal(context.document.querySelector('input[type="file"]').files.length, 1);
  assert.equal(context.__runtimeMessages[0].type, 'INSTAGRAM_PRE_SHARE_CHECK');
  assert.equal(context.__runtimeMessages[0].jobId, 'job-instagram-1');
});

test('Instagram composer inserts captions into a contenteditable Reel field', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <div contenteditable="true" role="textbox" aria-label="Add a caption..."></div>
      <button id="share">Share</button>
    </div>
  `);
  const share = context.document.querySelector('#share');
  share.click = () => {
    const successDialog = context.document.createElement('div');
    successDialog.setAttribute('aria-label', 'Shared reel');
    successDialog.setAttribute('role', 'dialog');
    successDialog.textContent = 'Your reel has been shared.';
    context.document.body.appendChild(successDialog);
  };
  loadComposer(context, '[contenteditable="true"]');

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-reel-caption',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_REEL',
    post: { content: 'Reel caption', mediaUrls: ['data:video/mp4;base64,AA=='] },
  });

  assert.equal(result.success, true);
  assert.equal(context.document.querySelector('[contenteditable="true"]').textContent, 'Reel caption');
});

test('Instagram composer attaches an image carousel as one ordered selection', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" multiple />
      <textarea></textarea>
      <button id="share">Share</button>
    </div>
  `);
  const share = context.document.querySelector('#share');
  let shareClicks = 0;
  share.click = () => { shareClicks += 1; };
  loadComposer(context);

  const result = await context.PostFlowInstagramComposer.execute({
    targetType: 'INSTAGRAM_FEED',
    post: {
      mediaUrls: [
        'data:image/png;base64,AA==',
        'data:image/jpeg;base64,Ag==',
        'data:image/png;base64,Aw==',
      ],
    },
  });

  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.success, true);
  assert.equal(shareClicks, 1);
  assert.equal(context.document.querySelector('input[type="file"]').files.length, 3);
});

test('Instagram composer retries when the caption editor is replaced after input', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <div id="caption" contenteditable="true" role="textbox" aria-label="Add a caption..."></div>
      <button id="share">Share</button>
    </div>
  `);
  const firstField = context.document.querySelector('#caption');
  let replaced = false;
  firstField.addEventListener('input', () => {
    if (replaced) return;
    replaced = true;
    const replacement = context.document.createElement('div');
    replacement.id = 'caption';
    replacement.setAttribute('contenteditable', 'true');
    replacement.setAttribute('role', 'textbox');
    replacement.setAttribute('aria-label', 'Add a caption...');
    firstField.replaceWith(replacement);
  });
  loadComposer(context, '#caption');

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-caption-rerender',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_FEED',
    post: { content: 'Stable caption', mediaUrls: ['data:image/png;base64,AA=='] },
  });

  assert.equal(result.success, true);
  assert.equal(context.document.querySelector('#caption').textContent, 'Stable caption');
});

test('Instagram caption insertion is idempotent and does not duplicate text', () => {
  const context = createContext('<div contenteditable="true" role="textbox"></div>');
  loadScript(context, '../src/platforms/instagram/caption.ts');
  const field = context.document.querySelector('[contenteditable="true"]');

  assert.equal(context.PostFlowInstagramCaption.insert(field, 'One caption'), true);
  assert.equal(context.PostFlowInstagramCaption.insert(field, 'One caption'), true);
  assert.equal(field.textContent, 'One caption');
  assert.equal(
    context.PostFlowInstagramCaption.matches(field, 'One captionOne caption'),
    false,
  );
});

test('Instagram native caption insertion does not dispatch a second payload', () => {
  const context = createContext('<div contenteditable="true" role="textbox"></div>');
  loadScript(context, '../src/platforms/instagram/caption.ts');
  const field = context.document.querySelector('[contenteditable="true"]');
  context.document.execCommand = (_command, _showUi, value) => {
    field.textContent = value;
    field.dispatchEvent(new context.Event('input', { bubbles: true }));
    return true;
  };
  field.addEventListener('input', (event) => {
    if (event.data) field.textContent += event.data;
  });

  assert.equal(context.PostFlowInstagramCaption.insert(field, 'Native caption'), true);
  assert.equal(field.textContent, 'Native caption');
});

test('Instagram rejects visible caption text without a native editor input event', () => {
  const context = createContext('<div contenteditable="true" role="textbox"></div>');
  loadScript(context, '../src/platforms/instagram/caption.ts');
  const field = context.document.querySelector('[contenteditable="true"]');
  context.document.execCommand = (_command, _showUi, value) => {
    field.textContent = value;
    return true;
  };
  assert.equal(context.PostFlowInstagramCaption.insert(field, 'DOM only'), false);
  assert.equal(context.PostFlowInstagramCaption.matches(field, 'DOM only'), true);
  assert.equal(context.PostFlowInstagramCaption.verified(field, 'DOM only'), false);
});

test('Instagram stops before Share when native editing is unavailable', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <div contenteditable="true" role="textbox">Looks correct</div>
      <button id="share">Share</button>
    </div>
  `);
  context.document.execCommand = () => false;
  let shareClicks = 0;
  context.document.querySelector('#share').click = () => { shareClicks += 1; };
  loadComposer(context, '[contenteditable="true"]');
  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'caption-dom-only', targetType: 'INSTAGRAM_FEED',
    post: { content: 'Looks correct', mediaUrls: ['data:image/png;base64,AA=='] },
  });
  assert.equal(result.success, false);
  assert.match(result.reason, /caption/);
  assert.equal(shareClicks, 0);
});

test('Instagram textarea input updates controlled application state through the native setter', () => {
  const context = createContext('<textarea></textarea>');
  loadScript(context, '../src/platforms/instagram/caption.ts');
  const field = context.document.querySelector('textarea');
  const nativeValue = Object.getOwnPropertyDescriptor(context.HTMLTextAreaElement.prototype, 'value');
  let trackedValue = '';
  let appCaption = '';
  Object.defineProperty(field, 'value', {
    get: () => nativeValue.get.call(field),
    set: (value) => { trackedValue = value; nativeValue.set.call(field, value); },
  });
  field.addEventListener('input', () => {
    if (field.value !== trackedValue) {
      appCaption = field.value;
      trackedValue = field.value;
    }
  });
  assert.equal(context.PostFlowInstagramCaption.insert(field, 'Controlled caption'), true);
  assert.equal(appCaption, 'Controlled caption');
});

test('Instagram publishes the caption registered by the contenteditable input handler exactly once', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog"><input type="file" />
      <div contenteditable="true" role="textbox"></div>
      <button id="share">Share</button></div>
  `);
  const field = context.document.querySelector('[contenteditable="true"]');
  let registeredCaption = '';
  let publishedCaption;
  let inputEvents = 0;
  field.addEventListener('input', () => {
    inputEvents += 1;
    registeredCaption = field.textContent;
  });
  context.document.querySelector('#share').click = () => { publishedCaption = registeredCaption; };
  loadComposer(context, '[contenteditable="true"]');
  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'caption-registered', targetType: 'INSTAGRAM_REEL',
    post: { content: 'Caption once', mediaUrls: ['data:video/mp4;base64,AA=='] },
  });
  assert.equal(result.success, true);
  assert.equal(publishedCaption, 'Caption once');
  assert.equal(inputEvents, 1);
});

test('Instagram stops if the caption disappears during the asynchronous pre-share check', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog"><input type="file" /><textarea></textarea>
      <button id="share">Share</button></div>
  `);
  let shareClicks = 0;
  context.document.querySelector('#share').click = () => { shareClicks += 1; };
  context.chrome.runtime.sendMessage = (_message, callback) => {
    context.document.querySelector('textarea').value = '';
    callback({ ok: true });
  };
  loadComposer(context);
  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'caption-lost', targetType: 'INSTAGRAM_FEED',
    post: { content: 'Must be present', mediaUrls: ['data:image/png;base64,AA=='] },
  });
  assert.equal(result.success, false);
  assert.match(result.reason, /caption changed before Share/);
  assert.equal(shareClicks, 0);
});

test('Instagram composer does not click Share when the final check rejects the job', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <textarea></textarea>
      <button id="share">Share</button>
    </div>
  `, { ok: false, canceled: true, reason: 'Instagram job was canceled before Share.' });
  const share = context.document.querySelector('#share');
  let shareClicks = 0;
  share.click = () => { shareClicks += 1; };
  loadComposer(context);

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-canceled',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_REEL',
    post: { mediaUrls: ['data:video/mp4;base64,AA=='] },
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.canceled, true);
  assert.match(result.reason, /canceled/i);
  assert.equal(shareClicks, 0);
});

test('Instagram composer reports a visible share confirmation as published', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <button id="share">Share</button>
    </div>
    <div>Your post has been shared</div>
  `);
  const share = context.document.querySelector('#share');
  share.click = () => {
    const postLink = context.document.createElement('a');
    postLink.setAttribute('href', '/ema.d1852/p/new-feed-post/');
    context.document.body.appendChild(postLink);
  };
  loadComposer(context);

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-published',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_FEED',
    post: { mediaUrls: ['data:image/png;base64,AA=='] },
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.postUrl, 'https://www.instagram.com/p/new-feed-post/');
});

test('Instagram composer detects the Post shared dialog without closing the page context', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <button id="share">Share</button>
    </div>
  `);
  const share = context.document.querySelector('#share');
  let doneClicks = 0;
  share.click = () => {
    const successDialog = context.document.createElement('div');
    successDialog.setAttribute('aria-label', 'Post shared');
    successDialog.setAttribute('aria-modal', 'true');
    successDialog.setAttribute('role', 'dialog');
    successDialog.innerHTML = '<h3>Your post has been shared.</h3><div role="button">Done</div>';
    successDialog.querySelector('[role="button"]').click = () => { doneClicks += 1; };
    context.document.body.appendChild(successDialog);
    const postLink = context.document.createElement('a');
    postLink.setAttribute('href', '/ema.d1852/reel/dialog-success-post/');
    context.document.body.appendChild(postLink);
  };
  loadComposer(context);

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-dialog-success',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_FEED',
    post: { mediaUrls: ['data:image/png;base64,AA=='] },
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.postUrl, 'https://www.instagram.com/reel/dialog-success-post/');
  assert.equal(doneClicks, 0);
});

test('Instagram composer detects the Shared reel confirmation variant', async () => {
  const context = createContext(`
    <button id="create">Create</button>
    <div role="dialog">
      <input type="file" />
      <button id="share">Share</button>
    </div>
  `);
  const share = context.document.querySelector('#share');
  share.click = () => {
    const successDialog = context.document.createElement('div');
    successDialog.setAttribute('aria-label', 'Shared reel');
    successDialog.setAttribute('aria-modal', 'true');
    successDialog.setAttribute('role', 'dialog');
    successDialog.innerHTML = '<h3>Your reel has been shared.</h3>';
    context.document.body.appendChild(successDialog);
  };
  loadComposer(context);

  const result = await context.PostFlowInstagramComposer.execute({
    jobId: 'job-instagram-reel-dialog-success',
    expectedUsername: 'ema.d1852',
    targetType: 'INSTAGRAM_REEL',
    post: { mediaUrls: ['data:video/mp4;base64,AA=='] },
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'PUBLISHED');
});

test('Arabic selectors identify Create, Next, Share and the labelled caption among multiple editors', () => {
  const context = createContext(`
    <a role="link"><svg aria-label="منشور جديد"></svg></a>
    <div role="dialog">
      <input type="file" />
      <div contenteditable="true" aria-label="إضافة نص بديل"></div>
      <div id="caption" contenteditable="true" aria-label="إضافة شرحًا توضيحيًا..."></div>
      <div role="button">التالي</div>
      <div role="button">مشاركة</div>
    </div>
  `);
  loadScript(context, '../src/platforms/instagram/selectors.ts');
  const selectors = context.PostFlowInstagramSelectors;
  const dialog = selectors.findDialog(context.document);
  assert.ok(selectors.findCreateTrigger(context.document));
  assert.ok(selectors.findMediaInput(dialog));
  assert.equal(selectors.findCaptionField(dialog).id, 'caption');
  assert.ok(selectors.findNextButton(dialog));
  assert.ok(selectors.findShareButton(dialog));
});

for (const [targetType, media, stageCount, heading, confirmation] of [
  ['INSTAGRAM_FEED', 'data:image/png;base64,AA==', 1, 'تمت مشاركة المنشور', 'تمت مشاركة منشورك.'],
  ['INSTAGRAM_REEL', 'data:video/mp4;base64,AA==', 2, 'تمت مشاركة مقطع ريلز', 'تمت مشاركة مقطع ريلز الخاص بك.'],
]) {
  test(`${targetType} runs Arabic controls and waits for delayed Arabic confirmation`, async () => {
    const context = createContext(`
      <button id="create" aria-label="إنشاء">إنشاء</button>
      <div role="dialog">
        <input type="file" />
        <div role="button" id="next">التالي</div>
      </div>
    `);
    let nextClicks = 0;
    let shareClicks = 0;
    let doneClicks = 0;
    let delaySinceShare = 0;
    let sharedCaption;
    const dialog = context.document.querySelector('[role="dialog"]');
    const next = context.document.querySelector('#next');
    next.click = () => {
      nextClicks += 1;
      if (nextClicks !== stageCount) return;
      next.remove();
      dialog.insertAdjacentHTML('beforeend', '<div contenteditable="true" aria-label="إضافة شرح توضيحي..."></div><div id="share" role="button">مشاركة</div>');
      dialog.querySelector('#share').click = () => {
        shareClicks += 1;
        sharedCaption = dialog.querySelector('[contenteditable]').textContent;
        dialog.innerHTML = '<h3>جارٍ المشاركة...</h3>';
      };
    };
    const originalTimeout = context.window.setTimeout;
    context.window.setTimeout = (callback, milliseconds) => {
      if (shareClicks) {
        delaySinceShare += milliseconds;
        if (delaySinceShare >= 3_000 && !dialog.querySelector('#done')) {
          dialog.setAttribute('aria-label', heading);
          dialog.innerHTML = `<h3>${confirmation}</h3><div id="done" role="button">تم</div>`;
          dialog.querySelector('#done').click = () => { doneClicks += 1; };
        }
      }
      return originalTimeout(callback, milliseconds);
    };
    loadScript(context, '../src/platforms/instagram/selectors.ts');
    loadScript(context, '../src/platforms/instagram/caption.ts');
    loadScript(context, '../src/platforms/instagram/composer.ts');
    const result = await context.PostFlowInstagramComposer.execute({
      jobId: 'arabic-publishing', expectedUsername: 'tester', targetType,
      post: { mediaUrls: [media], content: 'تجربة النشر باللغة العربية' },
    });
    assert.equal(nextClicks, stageCount);
    assert.equal(shareClicks, 1);
    assert.equal(sharedCaption, 'تجربة النشر باللغة العربية');
    assert.equal(result.status, 'PUBLISHED');
    assert.equal(result.success, true);
    assert.equal(result.postUrl, undefined); // Confirmation need not contain a URL.
    assert.equal(doneClicks, 0); // Keep the response channel alive for URL recovery.
    assert.ok(delaySinceShare >= 3_000);
    assert.ok(delaySinceShare < 10_000);
  });
}

for (const [name, label, text] of [
  ['Arabic aria-label only', 'تمت مشاركة المنشور', ''],
  ['Arabic text only', '', 'تمت مشاركة منشورك.'],
  ['Arabic Reel text with bidi and diacritics', '', '\u200Fتَمَّت مشاركة الريل.'],
]) {
  test(`Instagram detects ${name} without requiring a permalink`, async () => {
    const context = createContext('<button id="create">Create</button><div role="dialog"><input type="file" /><button id="share">Share</button></div>');
    context.document.querySelector('#share').click = () => {
      const dialog = context.document.querySelector('[role="dialog"]');
      dialog.setAttribute('aria-label', label);
      dialog.innerHTML = `<h3>${text}</h3><div role="button">تم</div>`;
    };
    loadComposer(context);
    const result = await context.PostFlowInstagramComposer.execute({
      targetType: 'INSTAGRAM_REEL', post: { mediaUrls: ['data:video/mp4;base64,AA=='] },
    });
    assert.equal(result.status, 'PUBLISHED');
    assert.equal(result.postUrl, undefined);
  });
}

test('Arabic sharing progress, failure and Done alone do not confirm publication', async () => {
  const context = createContext('<button id="create">Create</button><div role="dialog"><input type="file" /><button id="share">Share</button></div>');
  context.document.querySelector('#share').click = () => {
    const dialog = context.document.querySelector('[role="dialog"]');
    dialog.innerHTML = '<h3>جارٍ مشاركة المنشور</h3><p>لم تتم مشاركة المنشور.</p><div role="button">تم</div>';
  };
  loadComposer(context);
  const result = await context.PostFlowInstagramComposer.execute({
    targetType: 'INSTAGRAM_FEED', post: { mediaUrls: ['data:image/png;base64,AA=='] },
  });
  assert.equal(result.status, 'UNKNOWN');
});

test('Instagram selects the upload form inside the Arabic composer instead of an outgoing dialog', () => {
  const context = createContext(`
    <div role="dialog" aria-label="تمت مشاركة المنشور"><div role="button">تم</div></div>
    <div id="upload" role="dialog" aria-label="إنشاء منشور جديد">
      <h3>اسحب الصور ومقاطع الفيديو هنا</h3>
      <button type="button">تحديد من الكمبيوتر</button>
      <form enctype="multipart/form-data" role="presentation">
        <input type="file" multiple accept="image/avif,image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime" />
      </form>
    </div>
  `);
  loadScript(context, '../src/platforms/instagram/selectors.ts');
  const selectors = context.PostFlowInstagramSelectors;
  const dialog = selectors.findDialog(context.document);
  assert.equal(dialog.id, 'upload');
  assert.ok(selectors.findMediaInput(dialog));
});

for (const [targetType, media] of [
  ['INSTAGRAM_FEED', 'data:image/png;base64,AA=='],
  ['INSTAGRAM_REEL', 'data:video/mp4;base64,AA=='],
]) {
  test(`${targetType} re-finds the Arabic upload dialog after its node is replaced`, async () => {
    const context = createContext('<button aria-label="إنشاء" id="create">إنشاء</button><div role="dialog" aria-label="إنشاء منشور جديد"><h3>إنشاء منشور جديد</h3></div>');
    const originalDialog = context.document.querySelector('[role="dialog"]');
    let inputChanges = 0;
    let shareClicks = 0;
    const originalTimeout = context.window.setTimeout;
    context.window.setTimeout = (callback, milliseconds) => {
      if (originalDialog.isConnected) {
        const replacement = context.document.createElement('div');
        replacement.setAttribute('role', 'dialog');
        replacement.setAttribute('aria-label', 'إنشاء منشور جديد');
        replacement.innerHTML = '<h3>اسحب الصور ومقاطع الفيديو هنا</h3><button>تحديد من الكمبيوتر</button><form role="presentation"><input type="file" accept="image/png,video/mp4" /></form>';
        replacement.querySelector('input').addEventListener('change', () => {
          inputChanges += 1;
          replacement.insertAdjacentHTML('beforeend', '<button id="share">مشاركة</button>');
          replacement.querySelector('#share').click = () => {
            shareClicks += 1;
            replacement.setAttribute('aria-label', 'تمت مشاركة المنشور');
            replacement.innerHTML = '<h3>تمت مشاركة منشورك.</h3>';
          };
        });
        originalDialog.replaceWith(replacement);
      }
      return originalTimeout(callback, milliseconds);
    };
    loadScript(context, '../src/platforms/instagram/selectors.ts');
    loadScript(context, '../src/platforms/instagram/caption.ts');
    loadScript(context, '../src/platforms/instagram/composer.ts');
    const result = await context.PostFlowInstagramComposer.execute({
      targetType, post: { mediaUrls: [media] },
    });
    assert.equal(originalDialog.isConnected, false);
    assert.equal(inputChanges, 1);
    assert.equal(shareClicks, 1);
    assert.equal(result.status, 'PUBLISHED');
  });
}

test('Instagram distinguishes an attachment conversion failure from a missing media input', async () => {
  const context = createContext('<button id="create">Create</button><div role="dialog"><input type="file" /><button id="share">Share</button></div>');
  let shareClicks = 0;
  context.document.querySelector('#share').click = () => { shareClicks += 1; };
  loadComposer(context);
  const result = await context.PostFlowInstagramComposer.execute({
    targetType: 'INSTAGRAM_FEED', post: { mediaUrls: ['data:image/png;base64,%%%'] },
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.reason, 'Instagram media could not be attached');
  assert.equal(shareClicks, 0);
});

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
  const context = vm.createContext({
    document,
    URL,
    window: {
      ...window,
      location: new URL('https://www.instagram.com/'),
      setTimeout: (callback) => {
        callback();
        return 0;
      },
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
        this.items = { add: (file) => { this.files = [file]; } };
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
  share.click = () => {};
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

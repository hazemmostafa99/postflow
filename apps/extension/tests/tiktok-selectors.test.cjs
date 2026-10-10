const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadSelectors(body, href = 'https://www.tiktok.com/tiktokstudio/upload') {
  const { document, window } = parseHTML(`<html><body>${body}</body></html>`);
  const context = vm.createContext({
    document,
    globalThis: {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: new URL(href),
    URL,
    window,
  });
  const source = readFileSync(
    resolve(__dirname, '../src/platforms/tiktok/selectors.ts'),
    'utf8',
  );
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context.globalThis.PostFlowTikTokSelectors;
}

test('recognizes TikTok Studio upload markup without a form wrapper', () => {
  const selectors = loadSelectors(`
    <div aria-live="polite" class="upload">
      <input type="file" accept="video/*" style="display: none">
      <div data-e2e="select_video_container">Select video</div>
    </div>
  `);
  assert.equal(selectors.root()?.getAttribute('aria-live'), 'polite');
  assert.deepEqual(JSON.parse(JSON.stringify(selectors.diagnostics())), {
    inputCount: 1,
    videoInputCount: 1,
    imageInputCount: 0,
    targetType: 'TIKTOK_VIDEO',
    scoped: true,
    editorReady: false,
    postControlCount: 0,
    enabledPostControlCount: 0,
    localDraftPresent: false,
    localDraftConfirmationPresent: false,
    copyrightContinuationPresent: false,
    contentRowCount: 0,
  });
});

test('reports an unscoped file input instead of claiming readiness', () => {
  const selectors = loadSelectors('<input type="file" accept="video/*">');
  assert.equal(selectors.root(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(selectors.diagnostics())), {
    inputCount: 1,
    videoInputCount: 1,
    imageInputCount: 0,
    targetType: 'TIKTOK_VIDEO',
    scoped: false,
    editorReady: false,
    postControlCount: 0,
    enabledPostControlCount: 0,
    localDraftPresent: false,
    localDraftConfirmationPresent: false,
    copyrightContinuationPresent: false,
    contentRowCount: 0,
  });
});

test('recognizes the Photos tab multiple-image input and completed photo editor', () => {
  const selectors = loadSelectors(`
    <button role="tab" aria-controls="panel-video">Videos</button>
    <button role="tab" aria-controls="panel-photo" aria-selected="true">Photos</button>
    <div role="tabpanel" id="panel-photo"><input type="file" accept="image/jpg,image/jpeg,image/png,image/webp" multiple></div>
    <div data-tt="PageContainer_NewPageContainer_FlexColumn">
      <div data-tt="photo-editor-details"><div data-e2e="caption_container"><div contenteditable="true"></div></div></div>
      <div>Photos</div><div>2 photos uploaded</div><button>Post</button>
    </div>
  `);
  const upload = selectors.root('TIKTOK_PHOTO');
  assert.equal(upload?.getAttribute('id'), 'panel-photo');
  assert.equal(selectors.uploadTab('TIKTOK_PHOTO')?.textContent, 'Photos');
  const editor = selectors.editorRoot();
  assert.equal(selectors.preparationComplete(editor, 'TIKTOK_PHOTO'), true);
  assert.equal(selectors.diagnostics('TIKTOK_PHOTO').imageInputCount, 1);
});

test('reports an unsaved local draft instead of silently waiting', () => {
  const selectors = loadSelectors(`
    <div data-e2e="local_draft_container">
      <span>A video you were editing wasn’t saved.</span>
      <button>Discard</button><button>Continue</button>
    </div>
    <div aria-live="polite"><input type="file" accept="video/*"></div>
  `);
  assert.equal(selectors.interruption(), 'LOCAL_DRAFT_PRESENT');
  assert.equal(selectors.interruption(true), null);
  assert.equal(selectors.diagnostics().localDraftPresent, true);
  const draft = selectors.localDraft();
  assert.ok(draft);
  assert.equal(selectors.localDraftDiscardButton(draft)?.textContent, 'Discard');
});

test('recognizes only the Discard control in TikTok local-draft confirmation', () => {
  const selectors = loadSelectors(`
    <div class="TUXModal common-modal" role="dialog" title="Discard this post?">
      <div class="common-modal-header">Discard this post?</div>
      <button>Not now</button>
      <button class="TUXButton--primary">Discard</button>
    </div>
  `);
  const dialog = selectors.localDraftDiscardDialog();
  assert.ok(dialog);
  assert.equal(selectors.localDraftConfirmButton(dialog)?.textContent, 'Discard');
  assert.equal(selectors.diagnostics().localDraftConfirmationPresent, true);
});

test('recognizes only Post now in TikTok copyright-check continuation', () => {
  const selectors = loadSelectors(`
    <div class="TUXModal common-modal" role="dialog" title="Continue to post?">
      <div class="common-modal-header">Continue to post?</div>
      <div>The copyright check is incomplete. Posting your video now will stop the check.</div>
      <button>Cancel</button>
      <button class="TUXButton--primary">Post now</button>
    </div>
  `);
  const dialog = selectors.copyrightContinuationDialog();
  assert.ok(dialog);
  assert.equal(selectors.copyrightPostNowButton(dialog)?.textContent, 'Post now');
  assert.equal(selectors.diagnostics().copyrightContinuationPresent, true);
});

test('recognizes TikTok post-upload editor markup after the upload card is replaced', () => {
  const selectors = loadSelectors(`
    <div data-tt="PageContainer_NewPageContainer_FlexColumn">
      <div data-e2e="upload_status_container"><div class="info-status success">Uploaded（1.45MB）</div></div>
      <div data-e2e="caption_container"><div contenteditable="true">postflow-media</div></div>
      <button data-e2e="post_video_button">Post</button>
    </div>
  `);
  const scope = selectors.editorRoot();
  assert.ok(scope);
  assert.equal(selectors.preparationComplete(scope), true);
  assert.ok(selectors.caption(scope));
  assert.ok(selectors.postButton(scope));
});

test('recognizes the freshly published matching row on TikTok Studio Content', () => {
  const now = Date.now();
  const videoId = ((BigInt(Math.floor(now / 1_000)) << 32n) + 123n).toString();
  const selectors = loadSelectors(`
    <div data-tt="components_PostTable_Absolute">
      <div data-tt="components_PostInfoCell_Container"><a href="/@creator/video/${videoId}">caption #tag</a></div>
      <span data-tt="components_PublishStageLabel_TUXText">Oct 10, 7:38 PM</span>
    </div>
  `, 'https://www.tiktok.com/tiktokstudio/content');
  const result = selectors.contentPageOutcome('creator', 'caption #tag', now - 10_000);
  assert.equal(result?.status, 'PUBLISHED');
  assert.equal(result?.postUrl, `https://www.tiktok.com/@creator/video/${videoId}`);
});

test('recognizes a freshly published TikTok Photo permalink', () => {
  const now = Date.now();
  const postId = ((BigInt(Math.floor(now / 1_000)) << 32n) + 456n).toString();
  const selectors = loadSelectors(`
    <div data-tt="components_PostTable_Absolute">
      <div data-tt="components_PostInfoCell_Container"><a href="/@creator/photo/${postId}">photo caption</a></div>
      <span data-tt="components_PublishStageLabel_TUXText">Oct 10, 7:38 PM</span>
    </div>
  `, 'https://www.tiktok.com/tiktokstudio/content');
  const result = selectors.contentPageOutcome('creator', 'photo caption', now - 10_000);
  assert.equal(result?.status, 'PUBLISHED');
  assert.equal(result?.postUrl, `https://www.tiktok.com/@creator/photo/${postId}`);
});

test('recognizes a matching TikTok Studio Content row still under review', () => {
  const selectors = loadSelectors(`
    <div data-tt="components_PostTable_Absolute">
      <div data-tt="components_PostInfoCell_Container">caption #tag</div>
      <span data-tt="components_PublishStageLabel_TUXText">Reviewing</span>
    </div>
  `, 'https://www.tiktok.com/tiktokstudio/content');
  const result = selectors.contentPageOutcome('creator', 'caption #tag', Date.now() - 10_000);
  assert.equal(result?.status, 'PROCESSING');
});

test('does not claim an older TikTok Studio Content permalink', () => {
  const now = Date.now();
  const oldVideoId = ((BigInt(Math.floor((now - 3_600_000) / 1_000)) << 32n) + 123n).toString();
  const selectors = loadSelectors(`
    <div data-tt="components_PostTable_Absolute">
      <div data-tt="components_PostInfoCell_Container"><a href="/@creator/video/${oldVideoId}">caption #tag</a></div>
    </div>
  `, 'https://www.tiktok.com/tiktokstudio/content');
  assert.equal(selectors.contentPageOutcome('creator', 'caption #tag', now - 10_000), null);
});

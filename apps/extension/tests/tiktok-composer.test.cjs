const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function harness(options = {}) {
  const html = `${options.noProfile ? '' : '<a data-e2e="profile-icon" aria-label="Profile" href="/@creator">Me</a>'}
    ${options.localDraft ? `<div data-e2e="local_draft_container"><span>A video you were editing wasn't saved.</span>
      <button>${options.draftDiscardText || 'Discard'}</button><button>Continue</button></div>` : ''}
    <form><input type="file" accept="${options.photo ? 'image/jpg,image/jpeg,image/png,image/webp' : 'video/mp4'}" ${options.photo ? 'multiple' : ''}><div role="status">${options.preparation || 'Uploaded'}</div>
    ${options.photo ? '<div>2 photos uploaded</div>' : ''}
    <div contenteditable="true" aria-label="Caption">old caption</div>
    <button data-e2e="post_video_button" ${options.disabled || options.delayedPost ? 'disabled' : ''}>Post</button>${options.extraButton ? '<button>Post</button>' : ''}</form>
    ${options.oldUrl ? `<div data-e2e="post-success"><a href="${options.oldUrl}">Old post</a></div>` : ''}`;
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  const pageLocation = new URL('https://www.tiktok.com/tiktokstudio/upload');
  let now = Date.now(), clicks = 0, postNowClicks = 0, discardClicks = 0, confirmationClicks = 0;
  let arms = 0, checks = 0, fetches = 0, postWaits = 0;
  let selected;
  const field = document.querySelector('[contenteditable]');
  document.createRange = () => ({ selectNodeContents(node) { selected = node; } });
  document.execCommand = (_command, _ui, text) => { if (options.captionFailure) return false; selected.textContent = text; return true; };
  const draft = document.querySelector('[data-e2e="local_draft_container"]');
  draft?.querySelector('button')?.addEventListener('click', () => {
    discardClicks++;
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('title', 'Discard this post?');
    dialog.innerHTML = `<div class="common-modal-header">Discard this post?</div>
      <button>Not now</button><button class="TUXButton--primary">${options.confirmDiscardText || 'Discard'}</button>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.TUXButton--primary').addEventListener('click', () => {
      confirmationClicks++;
      if (!options.stuckDraft) {
        dialog.remove();
        draft.remove();
      }
    });
  });
  const completePostOutcome = () => {
    if (options.contentRedirect) {
      pageLocation.pathname = '/tiktokstudio/content';
      const videoId = ((BigInt(Math.floor(now / 1_000)) << 32n) + 123n).toString();
      const row = document.createElement('div');
      row.setAttribute('data-tt', 'components_PostTable_Absolute');
      row.innerHTML = `<div data-tt="components_PostInfoCell_Container">${options.contentReviewing
        ? 'caption #tag'
        : `<a href="/@creator/video/${videoId}">caption #tag</a>`}</div>
        <span data-tt="components_PublishStageLabel_TUXText">${options.contentReviewing ? 'Reviewing' : 'Oct 10, 7:38 PM'}</span>`;
      document.body.appendChild(row);
      return;
    }
    if (options.outcome === 'processing') document.querySelector('[role="status"]').textContent = 'Processing';
    if (options.outcome === 'published' || options.outcome === 'wrong-owner') {
      const result = document.createElement('div');
      result.setAttribute('data-e2e', 'post-success');
      result.innerHTML = `<a href="https://www.tiktok.com/@${options.outcome === 'wrong-owner' ? 'other' : 'creator'}/video/123456">View post</a>`;
      document.body.appendChild(result);
    }
  };
  const handlePostClick = () => {
    clicks++;
    if (!options.copyrightModal) {
      completePostOutcome();
      return;
    }
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('title', 'Continue to post?');
    dialog.innerHTML = `<div class="common-modal-header">Continue to post?</div>
      <div>The copyright check is incomplete. Posting your video now will stop the check.</div>
      <button>Cancel</button><button class="TUXButton--primary">${options.postNowText || 'Post now'}</button>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.TUXButton--primary').addEventListener('click', () => {
      postNowClicks++;
      dialog.remove();
      completePostOutcome();
    });
  };
  document.querySelector('[data-e2e="post_video_button"]').addEventListener('click', handlePostClick);
  const context = vm.createContext({ document, URL, location: pageLocation,
    Date: class extends Date { static now() { return now; } }, Event: window.Event,
    HTMLTextAreaElement: window.HTMLTextAreaElement, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    window: { location: pageLocation, setTimeout(callback, ms) {
      now += ms;
      if (options.delayedPost && field.textContent === 'caption #tag' && ++postWaits >= 2) {
        document.querySelector('[data-e2e="post_video_button"]').removeAttribute('disabled');
      }
      callback();
    }, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; } },
    chrome: { runtime: { async sendMessage(message) {
      if (message.type === 'TIKTOK_CHECK_JOB') { checks++; return { ok: !options.canceled, canceled: options.canceled }; }
      if (message.type === 'TIKTOK_ARM_SUBMISSION') { arms++; if (options.lostArm) throw new Error('Channel lost'); return { ok: !options.deniedArm }; }
      if (message.type === 'TIKTOK_CONFIRM_SUBMISSION') {
        if (options.replacePostAfterConfirm) {
          const current = document.querySelector('[data-e2e="post_video_button"]');
          const replacement = current.cloneNode(true);
          current.replaceWith(replacement);
          replacement.addEventListener('click', handlePostClick);
        }
        return { ok: !options.canceledAfterArm };
      }
    } } },
    PostFlowJobMedia: { async fetchJobMediaFile() { fetches++; return { type: options.photo ? 'image/png' : 'video/mp4', size: 4 }; } },
  });
  for (const file of ['identity', 'selectors', 'composer']) {
    vm.runInContext(ts.transpile(readFileSync(resolve(__dirname, `../src/platforms/tiktok/${file}.ts`), 'utf8'), { target: ts.ScriptTarget.ES2020 }), context);
  }
  const command = { jobId: 'job-1', targetType: options.photo ? 'TIKTOK_PHOTO' : 'TIKTOK_VIDEO', resume: options.resume === true,
    expectedUsername: options.expected || 'creator', apiBaseUrl: 'https://api.example',
    post: { content: 'caption #tag', media: options.photo
      ? [{ contentType: 'image/png' }, { contentType: 'image/jpeg' }]
      : [{ contentType: 'video/mp4' }] } };
  return { run: () => context.PostFlowTikTokComposer.execute(command),
    counts: () => ({ clicks, postNowClicks, discardClicks, confirmationClicks, arms, checks, fetches }), field, document };
}

test('attaches one file, replaces caption, and clicks Post once after checkpoint', async () => {
  const h = harness({ outcome: 'published' });
  const result = await h.run();
  assert.equal(result.status, 'PUBLISHED', result.reason);
  assert.equal(result.postUrl, 'https://www.tiktok.com/@creator/video/123456');
  assert.equal(h.counts().clicks, 1);
  assert.equal(h.counts().arms, 1);
  assert.equal(h.counts().fetches, 1);
  assert.equal(h.field.textContent, 'caption #tag');
});

test('attaches multiple photos in one change and publishes through the shared editor', async () => {
  const h = harness({ photo: true, outcome: 'published' });
  const result = await h.run();
  assert.equal(result.status, 'PUBLISHED', result.reason);
  assert.equal(h.counts().fetches, 2);
  assert.equal(h.counts().clicks, 1);
});

test('waits for the photo editor Post control to become enabled', async () => {
  const h = harness({ photo: true, delayedPost: true, outcome: 'published' });
  const result = await h.run();
  assert.equal(result.status, 'PUBLISHED', result.reason);
  assert.equal(h.counts().clicks, 1);
});

test('resumes an already-uploaded editor without attaching the media again', async () => {
  const h = harness({ photo: true, resume: true, outcome: 'processing' });
  const result = await h.run();
  assert.equal(result.status, 'PROCESSING', result.reason);
  assert.equal(h.counts().fetches, 0);
  assert.equal(h.counts().clicks, 1);
});

test('reacquires a Post control replaced after submission is armed', async () => {
  const h = harness({ replacePostAfterConfirm: true, outcome: 'processing' });
  const result = await h.run();
  assert.equal(result.status, 'PROCESSING', result.reason);
  assert.equal(h.counts().clicks, 1);
});

test('accepted processing is retained without a second click', async () => {
  const h = harness({ outcome: 'processing' });
  assert.equal((await h.run()).status, 'PROCESSING');
  assert.equal(h.counts().clicks, 1);
});

test('confirms TikTok copyright-check continuation after the armed Post click', async () => {
  const h = harness({ copyrightModal: true, outcome: 'processing' });
  const result = await h.run();
  assert.equal(result.status, 'PROCESSING', result.reason);
  assert.equal(h.counts().clicks, 1);
  assert.equal(h.counts().postNowClicks, 1);
  assert.equal(h.counts().arms, 1);
});

test('does not guess when TikTok copyright-check confirmation changes', async () => {
  const h = harness({ copyrightModal: true, postNowText: 'Review', outcome: 'processing' });
  const result = await h.run();
  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /copyright-check confirmation changed/);
  assert.equal(h.counts().clicks, 1);
  assert.equal(h.counts().postNowClicks, 0);
});

test('captures the fresh permalink after TikTok redirects to Studio Content', async () => {
  const h = harness({ contentRedirect: true });
  const result = await h.run();
  assert.equal(result.status, 'PUBLISHED', result.reason);
  assert.match(result.postUrl, /^https:\/\/www\.tiktok\.com\/@creator\/video\/\d+$/);
  assert.equal(h.counts().clicks, 1);
});

test('reports processing when the matching Studio Content row remains Reviewing', async () => {
  const h = harness({ contentRedirect: true, contentReviewing: true });
  const result = await h.run();
  assert.equal(result.status, 'PROCESSING', result.reason);
  assert.match(result.reason, /reviewing/i);
  assert.equal(h.counts().clicks, 1);
});

test('defers identity to the installation-bound guard on the upload surface', async () => {
  const h = harness({ noProfile: true, outcome: 'processing' });
  const result = await h.run();
  assert.equal(result.status, 'PROCESSING', result.reason);
  assert.equal(h.counts().clicks, 1);
  assert.equal(h.counts().arms, 1);
});

test('discards the verified local draft before attaching the scheduled video', async () => {
  const h = harness({ localDraft: true, outcome: 'processing' });
  const result = await h.run();
  assert.equal(result.status, 'PROCESSING', result.reason);
  assert.equal(h.counts().discardClicks, 1);
  assert.equal(h.counts().confirmationClicks, 1);
  assert.equal(h.counts().fetches, 1);
  assert.equal(h.counts().clicks, 1);
});

test('does not guess when the local draft Discard control is unrecognized', async () => {
  const h = harness({ localDraft: true, draftDiscardText: 'Keep editing' });
  const result = await h.run();
  assert.equal(result.status, 'FAILED');
  assert.equal(result.reason, 'LOCAL_DRAFT_PRESENT');
  assert.equal(h.counts().discardClicks, 0);
  assert.equal(h.counts().fetches, 0);
});

test('pauses safely when TikTok does not clear the discarded local draft', async () => {
  const h = harness({ localDraft: true, stuckDraft: true });
  const result = await h.run();
  assert.equal(result.status, 'FAILED');
  assert.equal(result.reason, 'LOCAL_DRAFT_DISCARD_TIMEOUT');
  assert.equal(result.shouldPauseQueue, true);
  assert.equal(h.counts().discardClicks, 1);
  assert.equal(h.counts().confirmationClicks, 1);
  assert.equal(h.counts().fetches, 0);
});

test('does not guess when the discard confirmation control is unrecognized', async () => {
  const h = harness({ localDraft: true, confirmDiscardText: 'Remove' });
  const result = await h.run();
  assert.equal(result.status, 'FAILED');
  assert.equal(result.reason, 'LOCAL_DRAFT_CONFIRMATION_UNAVAILABLE');
  assert.equal(result.shouldPauseQueue, true);
  assert.equal(h.counts().discardClicks, 1);
  assert.equal(h.counts().confirmationClicks, 0);
  assert.equal(h.counts().fetches, 0);
});

for (const [name, options] of [
  ['account mismatch', { expected: 'different' }], ['cancellation', { canceled: true }],
  ['disabled button', { disabled: true }], ['ambiguous button', { extraButton: true }],
  ['caption failure', { captionFailure: true }], ['upload still pending', { preparation: 'Uploading' }],
]) test(`stops before arming/Post on ${name}`, async () => {
  const h = harness(options);
  assert.equal((await h.run()).status, 'FAILED');
  assert.equal(h.counts().clicks, 0);
  assert.equal(h.counts().arms, 0);
});

for (const [name, options] of [
  ['lost checkpoint response', { lostArm: true }], ['denied checkpoint', { deniedArm: true }],
  ['canceled after checkpoint', { canceledAfterArm: true }],
]) test(`${name} remains uncertain without clicking Post`, async () => {
  const h = harness(options);
  assert.equal((await h.run()).status, 'UNKNOWN');
  assert.equal(h.counts().clicks, 0);
});

for (const [name, options] of [
  ['timeout', {}], ['wrong-owner URL', { outcome: 'wrong-owner' }],
  ['old permalink', { oldUrl: 'https://www.tiktok.com/@creator/video/123456' }],
]) test(`${name} cannot prove publication or trigger a retry`, async () => {
  const h = harness(options);
  assert.equal((await h.run()).status, 'UNKNOWN');
  assert.equal(h.counts().clicks, 1);
});

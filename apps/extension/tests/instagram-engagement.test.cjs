const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadExtractor(html, href) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({
    document,
    URL,
    window: {
      ...window,
      location: new URL(href),
      getComputedStyle: () => ({ display: '', visibility: '' }),
      setTimeout: (callback) => { callback(); return 0; },
    },
    setTimeout: (callback) => { callback(); return 0; },
    console: { info() {}, debug() {}, warn() {}, error() {} },
  });
  const source = readFileSync(resolve(__dirname, '../src/platforms/instagram/engagement.ts'), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context.PostFlowInstagramEngagement;
}

test('extracts Instagram likes and comments from a post detail scope', async () => {
  const api = loadExtractor(`
    <div role="dialog">
      <a href="/ema.d1852/p/DeOaDcwHEsk/">post</a>
      <span>12 likes</span>
      <span>3 comments</span>
    </div>
  `, 'https://www.instagram.com/p/DeOaDcwHEsk/');

  assert.deepEqual(await api.check('https://www.instagram.com/p/DeOaDcwHEsk/'), {
    status: 'SUCCESS',
    reactionCount: 12,
    commentCount: 3,
  });
});

test('defaults missing likes to zero when the Like control is rendered', async () => {
  const api = loadExtractor(`
    <div role="dialog">
      <a href="/ema.d1852/p/DeOaDcwHEsk/">post</a>
      <svg aria-label="Like"></svg>
      <div>No comments yet.</div>
      <div>Start the conversation.</div>
    </div>
  `, 'https://www.instagram.com/ema.d1852/p/DeOaDcwHEsk/');

  assert.deepEqual(await api.check('https://www.instagram.com/p/DeOaDcwHEsk/'), {
    status: 'SUCCESS',
    reactionCount: 0,
    commentCount: 0,
  });
});

test('selects the full post scope when the permalink toolbar is a nested ancestor', async () => {
  const api = loadExtractor(`
    <main role="main">
      <article>
        <a href="/ema.d1852/p/DeOaDcwHEsk/">post</a>
        <div class="toolbar">
          <svg aria-label="Like"></svg>
          <svg aria-label="Comment"></svg>
        </div>
        <div>No comments yet.</div>
      </article>
    </main>
  `, 'https://www.instagram.com/ema.d1852/p/DeOaDcwHEsk/');

  assert.deepEqual(await api.check('https://www.instagram.com/p/DeOaDcwHEsk/'), {
    status: 'SUCCESS',
    reactionCount: 0,
    commentCount: 0,
  });
});

test('extracts standalone numeric counters from Instagram action text', async () => {
  const api = loadExtractor(`
    <main role="main">
      <article>
        <a href="/ema.d1852/p/DeOaDcwHEsk/">post</a>
        <div class="toolbar">
          <svg aria-label="Unlike"></svg><span>1</span>
          <svg aria-label="Comment"></svg><span>1</span>
        </div>
      </article>
    </main>
  `, 'https://www.instagram.com/ema.d1852/p/DeOaDcwHEsk/');

  assert.deepEqual(await api.check('https://www.instagram.com/p/DeOaDcwHEsk/'), {
    status: 'SUCCESS',
    reactionCount: 1,
    commentCount: 1,
  });
});

test('treats explicit no-like copy as a verified zero', async () => {
  const api = loadExtractor(`
    <div role="dialog">
      <a href="/ema.d1852/p/DeOaDcwHEsk/">post</a>
      <div>Be the first to like this</div>
      <div>No comments yet.</div>
    </div>
  `, 'https://www.instagram.com/p/DeOaDcwHEsk/');

  assert.deepEqual(await api.check('https://www.instagram.com/p/DeOaDcwHEsk/'), {
    status: 'SUCCESS',
    reactionCount: 0,
    commentCount: 0,
  });
});

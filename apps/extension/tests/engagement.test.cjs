const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

const targetUrl = 'https://www.facebook.com/groups/123/posts/456/';
const link = '<a href="https://www.facebook.com/groups/123/?multi_permalinks=456" aria-label="1ي">1ي</a>';
function actions(reactions = '', comments = '') {
  return `<div><div role="button"><div><div data-ad-rendering-role="like_button"></div></div><div><span dir="auto">${reactions}</span></div></div>
    <div role="button"><div><div data-ad-rendering-role="comment_button"></div></div><div><span dir="auto">${comments}</span></div></div></div>`;
}
function modal(body) {
  return `<div role="dialog" id="target"><div role="article">${link}</div>${body}</div>`;
}
function setup(html, update = () => {}) {
  const { document, Element } = parseHTML(`<html><body>${html}</body></html>`);
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  const logs = [];
  const context = vm.createContext({
    document, Element, URL, Date: Clock,
    window: { location: { href: targetUrl }, getComputedStyle: (el) => ({ display: el.style.display, visibility: el.style.visibility }) },
    console: Object.fromEntries(['log', 'debug', 'warn'].map((level) => [level, (...args) => logs.push(args)])),
    setTimeout: (callback, delay) => { now += delay; update(document, now); callback(); },
  });
  for (const file of ['parse-facebook-count.ts', 'extract-engagement.ts']) {
    const source = readFileSync(resolve(__dirname, '../src/post-tracking', file), 'utf8');
    vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  }
  return { document, context, logs,
    run: async () => JSON.parse(JSON.stringify(await context.waitForPostEngagement(targetUrl, 4000))),
  };
}

test('background controls cannot satisfy readiness for a loading target dialog', async () => {
  const app = setup(`<div role="article">${actions('9', '8')}</div>${modal('')}`);
  const result = await app.run();
  assert.equal(result.status, 'CHECK_FAILED');
  assert.match(result.reason, /did not finish rendering.*v6/);
});

test('waits for the target modal to be replaced and hydrated', async () => {
  let replaced = false;
  const app = setup(`<div role="article">${actions('9', '8')}</div>${modal('')}`, (doc, now) => {
    if (now >= 750 && !replaced) {
      replaced = true;
      doc.getElementById('target').outerHTML = modal(actions('١', '٤'));
    }
  });
  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 1, commentCount: 4 });
});

test('removing the last comment replaces the previous count with explicit zero', async () => {
  const app = setup(modal(actions('١', '١')));
  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 1, commentCount: 1 });
  app.document.getElementById('target').outerHTML = modal(`${actions('١')}<h3>لا توجد تعليقات حتى الآن</h3>`);
  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 1, commentCount: 0 });
});

test('post age is never a reaction count in the provided Arabic empty layout', async () => {
  const app = setup(modal(`${actions()}<h3>لا توجد تعليقات حتى الآن</h3>`));
  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 0, commentCount: 0 });
  assert.equal(app.context.extractNumericCount('1ي'), null);
});

test('a hidden stale modal is ignored in favor of the visible target', async () => {
  const app = setup(`<div hidden>${modal(actions('8', '9'))}</div>${modal(actions('٢', '٣'))}`);
  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 2, commentCount: 3 });
});

test('missing comment evidence stays unknown instead of borrowing the reaction count', async () => {
  const app = setup(modal(actions('٣')));
  const result = await app.run();
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.reactionCount, 3);
  assert.equal(result.commentCount, undefined);
});

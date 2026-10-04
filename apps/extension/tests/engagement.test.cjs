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
function setup(html, update = () => {}, href = targetUrl) {
  const { document, Element } = parseHTML(`<html><body>${html}</body></html>`);
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  const logs = [];
  const context = vm.createContext({
    document, Element, URL, Date: Clock,
    window: { location: { href }, getComputedStyle: (el) => ({ display: el.style.display, visibility: el.style.visibility }) },
    console: Object.fromEntries(['log', 'debug', 'warn'].map((level) => [level, (...args) => logs.push(args)])),
    setTimeout: (callback, delay) => { now += delay; update(document, now); callback(); },
  });
  for (const file of ['parse-facebook-count.ts', 'extract-engagement.ts']) {
    const source = readFileSync(resolve(__dirname, '../src/post-tracking', file), 'utf8');
    vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  }
  return { document, context, logs,
    run: async (timeoutMs = 4000) => JSON.parse(JSON.stringify(await context.waitForPostEngagement(href, timeoutMs))),
  };
}

test('background controls cannot satisfy readiness for a loading target dialog', async () => {
  const app = setup(`<div role="article">${actions('9', '8')}</div>${modal('')}`);
  const result = await app.run();
  assert.equal(result.status, 'CHECK_FAILED');
  assert.match(result.reason, /did not finish rendering.*v12/);
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

test('extracts engagement from a profile reel matched by its permalink', async () => {
  const reelUrl = 'https://www.facebook.com/reel/1490054189671164/';
  const app = setup(`
    <div role="dialog" id="target">
      <div role="article">
        <a href="${reelUrl}">reel</a>
        ${actions('12', '3')}
      </div>
    </div>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 12, commentCount: 3 });
});

test('extracts engagement from a direct reel matched by data-video-id', async () => {
  const reelUrl = 'https://www.facebook.com/reel/1636327731333442/';
  const app = setup(`
    <div role="dialog" id="target">
      <div role="article">
        <div data-video-id="1636327731333442"></div>
        ${actions('5', '2')}
      </div>
    </div>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 5, commentCount: 2 });
});

test('does not let an unrelated dialog hide the profile reel article', async () => {
  const reelUrl = 'https://www.facebook.com/reel/1717171717171717/';
  const app = setup(`
    <div role="dialog"><div>unrelated dialog</div></div>
    <div role="article">
      <a href="${reelUrl}">reel</a>
      ${actions('7', '4')}
    </div>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 7, commentCount: 4 });
});

test('matches a direct reel page with one action-bearing article and no reel identity markup', async () => {
  const reelUrl = 'https://www.facebook.com/reel/1818181818181818/';
  const app = setup(`
    <div role="article"><span>related article</span></div>
    <div role="article">
      ${actions('6', '1')}
    </div>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 6, commentCount: 1 });
});

test('matches a reel dialog without an article wrapper from its permalink', async () => {
  const reelUrl = 'https://www.facebook.com/reel/1919191919191919/';
  const app = setup(`
    <div role="dialog">
      <a href="${reelUrl}">reel</a>
      ${actions('11', '2')}
    </div>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 11, commentCount: 2 });
});

test('matches a direct reel main viewer without an article or identity markup', async () => {
  const reelUrl = 'https://www.facebook.com/reel/2020202020202020/';
  const app = setup(`
    <main role="main">
      ${actions('4', '3')}
    </main>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 4, commentCount: 3 });
});

test('does not guess between multiple direct reel engagement control pairs', async () => {
  const reelUrl = 'https://www.facebook.com/reel/2121212121212121/';
  const app = setup(`
    <main role="main">
      <section>${actions('4', '3')}</section>
      <section>${actions('8', '6')}</section>
    </main>
  `, () => {}, reelUrl);

  const result = await app.run();
  assert.equal(result.status, 'CHECK_FAILED');
  assert.match(result.reason, /extractor=v12, targetFound=false/);
});

test('recognizes active Arabic reel reaction and comment controls', async () => {
  const reelUrl = 'https://www.facebook.com/reel/1432104411755065/';
  const app = setup(`
    <main role="main">
      <div data-video-id="1432104411755065">
        <div role="button" aria-label="\u0625\u0632\u0627\u0644\u0629 \u0623\u0639\u062c\u0628\u0646\u064a"><span>\u0661</span></div>
        <div role="button" aria-label="\u062a\u063a\u064a\u064a\u0631 \u062a\u0641\u0627\u0639\u0644 &quot;\u0623\u0639\u062c\u0628\u0646\u064a&quot;"></div>
        <div role="button" aria-label="\u062a\u0639\u0644\u064a\u0642"><span>\u0660</span></div>
      </div>
    </main>
  `, () => {}, reelUrl);

  assert.deepEqual(await app.run(), { status: 'SUCCESS', reactionCount: 1, commentCount: 0 });
});

test('classifies an empty target page for a foreground rendering retry', async () => {
  const app = setup('', () => {}, targetUrl);
  const result = await app.run(25000);

  assert.equal(result.status, 'CHECK_FAILED');
  assert.equal(result.emptySurface, true);
  assert.match(result.reason, /extractor=v12.*articles=0.*likes=0.*comments=0/);
});

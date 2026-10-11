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

async function check(api, targetUrl) {
  // The extractor runs in a VM realm; normalize the result before strict
  // deep-equality assertions so the test checks data rather than prototypes.
  return JSON.parse(JSON.stringify(await api.check(targetUrl)));
}

test('extracts Instagram likes and comments from a post detail scope', async () => {
  const api = loadExtractor(`
    <div role="dialog">
      <a href="/ema.d1852/p/DeOaDcwHEsk/">post</a>
      <span>12 likes</span>
      <span>3 comments</span>
    </div>
  `, 'https://www.instagram.com/p/DeOaDcwHEsk/');

  assert.deepEqual(await check(api, 'https://www.instagram.com/p/DeOaDcwHEsk/'), {
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

  assert.deepEqual(await check(api, 'https://www.instagram.com/p/DeOaDcwHEsk/'), {
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

  assert.deepEqual(await check(api, 'https://www.instagram.com/p/DeOaDcwHEsk/'), {
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

  assert.deepEqual(await check(api, 'https://www.instagram.com/p/DeOaDcwHEsk/'), {
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

  assert.deepEqual(await check(api, 'https://www.instagram.com/p/DeOaDcwHEsk/'), {
    status: 'SUCCESS',
    reactionCount: 0,
    commentCount: 0,
  });
});

test('extracts zero engagement from the active Reel viewer without a permalink anchor', async () => {
  const api = loadExtractor(`
    <main role="main">
      <div class="active-reel">
        <video></video>
        <div class="actions">
          <svg aria-label="Like"></svg>
          <svg aria-label="Comment"></svg>
        </div>
      </div>
      <div class="neighbor-reel">
        <svg aria-label="Like"></svg><span>4.1M</span>
        <svg aria-label="Comment"></svg><span>14.1K</span>
      </div>
    </main>
  `, 'https://www.instagram.com/reel/active-reel/');

  assert.deepEqual(await check(api, 'https://www.instagram.com/reel/active-reel/'), {
    status: 'SUCCESS',
    reactionCount: 0,
    commentCount: 0,
  });
});

test('does not mix neighboring Reel counters into the active empty toolbar', async () => {
  const api = loadExtractor(`
    <main role="main">
      <div class="viewer-shell">
        <div class="active-reel">
          <video></video>
          <div class="actions">
            <svg aria-label="Like"></svg>
            <svg aria-label="Comment"></svg>
          </div>
        </div>
        <div class="neighbor-reel">
          <svg aria-label="Like"></svg><span>1.6M</span>
          <svg aria-label="Comment"></svg><span>15.5K</span>
        </div>
      </div>
    </main>
  `, 'https://www.instagram.com/reels/active-reel/');

  assert.deepEqual(await check(api, 'https://www.instagram.com/reel/active-reel/'), {
    status: 'SUCCESS',
    reactionCount: 0,
    commentCount: 0,
  });
});

test('extracts active Reel viewer counters without a permalink anchor', async () => {
  const api = loadExtractor(`
    <main role="main">
      <div class="active-reel">
        <video></video>
        <div class="actions">
          <svg aria-label="Unlike"></svg><span>1</span>
          <svg aria-label="Comment"></svg><span>1</span>
        </div>
      </div>
    </main>
  `, 'https://www.instagram.com/reel/active-reel/');

  assert.deepEqual(await check(api, 'https://www.instagram.com/reel/active-reel/'), {
    status: 'SUCCESS',
    reactionCount: 1,
    commentCount: 1,
  });
});

function reelActions(likes, comments) {
  // Same boundaries as the supplied Reel DOM: a nested Like icon button,
  // sibling Like counter button, and Comment counter inside its own button.
  return `<div class="actions">
    <div class="like-action">
      <span><div><div role="button"><div><span><svg aria-label="Unlike"><title>Unlike</title></svg></span></div></div></div></span>
      <div role="button"><div><div>${likes === null ? '' : `<div><span><span>${likes}</span></span></div>`}</div></div></div>
    </div>
    <div class="comment-action"><div role="button" aria-haspopup="menu">
      <div><svg aria-label="Comment"><title>Comment</title></svg><div><div>${comments === null ? '' : `<span>${comments}</span>`}</div></div></div>
    </div></div>
  </div>`;
}

for (const [name, likes, comments, expectedLikes, expectedComments] of [
  ['one Like and an empty Comment counter', '1', null, 1, 0],
  ['empty Like and three Comments', null, '3', 0, 3],
  ['independent nonzero counters', '12', '3', 12, 3],
  ['abbreviated counters', '1.6M', '15.5K', 1600000, 15500],
]) {
  test(`extracts ${name} from nested Reel buttons with SVG titles`, async () => {
    const api = loadExtractor(`<main><div class="active-reel"><video></video>${reelActions(likes, comments)}<p>Caption 2026</p></div></main>`, 'https://www.instagram.com/reel/active-reel/');
    assert.deepEqual(await check(api, 'https://www.instagram.com/reel/active-reel/'), {
      status: 'SUCCESS', reactionCount: expectedLikes, commentCount: expectedComments,
    });
  });
}

test('does not interpret compact SVG titles as prose comment counts', async () => {
  const api = loadExtractor(`<main><div><video></video><div class="actions"><svg aria-label="Unlike"><title>Unlike</title></svg><span>1</span><svg aria-label="Comment"><title>Comment</title></svg></div></div></main>`, 'https://www.instagram.com/reel/active-reel/');
  assert.deepEqual(await check(api, 'https://www.instagram.com/reel/active-reel/'), {
    status: 'SUCCESS', reactionCount: 1, commentCount: 0,
  });
});

for (const [likes, comments, expectedLikes, expectedComments] of [
  [null, '١', 0, 1],
  ['١', null, 1, 0],
  ['١٢', '٣', 12, 3],
  ['١٬٢٣٤', '۱۲', 1234, 12],
  ['١٫٦M', '١٥٫٥K', 1600000, 15500],
]) {
  test(`reads Arabic Reel action counters independently (${likes}/${comments})`, async () => {
    const actions = reelActions(likes, comments).replaceAll('Unlike', 'إلغاء الإعجاب').replaceAll('Comment', 'تعليق');
    const api = loadExtractor(`<main><div><video></video>${actions}<p>Caption 2026</p></div><div>${reelActions('4.1M', '14.1K')}</div></main>`, 'https://www.instagram.com/reels/active-reel/');
    assert.deepEqual(await check(api, 'https://www.instagram.com/reels/active-reel/'), {
      status: 'SUCCESS', reactionCount: expectedLikes, commentCount: expectedComments,
    });
  });
}

function photoAction(label, count) {
  return `<span><div><div role="button"><div><span><svg aria-label="${label}"><title>${label}</title></svg></span></div></div></div></span>${count === null ? '' : `<span role="button">${count}</span>`}`;
}

for (const [likes, comments, expectedLikes] of [['١', '١', 1], [null, '١', 0]]) {
  test(`reads Arabic photo sibling counters without mixing actions (${likes}/${comments})`, async () => {
    const api = loadExtractor(`<main><article><a href="/ema.d1852/p/photo/">post</a><div>${photoAction('أعجبني', likes)}${photoAction('تعليق', comments)}${photoAction('مشاركة', null)}</div><p>Caption 2026</p></article></main>`, 'https://www.instagram.com/p/photo/');
    assert.deepEqual(await check(api, 'https://www.instagram.com/p/photo/'), {
      status: 'SUCCESS', reactionCount: expectedLikes, commentCount: 1,
    });
  });
}

test('supports English photo counters with the same sibling structure', async () => {
  const api = loadExtractor(`<article><a href="/p/photo/">post</a><div>${photoAction('Unlike', '2')}${photoAction('Comment', '1')}</div></article>`, 'https://www.instagram.com/p/photo/');
  assert.deepEqual(await check(api, 'https://www.instagram.com/p/photo/'), {
    status: 'SUCCESS', reactionCount: 2, commentCount: 1,
  });
});

test('supports Arabic prose counters and explicitly empty comments', async () => {
  const api = loadExtractor('<div role="dialog"><a href="/p/photo/">post</a><svg aria-label="أعجبني"></svg><span>١٢ إعجاب</span><p>لا توجد تعليقات حتى الآن.</p></div>', 'https://www.instagram.com/p/photo/');
  assert.deepEqual(await check(api, 'https://www.instagram.com/p/photo/'), {
    status: 'SUCCESS', reactionCount: 12, commentCount: 0,
  });
});

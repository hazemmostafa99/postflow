const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function setup(html, href = 'https://www.facebook.com/profile.php?id=12345') {
  const { document, window, HTMLElement } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({
    document,
    HTMLElement,
    URL,
    window: {
      location: new URL(href),
      getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    },
  });
  const source = readFileSync(resolve(__dirname, '../src/profile-composer.ts'), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context;
}

const target = {
  type: 'PROFILE_FEED',
  facebookConnectionId: 'connection-1',
  facebookUserId: '12345',
  url: 'https://www.facebook.com/profile.php?id=12345',
};

test('requires the expected canonical profile page', () => {
  const app = setup('<main role="main"></main>');
  assert.equal(app.isExpectedProfileFeed(target), true);
  assert.equal(app.isExpectedProfileFeed(target, 'https://www.facebook.com/profile.php?id=99999'), false);
  assert.equal(app.isExpectedProfileFeed(target, 'https://www.facebook.com/feed/'), false);
});

test('selects the profile composer while excluding stories and feed articles', () => {
  const app = setup(`
    <main role="main">
      <button aria-label="Create a story">Story</button>
      <div role="article"><button aria-label="What's on your mind?">old post</button></div>
      <div role="button" aria-label="What's on your mind, PostFlow?"><span>What's on your mind?</span></div>
    </main>
  `);
  assert.equal(app.findProfileComposerTrigger()?.getAttribute('aria-label'), "What's on your mind, PostFlow?");
});

test('accepts profile composer triggers inside the profile composer surface', () => {
  const app = setup(`
    <main role="main">
      <div role="article"><button aria-label="What's on your mind?">old post</button></div>
      <div data-pagelet="ProfileComposer" role="article">
        <div role="button" aria-label="Write a public post">
          <span>Write a public post</span>
        </div>
      </div>
    </main>
  `);
  assert.equal(app.findProfileComposerTrigger()?.getAttribute('aria-label'), 'Write a public post');
});

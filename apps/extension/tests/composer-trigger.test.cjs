const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

const source = readFileSync(resolve(__dirname, '../src/find-composer-trigger.ts'), 'utf8');
function setup(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({ document, window: { getComputedStyle: () => ({}) } });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return { document, find: () => context.findComposerTrigger() };
}

// Structure from the supplied English Facebook HTML: profile, unlabelled
// role=button containing a span, then secondary composer actions.
const composer = `<a role="link" tabindex="0" href="/profile">Profile</a>
  <div id="composer" role="button" tabindex="0"><div><span>Write something...</span></div><div role="none"></div></div>
  <div role="button" aria-label="Anonymous post">Anonymous post</div>
  <div role="button" aria-label="Feeling/activity">Feeling/activity</div>
  <div role="button" aria-label="Poll">Poll</div>`;

test('English composer without a pagelet is selected ahead of invite and create actions', () => {
  const app = setup(`<main role="main"><button>Invite</button>
    <button aria-label="Create an invite">Create</button>${composer}</main>`);
  assert.equal(app.find()?.textContent, 'Write something...');
});

test('pagelet does not select its first button or focusable profile link', () => {
  const app = setup(`<div data-pagelet="GroupInlineComposer"><button>Invite</button>${composer}</div>`);
  assert.equal(app.find()?.textContent, 'Write something...');
});

test('returns null until a real composer trigger is rendered', () => {
  const app = setup(`<main role="main"><div data-pagelet="GroupInlineComposer">
    <button>Invite</button><input aria-placeholder="Search" />
    <button aria-label="Create event">Create event</button></div></main>`);
  assert.equal(app.find(), null);
  app.document.querySelector('main').insertAdjacentHTML('beforeend', composer);
  assert.equal(app.find()?.textContent, 'Write something...');
});

test('ignores post text, dialogs, hidden controls, and unrelated accessible labels', () => {
  const app = setup(`<article role="article"><button>Write something...</button></article>
    <div role="dialog"><button>Create post</button></div>
    <div hidden><button>Write something...</button></div>
    <button aria-disabled="true">Create a post</button>
    <button aria-label="Invite">Write something...</button>`);
  assert.equal(app.find(), null);
});

for (const prompt of ['Write something…', 'Create a post', 'Create post', "What's on your mind?", 'What’s on your mind?', 'اكتب شيئًا...', 'اكتب شيء', 'ما الذي يدور في ذهنك؟']) {
  test(`recognizes composer prompt: ${prompt}`, () => {
    const app = setup(`<button id="composer" aria-label="${prompt}"></button>`);
    assert.equal(app.find()?.id, 'composer');
  });
}

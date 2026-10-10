const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsxRuntime = require('react/jsx-runtime');

function loadModule(path, imports = {}, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(resolve(__dirname, path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, require: (name) => imports[name] ?? {}, process: { env: { NEXT_PUBLIC_INSTAGRAM_PUBLISHING_ENABLED: 'true', NEXT_PUBLIC_TIKTOK_PUBLISHING_ENABLED: 'true' } },
    ...globals,
  });
  return exports;
}

const publishing = loadModule('../src/lib/instagram-publishing.ts');
const tiktokPublishing = loadModule('../src/lib/tiktok-publishing.ts');
const image = 'data:image/png;base64,aW1hZ2U=';
const video = 'data:video/mp4;base64,dmlkZW8=';

test('one image resolves to an explicit Feed job', () => {
  assert.equal(publishing.resolveInstagramMedia([image]).label, 'Photo post');
  assert.equal(publishing.buildInstagramTarget('account-1', [image]).type, 'INSTAGRAM_FEED');
});

test('one video resolves to an explicit Reel job', () => {
  assert.equal(publishing.resolveInstagramMedia([video]).label, 'Reel');
  assert.equal(publishing.buildInstagramTarget('account-1', [video]).type, 'INSTAGRAM_REEL');
});

for (const [name, media] of [
  ['no attachment', []],
  ['mixed image/video', [image, video]], ['multiple videos', [video, video]],
  ['unsupported media', ['data:application/pdf;base64,Zm9v']],
]) {
  test(`${name} does not produce an Instagram job`, () => {
    assert.equal(publishing.resolveInstagramMedia(media).ready, false);
    assert.equal(publishing.resolveInstagramMedia(media).targetType, null);
    assert.throws(() => publishing.buildInstagramTarget('account-1', media));
  });
}

test('multiple images resolve to one Instagram Feed carousel job', () => {
  const selection = publishing.resolveInstagramMedia([image, image]);
  assert.equal(selection.ready, true);
  assert.equal(selection.label, 'Carousel');
  assert.equal(publishing.buildInstagramTarget('account-1', [image, image]).type, 'INSTAGRAM_FEED');
});

// Exercise the actual form callbacks with a minimal hook harness. No DOM or
// live platform publishing is needed to inspect the submitted API payload.
function createFormHarness(tiktokEnabled = true) {
  const slots = [];
  const requests = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useMemo: (callback) => callback(), useCallback: (callback) => callback,
    useEffect() {},
  };
  function InstagramDestinationMenu() {}
  function TikTokDestinationMenu() {}
  const { CreatePostForm } = loadModule('../src/components/create-post-form.tsx', {
    react: hooks,
    'react/jsx-runtime': jsxRuntime,
    'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
    '@/components/instagram-destination-menu': { InstagramDestinationMenu },
    '@/components/tiktok-destination-menu': { TikTokDestinationMenu },
    '@/lib/instagram-publishing': publishing,
    '@/lib/tiktok-publishing': tiktokPublishing,
  }, {
    process: { env: { NEXT_PUBLIC_INSTAGRAM_PUBLISHING_ENABLED: 'true', NEXT_PUBLIC_TIKTOK_PUBLISHING_ENABLED: String(tiktokEnabled) } },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    },
    window: { localStorage: { setItem() {} }, dispatchEvent() {} },
    CustomEvent: class {},
    FileReader: class {
      readAsDataURL(file) { this.result = file.url; this.onload(); }
    },
  });
  const group = { _id: 'group-1', name: 'Test group', externalId: '123', status: 'ACTIVE' };
  const account = { _id: 'account-1', externalUsername: 'tester', detectedExternalUsername: 'tester', status: 'CONNECTED', sessionDetected: true };
  function render() { cursor = 0; return CreatePostForm({ groups: [group] }); }
  function all(element) {
    if (!element || typeof element !== 'object') return [];
    return [element, ...[element.props?.children].flat(Infinity).flatMap(all)];
  }
  function find(predicate) { return all(render()).find(predicate); }
  function menu() { return find((element) => element.type === InstagramDestinationMenu); }
  function tiktokMenu() { return find((element) => element.type === TikTokDestinationMenu); }
  async function upload(url) {
    const type = url.startsWith('data:video/') ? 'video/mp4' : 'image/png';
    await find((element) => element.type === 'input' && element.props.type === 'file').props.onChange({ target: { files: [{ type, size: 10, url }], value: 'file' } });
  }
  function submit() { return render().props.onSubmit({ preventDefault() {} }); }
  return { requests, account, render, all, find, menu, tiktokMenu, upload, submit };
}

test('TikTok creates a photo target for images and participates in mixed platform scheduling with one video', async () => {
  const form = createFormHarness();
  form.tiktokMenu().props.onToggle(form.account);
  await form.upload(image);
  await form.submit();
  assert.equal(form.requests[0].body.targets[0].type, 'TIKTOK_PHOTO');
  form.find((element) => element.type === 'button' && element.props['aria-label'] === 'Remove media').props.onClick();
  await form.upload(video);
  form.menu().props.onToggle(form.account);
  form.find((element) => element.type === 'button' && Array.isArray(element.props.children) && element.props.children.includes('Schedule')).props.onClick();
  form.find((element) => element.type === 'input' && element.props.type === 'datetime-local').props.onChange({ target: { value: '2026-10-15T14:30' } });
  await form.submit();
  assert.equal(form.requests[1].body.targets[0].type, 'TIKTOK_VIDEO');
  assert.equal(form.requests[1].body.targets[1].type, 'INSTAGRAM_REEL');
  assert.equal(form.requests[1].body.targets[0].platformConnectionId, 'account-1');
  assert.equal(form.requests[1].body.startTime, new Date('2026-10-15T14:30').toISOString());
});

test('TikTok resolves multiple images to one photo post and rejects mixed media', () => {
  assert.equal(tiktokPublishing.buildTikTokTarget('account-1', [image, image]).type, 'TIKTOK_PHOTO');
  assert.equal(tiktokPublishing.getTikTokMediaLabel([image, image]), 'Photo post');
  assert.throws(() => tiktokPublishing.buildTikTokTarget('account-1', [image, video]));
});

test('TikTok refuses mismatched accounts and clears its destination', async () => {
  const form = createFormHarness();
  form.tiktokMenu().props.onToggle({ ...form.account, detectedExternalUsername: 'wrong' });
  assert.equal(form.tiktokMenu().props.selectedIds.length, 0);
  form.tiktokMenu().props.onToggle(form.account);
  assert.equal(form.tiktokMenu().props.selectedIds.length, 1);
  form.tiktokMenu().props.onClear();
  assert.equal(form.tiktokMenu().props.selectedIds.length, 0);
});

test('disabled TikTok cannot be selected through the form callback', () => {
  const form = createFormHarness(false);
  assert.equal(form.tiktokMenu().props.publishingEnabled, false);
  form.tiktokMenu().props.onToggle(form.account);
  assert.equal(form.tiktokMenu().props.selectedIds.length, 0);
});

test('form shows one Instagram menu and keeps one selected account across media changes', async () => {
  const form = createFormHarness();
  const menuType = form.menu().type;
  assert.equal(form.all(form.render()).filter((element) => element.type === menuType).length, 1);
  form.menu().props.onToggle(form.account);
  assert.equal(form.menu().props.mediaSelection.targetType, null);
  assert.equal(form.find((element) => element.type === 'button' && element.props.type === 'submit').props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 0);
  await form.upload(image);
  await form.submit();
  assert.equal(form.requests[0].body.targets[0].type, 'INSTAGRAM_FEED');
  // The selected chip removes an account, not a media-dependent destination.
  assert.deepEqual(Array.from(form.menu().props.selectedIds), ['account-1']);
  form.find((element) => element.type === 'button' && element.props['aria-label'] === 'Remove media').props.onClick();
  await form.upload(video);
  assert.deepEqual(Array.from(form.menu().props.selectedIds), ['account-1']);
  await form.submit();
  assert.equal(form.requests[1].body.targets.length, 1);
  assert.equal(form.requests[1].body.targets[0].type, 'INSTAGRAM_REEL');
  assert.equal(form.requests[1].body.targets[0].platformConnectionId, 'account-1');
});

test('form prevents mixed-media Instagram submission and recovers when deselected', async () => {
  const form = createFormHarness();
  form.menu().props.onToggle(form.account);
  await form.upload(image);
  await form.upload(video);
  assert.equal(form.menu().props.mediaSelection.ready, false);
  assert.equal(form.find((element) => element.type === 'button' && element.props.type === 'submit').props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 0);
  form.menu().props.onClear();
  assert.equal(form.menu().props.selectedIds.length, 0);
  form.find((element) => element.type === 'button' && element.props.role === 'option' && element.key === 'group-1').props.onClick();
  await form.submit();
  assert.equal(form.requests[0].body.targets.length, 1);
  assert.equal(form.requests[0].body.targets[0].type, 'GROUP');
  assert.equal(form.requests[0].body.targets[0].groupId, 'group-1');
  assert.equal(form.requests[0].body.mediaUrls.length, 2);
});

test('scheduled publishing preserves destination order and the explicit Instagram target', async () => {
  const form = createFormHarness();
  form.find((element) => element.type === 'button' && element.props.role === 'option' && element.key === 'group-1').props.onClick();
  form.menu().props.onToggle(form.account);
  await form.upload(video);
  form.find((element) => element.type === 'button' && Array.isArray(element.props.children) && element.props.children.includes('Schedule')).props.onClick();
  const scheduled = '2026-10-15T14:30';
  form.find((element) => element.type === 'input' && element.props.type === 'datetime-local').props.onChange({ target: { value: scheduled } });
  await form.submit();
  const payload = form.requests[0].body;
  assert.equal(payload.targets[0].type, 'GROUP');
  assert.equal(payload.targets[1].type, 'INSTAGRAM_REEL');
  assert.equal(payload.startTime, new Date(scheduled).toISOString());
});

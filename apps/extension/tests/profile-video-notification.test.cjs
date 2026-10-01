const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function setup(html = '') {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({ document, URL });
  const source = readFileSync(resolve(__dirname, '../src/profile-video-notification.ts'), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return { context, document };
}

test('canonicalizes a processed profile-video notification reel URL', () => {
  const { context } = setup();
  const result = context.parseProcessedProfileVideoNotificationUrl(
    'https://www.facebook.com/reel/1096008889716174?s=notification_fb_shorts_video_processed&notif_id=1790880757718638&notif_t=fb_shorts_video_processed&ref=notif',
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    key: 'notification:1790880757718638',
    notificationId: '1790880757718638',
    postUrl: 'https://www.facebook.com/reel/1096008889716174/',
  });
});

test('rejects ordinary reel links and unrelated notification types', () => {
  const { context } = setup();
  assert.equal(
    context.parseProcessedProfileVideoNotificationUrl('https://www.facebook.com/reel/123/'),
    null,
  );
  assert.equal(
    context.parseProcessedProfileVideoNotificationUrl(
      'https://www.facebook.com/reel/123/?notif_t=comment_mention&notif_id=456',
    ),
    null,
  );
});

test('extracts processed-video notifications in DOM order and deduplicates them', () => {
  const { context, document } = setup(`
    <a href="/reel/222/?notif_t=fb_shorts_video_processed&notif_id=new">new</a>
    <a href="/reel/222/?notif_t=fb_shorts_video_processed&notif_id=new&ref=duplicate">duplicate</a>
    <a href="/reel/111/?notif_t=fb_shorts_video_processed&notif_id=old">old</a>
    <a href="/reel/999/">ordinary reel</a>
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getProcessedProfileVideoNotifications(document))),
    [
      {
        key: 'notification:new',
        notificationId: 'new',
        postUrl: 'https://www.facebook.com/reel/222/',
      },
      {
        key: 'notification:old',
        notificationId: 'old',
        postUrl: 'https://www.facebook.com/reel/111/',
      },
    ],
  );
});

test('falls back to the reel identity when notif_id is absent', () => {
  const { context } = setup();
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.parseProcessedProfileVideoNotificationUrl(
      '/reel/123/?notif_t=fb_shorts_video_processed',
    ))),
    {
      key: 'reel:123',
      postUrl: 'https://www.facebook.com/reel/123/',
    },
  );
});

test('finds only a processed notification absent from the pre-publish snapshot', () => {
  const { context, document } = setup(`
    <div role="dialog" aria-label="Notifications">
      <a href="/reel/1490054189671164/?notif_t=fb_shorts_video_processed&notif_id=1790881842144242">new</a>
      <a href="/reel/1849961952839675/?notif_t=fb_shorts_video_processed&notif_id=1790872570507296">old</a>
    </div>
  `);
  const baseline = new Set([
    'notification:1790872570507296',
    'post:https://www.facebook.com/reel/1849961952839675/',
  ]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.findNewProcessedProfileVideoNotification(document, baseline))),
    {
      key: 'notification:1790881842144242',
      notificationId: '1790881842144242',
      postUrl: 'https://www.facebook.com/reel/1490054189671164/',
    },
  );
});

test('does not treat a query-parameter change on an old reel as a new notification', () => {
  const { context, document } = setup(`
    <a href="/reel/1849961952839675/?notif_t=fb_shorts_video_processed&notif_id=changed-id">old</a>
  `);
  const baseline = new Set([
    'notification:original-id',
    'post:https://www.facebook.com/reel/1849961952839675/',
  ]);

  assert.equal(context.findNewProcessedProfileVideoNotification(document, baseline), null);
});

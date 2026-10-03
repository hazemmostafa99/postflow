# Arabic and English Facebook Publishing - Progress

## Goal

Support publishing when Facebook is displayed in English while preserving the
existing Arabic flow and using one shared publishing engine.

Status: `In Progress`

Current step: English Group text, image, video, and published-video canonical
URL capture are manually confirmed. English pending-video status is confirmed;
an early pending-page GraphQL capture is ready for manual verification of its
canonical `/pending_posts/{id}/` URL.

## Source Documents

- `features/english-facebook-publishing/feature.md`
- `features/profile-feed-publishing/feature.md`
- `features/post-tracking/feature.md`
- `features/pending-facebook-post-sync/feature.md`
- `features/post-engagement-analytics/feature.md`

---

# Phase 0 - Existing Implementation Review

## Checklist

- [x] Inspect Group composer discovery and submit-button selection.
- [x] Inspect Profile Feed composer discovery.
- [x] Inspect success, failure, and pending-approval detection.
- [x] Inspect publishing interruption detection.
- [x] Inspect engagement label and counter extraction.
- [x] Confirm that partial Arabic and English phrase support already exists.
- [x] Confirm that the preferred design is one shared locale-aware flow.

## Review Notes

```text
Status: COMPLETE

Files reviewed:
- apps/extension/src/content.ts
- apps/extension/src/profile-composer.ts
- apps/extension/src/post-tracking/detect-pending-approval.ts
- apps/extension/src/post-tracking/facebook-interruption-detector.ts
- apps/extension/src/post-tracking/extract-engagement.ts
- apps/extension/src/post-tracking/parse-facebook-count.ts

Findings:
- The content script already contains some Arabic and English composer phrases.
- Profile composer discovery already recognizes both languages.
- Publish success, pending approval, interruption, and engagement detectors
  contain partial bilingual coverage.
- Localized phrases are scattered across workflow files and use different
  matching or normalization approaches.
- Some generic button fallbacks are broad and can become unsafe when Facebook
  changes layout between locales.
- Arabic and English Facebook surfaces may use different DOM structures and
  behavior, so selectors cannot be inferred safely across locales.

Decision:
- Preserve the existing publishing state machine and queue.
- Add a centralized Arabic/English locale catalog and shared normalization.
- Prefer structural and network evidence over localized text.
- Treat document locale as a preference only; keep both catalogs available.
- Ask the user for the relevant DOM and behavior input before each dependent
  change, then record the user's manual verification status.
```

---

# Phase 1 - Collect DOM Evidence and Record the Arabic Baseline

## Checklist

- [x] Ask the user which publishing surface should be handled first.
- [x] Select text-only Facebook Group publishing as the first surface.
- [x] Ask the user for the English DOM and observed behavior.
- [ ] Ask for working Arabic DOM only if a required change would touch the
      working Arabic-specific path or an Arabic regression appears.
- [x] Record the English trigger, composer, submit control, and failure stage.
- [x] Ask the user to confirm the current Arabic text-only Group flow manually.
- [x] Ask the user to recheck Arabic text-only Group publishing after the
      English changes.
- [ ] Ask the user to confirm the current Arabic Profile Feed flow manually.
- [x] Record the user-reported Arabic Group baseline status.
- [x] Keep existing repository tests unchanged.

## Review Gate

Do not change a locale-sensitive resolver until the user supplies the relevant
DOM/behavior input. Do not continue past the phase until the user reports the
manual Arabic baseline status.

## Review Notes

```text
Status: IN PROGRESS

User-provided DOM/behavior input:
- English Group composer trigger is a visible `role="button"` with nested
  `Write something...` text and no composer-specific aria label, placeholder,
  or `GroupInlineComposer` data-pagelet in the supplied snippet.
- The opened English composer is a `role="dialog"` containing a Lexical
  `contenteditable` textbox with `aria-placeholder="Write something..."`.
- The English submit control is a visible, enabled `role="button"` with
  `aria-label="Post"`.
- The job failed before opening the composer with `The Facebook group composer
  was not ready`.

Manual status reported by user:
- Arabic text-only Group publishing: PASS before this change.
- English Group readiness and trigger discovery: PASS.
- English composer opened and Lexical editor discovered: PASS.
- English text insertion reported four inserted characters, but Facebook's
  exact Post control was still disabled at the first lookup. The screenshot
  confirmed that the composer remained visibly empty.
- The supplied English editor starts as `<p><br
  data-lexical-managed-linebreak="true"></p>`. The old caret position was at
  the end of the editor root, outside this Lexical paragraph, so the observed
  text length was transient DOM rather than accepted composer state.
- A second supplied DOM capture confirmed that the inner element labelled
  `Create post` is a header sibling, not an editor ancestor. The editor belongs
  to the outer `[role="dialog"][aria-modal="true"]` surface. The first scoped
  implementation therefore did not activate and logged
  `englishGroupComposerDialog: false`.
- A following manual run still logged `englishGroupComposerDialog: false`,
  showing that `aria-placeholder` was not available at the instant the editor
  was discovered even though it appeared in the later DOM capture. English
  activation now accepts the document locale, the hydrated editor placeholder,
  the supplied `aria-label="Create post"` surface, or the already-confirmed
  English composer-trigger text and records each signal.
- The next manual run activated the English flow but showed that the broad
  hydration fallback's first editor was not attached to the active modal at
  that instant. It failed safely before insertion. Resolution now falls back to
  the visible outer modal containing both the supplied Lexical editor and exact
  `aria-label="Post"` control, then uses that modal's editor.
- The following run showed `editor_surface_found` and the safe failure in the
  same millisecond. Facebook had exposed the loose editor before hydrating the
  modal and Post control. The English resolver now waits up to the existing
  create-post timeout for the complete supplied modal/editor/Post combination.
- The old generic fallback incorrectly selected `Edit group cover photo` and
  clicked it, so no post was submitted and the final status was `UNKNOWN`.
- English text-only Group publishing after the hydrated modal wait,
  paragraph-aware insertion, and scoped submit changes: PASS, confirmed by the
  user.
- Arabic text-only Group publishing after the English changes: PASS, confirmed
  by the user.
- English image Group publishing: FAILED. The text post appeared, but the image
  was routed to the Group cover-photo input and Facebook displayed `Try a
  Different Image` instead of attaching the image to the post.
- English composer media-input DOM: CONFIRMED from the previously supplied DOM.
  The resolved English modal contains an `input[type="file"]` accepting images
  and videos next to the `aria-label="Photo/video"` control.
- English media fix: media attachment now receives the resolved English
  composer modal instead of the broader page surface. The first manual retry
  still selected the Group cover uploader because the helper fell back to the
  first page-wide input while the composer input hydrated.
- English media safety update: the file input must now be structurally paired
  with the supplied `aria-label="Photo/video"` control, page-wide fallback is
  disabled, and static toolbar text no longer counts as preview evidence. An
  actual new image/video preview is required before submission.
- English image Group publishing after the scoped-input and preview-safety
  changes: PASS, confirmed by the user.
- Arabic image Group publishing: PASS, confirmed by the user after the English
  media changes.
- English video Group attachment: PASS. The video appeared in the composer and
  `media_attach_finished` was recorded with `englishComposerScoped: true`.
- English video Group submission: PASS. Facebook created the post and PostFlow
  returned `PUBLISHED` with one `videoId` and one `uploadSessionId`.
- English video processing: IN PROGRESS. Facebook displays `Processing video`
  and states that it will send a notification when the post is ready to view.
- English video permalink enrichment: the immediate automatic link check
  returned `CHECK_FAILED` with `Pending post link was not found` while the video
  was still processing. This did not change the successful publishing status.
- A shared scheduled permalink retry was implemented, then REVERTED at the
  user's request after an Arabic Group video regression was reported. The API,
  background scheduler, and pending-post type are restored to their previous
  behavior.
- The two processing-notice strings supplied from the English Facebook DOM are
  now enabled only when the English Group composer was resolved. They no longer
  participate in Arabic Group video result detection.
- Arabic video regression investigation found two English-path leaks. English
  mode could be activated by document locale, editor placeholder, or English
  accessibility metadata even when the visible composer trigger was Arabic;
  and the exact English `aria-label="Post"` selector ran without an English
  guard. English-specific editor, caret, media, submit, and video-result logic
  is now activated only by the confirmed visible English composer-trigger
  phrases. The other signals remain diagnostics only.
- The first guard still combined the trigger's `aria-label` and
  `aria-placeholder` with its text, so English accessibility metadata could
  continue to classify an Arabic trigger as English. After the user reported
  the same regression, activation was tightened again to the trigger's rendered
  `innerText` only. Accessibility metadata is logged but cannot select the
  English behavior path.
- Arabic video permalink evidence supplied by the user: the initial 60-second
  result was `PUBLISHED` without `postUrl`, with zero network candidates, one
  video ID, and one upload-session ID. Its existing immediate fallback then
  reopened the Group and successfully found
  `https://www.facebook.com/groups/556776281869416/posts/2150297949183900/`.
  This proves Arabic and English use the same link matcher; the observed
  difference is that the English post was not present in the reopened feed yet.
- English-only delayed permalink retry: IMPLEMENTED, MANUAL CHECK PENDING. The
  content script sends the confirmed visible-English-flow flag with the result.
  If and only if an English Group video is published without a URL and its
  immediate fallback does not save one, the background worker stores a durable
  retry in extension storage. A one-minute alarm reuses the existing Group feed
  matcher with controlled backoff for up to 24 hours. When the permalink
  appears, the existing pending-sync endpoint enriches the already-published
  job and removes the retry. Arabic jobs are never added to this queue.
- The first delayed retry still returned `CHECK_FAILED` even though the English
  video post visibly existed. The user then supplied the complete published
  English post-card DOM. Unlike the Arabic-successful shape accepted by the
  existing matcher, the English card has neither `role="article"` nor a
  `FeedUnit` data-pagelet. It is a virtualized `[aria-posinset]` item containing
  `data-ad-rendering-role="story_message"`, `data-video-id`, an English video
  player, and the canonical same-Group `/posts/{id}/` permalink.
- English Group-video checks now additionally consider that supplied
  virtualized-card shape. A candidate must contain the exact normalized
  submitted text inside `story_message`, video evidence, and a valid permalink
  for the expected Group. This fallback is enabled by an English-video marker
  carried only on the immediate/delayed English URL check; Arabic matching is
  unchanged.
- A subsequent live retry still returned `CHECK_FAILED`. Inspection showed that
  `CHECK_PENDING_POST` previously accepted the first loaded Group shell and ran
  the matcher only once; English Facebook can hydrate its virtualized cards
  after that point. English-video checks now poll the same safe matcher for up
  to the existing 25-second Facebook-tab readiness window. If hydration still
  produces no match, sanitized diagnostics record counts for virtualized items,
  story messages, video cards, and Group-post links. Arabic checks remain
  single-pass and unchanged.
- A second complete English video-card capture contained the expected new text,
  `aria-posinset="1"`, `data-video-id="1080597911247136"`, and canonical URL
  `https://www.facebook.com/groups/556776281869416/posts/2150313199182375/`,
  while the inactive recheck tab still failed. This confirms a tab/feed-state
  difference rather than another card-selector gap: the original publishing
  tab has the hydrated post, while a new inactive Group tab can receive a
  different or unhydrated feed.
- An already-open-tab-first check was tried, but the user confirmed that the
  newly published post is not displayed in the existing tab. That branch and
  its `Checking already-open English Group tab` log were removed. Both the
  immediate English video permalink check and every delayed retry now open a
  fresh Group tab directly. Arabic behavior is unchanged.
- The user clarified that the fresh English Group tab does display the new post
  but the matcher still does not select it. At the user's request, English-video
  checks now return and log a structured array for up to 25 `[aria-posinset]`
  items. Each entry contains its position, a 160-character `story_message`
  preview, normalized same-Group permalink, video IDs, video-player presence,
  and `data-virtualized` state. Fresh-tab arrays are logged by the background
  worker before temporary tabs close. Full post HTML and unrelated page text
  are not logged.
- The first fresh-tab candidate array showed exactly one mounted virtualized
  item with submitted text `test`, video ID `1081586077849590`, and a video
  player, but no hydrated permalink. This confirms the correct post card was
  present and rejected only because its URL anchor was absent. A count of one
  describes Facebook's currently mounted virtualized window, not the number of
  posts in the Group.
- The temporary English retry tab now performs a bounded virtualized-feed scan:
  it first brings the matching submitted-text card into view three times to
  encourage permalink hydration, then scrolls by viewport-sized steps through
  up to 16 positions, re-running the safe matcher after each step. It accumulates
  every distinct card seen across the scan and returns the complete structured
  array to the background log. Scrolling is enabled only by the fresh English
  Group-video retry request; existing user tabs and Arabic checks never scroll.
- The next manual diagnostic accumulated 26 virtualized entries. It found the
  current submitted video as position 1 (`gghhbjhjghjv`, video ID
  `1138628968826418`) plus multiple older real video posts and virtualized
  placeholders. None of the entries exposed a permalink. This confirms that
  scrolling and post identification work, but Facebook does not hydrate post
  anchors in that inactive temporary tab.
- A foreground hydration retry was tried for that condition, but the user asked
  to keep only one render evaluation. The foreground activation/reload and
  second render attempt have been removed.
- The user identified that the unhydrated card still exposes a stable numeric
  `data-video-id`. English Group video jobs now carry the video IDs observed in
  the publish response into permalink reconciliation and use them, together
  with exact submitted text, to identify the correct virtualized card. A video
  ID is not treated as a Group post ID.
- The user confirmed that `watch/?v={videoId}` does not redirect to the Group
  permalink. They then supplied the English post Actions button and opened-menu
  DOM. The matching card exposes an `aria-haspopup="menu"` Actions button, and
  the opened menu exposes an exact `Copy link` `[role="menuitem"]`. Facebook
  copies `/share/v/{token}/`, which redirects to
  `/groups/{groupId}/permalink/{postId}/`.
- Current requested behavior: open one fresh active Group tab and evaluate the
  rendered virtualized cards once, with no reload, second render attempt, or
  scrolling loop. Match the English video card using exact normalized submitted
  content plus video ID when available. A match logs
  `English Group video content match succeeded`.
- After that same single-render content match, PostFlow opens the matched card's
  supplied `Actions for this post` menu and selects the exact `Copy link`
  menuitem. Facebook reported `Copy failed` because its clipboard call rejected
  the synthetic click as an untrusted gesture. The fresh tab now installs a
  temporary main-world capture for Facebook's copy operation. The first live
  attempt reached the correct menuitem but emitted
  `english_video_share_link_not_captured`, proving Facebook was not using the
  intercepted `clipboard.writeText` path. Capture now covers
  `clipboard.writeText`, `clipboard.write(ClipboardItem[])`, and the legacy
  bubbling `copy` event, and reports which method produced the URL. It captures
  and validates `/share/v/{token}/` while returning success to
  Facebook, without reading or changing the user's real clipboard and without
  clipboard permissions. PostFlow follows the share redirect in the same
  temporary tab, validates the expected Group, normalizes
  `/permalink/{postId}/` to `/posts/{postId}/`, and persists the canonical URL.
  The previous user tab is restored when the temporary tab closes. If any link
  step fails, `CONTENT_MATCHED` remains the terminal result and no later
  permalink retry is queued. Arabic remains unchanged.
- Step-by-step posting logs now cover the entire English video link path:
  fresh-tab start/create/readiness, main-world capture installation, content
  check delivery/result, content-match start/result, Actions button
  found/clicked, Copy link menuitem found/clicked, capture waiting/result and
  method, share redirect start/location changes/result, temporary-tab cleanup,
  previous-tab restoration, and final API persistence outcome. Diagnostics log
  counts, statuses, and validated Facebook URLs only; they do not log full post
  content or unrelated clipboard data.
- The complete manual trace confirmed that the correct English video card,
  Actions button, and exact Copy link menuitem were found and clicked. The
  capture reported `installed: true` but received no clipboard call because it
  had been installed only after Facebook finished loading; Facebook can cache
  its original copy implementation before that point.
- The English-only capture is now registered temporarily in the main world at
  `document_start` before the single fresh Group tab is created, then
  unregistered when that one check finishes. It covers `clipboard.writeText`,
  `clipboard.write`, the bubbling `copy` event, and legacy
  `document.execCommand('copy')`. Only validated Facebook `/share/v/{token}/`
  values are intercepted; unrelated clipboard writes call the original browser
  methods. This registration is entered only for `englishGroupVideo`; the
  Arabic matcher and publishing path are unchanged. The following manual run
  confirmed the captured URL, redirect, and persistence behavior.
- English Group-video canonical URL capture: PASS, confirmed by the user's
  manual run for job `6ac11cba7d9ec29f45bd354f`. The early hook was present in
  the fresh document, matched the intended video card, captured
  `https://www.facebook.com/share/v/1Ftpsfe3KS/` through
  `document.execCommand`, followed Facebook's redirect, normalized it to
  `https://www.facebook.com/groups/556776281869416/posts/2150892225791139/`,
  and persisted it successfully (`status: PUBLISHED`, `updated: true`,
  `persisted: true`). The temporary capture was then unregistered.
- Arabic Group-video pending approval: PASS, confirmed by the user's manual
  run for job `6ac126d259845d98725a5151`. The Arabic flow attached one video,
  clicked the Arabic `نشر` control once, and correctly returned
  `PENDING_APPROVAL` with
  `https://www.facebook.com/groups/2935434123486623/pending_posts/2955973741432661/`.
  Facebook reported one `videoId` and one `uploadSessionId`; no English-only
  capture or matcher path was involved.
- English pending-approval parity: IMPLEMENTED, manual verification pending.
  The shared approval detector now recognizes the supplied English phrases
  `Your post is pending`, `Your post is awaiting admin approval`, and
  `Learn more about pending admin approval` inside the supplied virtualized
  `[aria-posinset]` card. URL semantics remain authoritative, so
  `/pending_posts/{id}/` stays `PENDING_APPROVAL` and later `/posts/{id}/`
  becomes `PUBLISHED`. No English Copy-link flow is used for pending posts.
- Pending URL timing parity: the successful Arabic run obtained its
  `/pending_posts/{id}/` URL from Facebook navigation even though it had zero
  network candidates. English can render the pending message before finishing
  that navigation, so the shared result waiter now allows a five-second grace
  period for the pending page URL or network URL after detecting approval.
  It still returns `PENDING_APPROVAL` without a URL if Facebook exposes none.
- The user then supplied the complete English pending-post card. It contains a
  direct canonical `/groups/{groupId}/pending_posts/{postId}/` anchor inside
  the surrounding virtualized `[aria-posinset]` card. Pending-result URL
  extraction now climbs from the matched pending message to that card and
  extracts the existing link. This is structural, language-independent, and
  runs only after positive pending-approval evidence; it does not alter the
  Arabic composer or submission path. Manual verification is pending.
- Focused pending-URL diagnostics were added after the first manual retry only
  showed the `PENDING_APPROVAL` state transition. Each probe now records whether
  the pending message, virtualized parent card, and direct pending anchor were
  found, plus each candidate URL source and the final resolved/missing result.
  These logs are observational and do not change either locale's behavior.
- The diagnostic run for job `6ac132dc59845d98725a5159` proved the detected
  surface was Facebook's temporary confirmation item (`aria-posinset="NaN"`).
  Across 11 probes it had no pending anchor, network candidate, or navigation
  URL. For an English pending result without a URL, the extension now performs
  one fresh-tab lookup directly on the Group's `/pending_posts/` page, matches
  the submitted content against the user-supplied virtualized card structure,
  extracts its canonical pending anchor, persists the result, and closes the
  tab. The Arabic submission path is unchanged.
- The next supplied Pending Posts DOM showed only loading/skeleton virtualized
  items (`data-virtualized="true"`, hidden placeholders, and `Loading...`
  articles) with zero pending anchors. The English pending-page readiness wait
  now uses the full Facebook tab timeout so the single DOM evaluation waits for
  the real card/link to hydrate; the normal Arabic Group readiness timeout is
  unchanged.
- The following manual run confirmed the new pending video was not present when
  the fresh Pending Posts page first opened. The supplied later DOM contained
  four fully rendered virtualized video cards with story text and video IDs,
  but no `/pending_posts/` anchors or other stable post ID. The English pending
  lookup keeps one fresh background tab open for up to three minutes, refreshes
  it while Facebook finishes the upload, and never opens the Actions menu.
- Because Facebook may not stream a newly uploaded pending post into an already
  loaded `/pending_posts/` document, that English lookup now refreshes the same
  tab every 15 seconds while waiting. The timer is cleared immediately when the
  lookup completes or the tab is closed; no refresh timer is installed for
  Arabic checks.
- A later run closed the tab without any Copy-link events. This means the
  matcher never reached the Actions button, rather than Copy link failing. The
  English pending lookup now prefers a submitted video-ID match but falls back
  to the exact submitted story text when Facebook renders a different video ID;
  the published-video matcher keeps its stricter behavior. Pending English
  posts never open the Actions menu. Missing-card logs include story-message
  and Actions-button counts.
- The supplied complete rendered cards proved that the English Pending Posts
  DOM can expose the submitted content and video while exposing no permalink or
  stable post ID. The fresh pending tab now installs the GraphQL spy in the
  page's main world at `document_start`, before Facebook loads the pending feed.
  It buffers pending-feed candidates until the isolated content script is
  ready, matches the exact normalized submitted text (preferring a matching
  video ID), then uses a same-group pending URL or a GraphQL post ID to produce
  `/groups/{groupId}/pending_posts/{postId}/`. It retains no response body and
  logs no submitted content.
- The temporary network hook is removed after the one lookup. This experiment
  is guarded by the English pending-approval flag; the Arabic path and the
  published-English-video Copy-link path are unchanged. Focused manual logs now
  cover hook installation, document readiness, candidate counts, refreshes,
  the captured URL source, and final persistence.
- The first network-capture run observed 30 candidates, including 30 with a
  direct URL and nine with a post ID, but did not capture the submitted post
  before the overall three-minute lookup deadline. The final refresh occurred
  near that existing deadline; cleanup, not the refresh itself, closed the tab.
  Candidate diagnostics now report exact/containing text-match counts, expected
  video-ID overlap counts, direct pending-URL counts, and normalized text
  lengths without logging any post text. Unicode direction and zero-width
  formatting marks are ignored during the exact match. A deadline log now makes
  this termination reason explicit. Manual verification is pending.
- English pending-page GraphQL capture: FAIL, confirmed by the user's manual
  run for job `6ac156c76b8bfd4a70337a41`. The lookup exhausted its 180-second
  deadline after 50 message-delivery attempts. The final refreshed document
  exposed zero pending-feed network candidates, zero text matches, and zero
  video-ID overlaps before cleanup closed the fresh tab. Earlier feed responses
  can expose unrelated existing-post candidates, but did not expose evidence
  that could safely identify this submitted post. Do not extend this polling
  loop without new Facebook behavior evidence; the next investigation should
  inspect the original story-create response at submission time for a pending
  post/story identifier.
- `english_video_post_url_persist_result.details` now includes the canonical
  `postUrl` directly. Its top-level `url` remains the background log's browser
  context URL and is not treated as the persisted post URL.
- Post-validation cleanup removed the experimental delayed English permalink
  alarm, retry queue, and stored retry entries. It also removed temporary
  virtualized-post arrays and restored the shared pending-post matcher to its
  pre-experiment behavior. The finalized English video path performs one fresh
  active-tab evaluation and immediately captures, resolves, and persists the
  canonical URL; Arabic continues through the existing shared path.
- Supplied processing-notice DOM includes `Processing video`, `The video in your
  post is being processed`, and `Dismiss inline feed notice about video
  processing`.
- The exact supplied English processing sentence and notice aria-label were
  added as success evidence. Existing Arabic cues and the permalink-waiting
  timeout behavior remain unchanged.

Build:
- Extension development build: PASS.

Known gaps:
- English Profile Feed publishing job `6ac167a7c9f4dd013fab65c4` was accepted as
  `PUBLISHED` but returned no post URL. Diagnostics found three article-like
  surfaces and three anchors, but the only relevant shapes were a
  comment-oriented `/profile.php?...comment_id...` URL and an older Reel URL;
  the submission response supplied zero network candidates. The tracker must
  not treat `comment_id` as the parent post identity. The rendered new-post
  card DOM (including header/timestamp and Actions control) is required before
  adding another Profile permalink strategy.
- Profile Reel engagement sync failed for job `6ac162f0c9f4dd013fab65ba`
  with `targetFound=true`, zero article/dialog wrappers, four visible Like/React
  controls, and two Comment controls. The supplied DOM shows the exact target
  `data-video-id` in one viewer pane and its engagement row in a sibling pane,
  without an article or dialog ancestor. Engagement extractor v11 now climbs
  from the exact video identity to the smallest common ancestor containing one
  Comment control and at most the expected Like plus React controls. It refuses
  broader multi-reel ancestors. Manual counter verification is pending.
- The following v11 manual check matched the intended Reel and returned
  `reactionCount: 0` with only the comment count unresolved. The user's
  screenshot confirms that this exact English direct-Reel viewer displays
  icon-only Like and Comment controls with no adjacent number when both counts
  are zero. Extractor v12 now maps the missing comment number to zero only when
  the browser URL identifies the same Reel/video, the exact `data-video-id` is
  inside the resolved scope, both engagement actions are loaded, the English
  aria-label is exactly `Comment`, and no numeric comment value was extracted.
  Manual SUCCESS verification is pending.
- English Profile Feed text publishing exposed an unsafe shared fallback in job
  `6ac16149c9f4dd013fab65b8`: the extension selected a visible `Write a
  comment...` Lexical editor and then selected `Add cover photo` as the submit
  control. The user supplied the complete English Profile Create post modal.
  Profile lookup is now restricted to the visible `aria-modal="true"` composer
  containing the semantic profile editor (`What's on your mind?`) and its own
  exact Post control. Editor insertion, media attachment, and submit lookup are
  scoped to that modal. Arabic profile editor phrases and the Arabic exact
  submit label remain eligible; Group behavior is unchanged. Manual English
  Profile text verification is pending.
- Reload the unpacked extension and manually publish one English Group video to
  a group requiring approval. Confirm whether `english_pending_post_url_captured`
  reports `source: network` and the expected `/pending_posts/{id}/` URL.
- Re-run the Arabic Group-video manual check at the final regression gate; the
  successful English URL path is guarded by `englishGroupVideo`.
```

---

# Phase 2 - Shared Locale Contract and Normalization

## Checklist

- [ ] Define the supported Facebook UI locales: Arabic and English.
- [ ] Create semantic locale keys for composer, submit, media, status,
      interruption, and engagement evidence.
- [ ] Move or reference existing Arabic phrases without changing their meaning.
- [ ] Consolidate existing English phrases into the same contract.
- [ ] Add shared Unicode and whitespace normalization.
- [ ] Preserve Arabic diacritic, tatweel, and safe letter normalization.
- [ ] Document any temporary legacy mojibake compatibility entries.
- [ ] Use `document.documentElement.lang` only as a preference and diagnostic.
- [ ] Verify that both locale catalogs remain active during matching.

## Review Gate

Review the catalog and normalization API before converting workflow selectors.

## Review Notes

```text
Status: NOT STARTED

Files changed:
-

Locale contract:
-

Manual verification requested/result:
-

Compatibility notes:
-
```

---

# Phase 3 - Locale-Aware Composer Discovery

## Checklist

- [ ] Extract or consolidate the Group composer resolver.
- [ ] Preserve `GroupInlineComposer` and structural discovery as first choice.
- [ ] Add Arabic and English fallback phrases through the locale catalog.
- [ ] Exclude controls inside existing post articles.
- [ ] Extract or consolidate the Profile Feed composer resolver.
- [ ] Preserve canonical profile URL and identity validation.
- [ ] Reject Story, Reel, audience, privacy, and navigation controls in both
      locales.
- [ ] Make the intermediate Post/Text option locale-aware and dialog-scoped.
- [ ] Add deterministic candidate scoring and ambiguity rejection.
- [ ] Ask for separate Arabic and English DOM input before changing each
      composer surface.
- [ ] Ask the user to check each changed composer surface manually.
- [ ] Record English and Arabic results separately.

## Review Gate

Ask the user to verify that the selected trigger belongs to the expected Group
or Profile Feed surface. Do not continue to editor or submit-button work until
the user reports the result.

## Review Notes

```text
Status: NOT STARTED

Files changed:
-

Resolver behavior:
-

User-provided DOM/behavior input:
-

Manual status reported by user:
-

Known gaps:
-
```

---

# Phase 4 - Editor, Media, and Submit Controls

## Checklist

- [ ] Keep editor discovery based primarily on Lexical, textbox, and
      contenteditable attributes.
- [ ] Verify Arabic, English, mixed-direction, emoji, and multiline insertion.
- [ ] Verify inserted content before enabling final submission.
- [ ] Prefer compatible file inputs over localized media buttons.
- [ ] Add locale-aware Arabic and English media-button fallback labels.
- [ ] Confirm image and video attachment using structural evidence first.
- [ ] Replace unconstrained generic submit-button selection.
- [ ] Require the submit control to be inside the active composer.
- [ ] Require exact or high-confidence Arabic/English semantic evidence.
- [ ] Reject hidden, disabled, audience, privacy, media, cancel, and navigation
      controls.
- [ ] Fail before clicking when submit candidates are ambiguous.
- [ ] Preserve destination and Facebook identity verification before submit.
- [ ] Preserve single-submit and cancellation protections.
- [ ] Ask for the English editor, media, preview, and submit-control DOM before
      changing their resolvers.
- [ ] Ask the user to verify each changed text, image, and video path manually.
- [ ] Ask the user to recheck the corresponding Arabic path after each change.

## Review Gate

Ask the user to verify the selected final Post control and confirm that no
unrelated button is clicked. Record both English and Arabic results before
continuing.

## Review Notes

```text
Status: NOT STARTED

Files changed:
-

Safety behavior:
-

User-provided DOM/behavior input:
-

Manual status reported by user:
-

Known gaps:
-
```

---

# Phase 5 - Submission Results and Interruptions

## Checklist

- [ ] Route Arabic and English success phrases through the shared catalog.
- [ ] Route Arabic and English publish-failure phrases through the catalog.
- [ ] Route video-processing phrases through the catalog.
- [ ] Preserve network response and permalink evidence as higher-confidence
      signals.
- [x] Prevent a `/pending_posts/{id}/` URL from proving publication.
- [ ] Consolidate pending-approval phrases under the locale contract.
- [ ] Consolidate temporary block, challenge, checkpoint, and identity phrases.
- [ ] Keep interruption statuses and queue-pausing behavior locale-independent.
- [ ] Ask the user for DOM and observed behavior for each result or interruption
      surface before changing its detector.
- [ ] Ask the user to reproduce and verify each available English result state.
- [ ] Ask the user to verify the corresponding Arabic result state when it is
      safely reproducible.

## Review Gate

Ask the user to verify that equivalent Arabic and English Facebook messages
produce the expected submission status and queue behavior. Record states that
cannot be safely reproduced as unverified rather than assuming parity.

## Review Notes

```text
Status: IN PROGRESS

Files changed:
- `apps/extension/src/content.ts`
- `apps/extension/src/post-tracking/wait-for-post-submission-result.ts`
- `apps/api/src/posts/jobs.controller.ts`

Result mappings:
- Any validated Group `/pending_posts/{id}/` URL maps to `PENDING_APPROVAL`,
  whether observed from Facebook's response, matched DOM, or navigation.
- The API independently enforces the same mapping if an older extension sends
  `PUBLISHED` with a pending-post URL.

User-provided DOM/behavior input:
- English pending card shows `Your post is pending`, `Your post is awaiting
  admin approval`, and `Learn more about pending admin approval`.
- The complete English virtualized pending card contains a direct anchor for
  `/groups/2935434123486623/pending_posts/2956007034762665/`, along with the
  submitted text `test 120` and video ID `1106715118836546`.
- The observed Facebook response supplied
  `/groups/2935434123486623/pending_posts/2955960178100684/` while the extension
  incorrectly reported `PUBLISHED`.

Manual status reported by user:
- Before fix: FAIL; pending post was classified as `PUBLISHED`.
- Arabic Group video after fix: PASS; `submission_result_detected` reported
  `PENDING_APPROVAL` with the pending-post URL, one video ID, and one upload
  session ID.
- English pending-card case after fix: manual confirmation pending.

Known gaps:
- Re-run this pending-approval case and confirm `submission_result_detected`
  reports `PENDING_APPROVAL` with the same pending-post URL.
- The supplied pending-card DOM showed a virtualized `[aria-posinset]` Group
  surface without the older main/feed/article markers. The pending-check
  readiness gate now accepts that supplied virtualized surface, so it can
  proceed to the existing pending URL classification instead of returning
  `Facebook group feed did not load`.
```

---

# Phase 6 - Tracking and Engagement Locale Parity

## Checklist

- [ ] Confirm post discovery remains based on URL identity, timestamps,
      snapshots, and network evidence.
- [ ] Preserve Arabic-Indic and Western digit parsing.
- [ ] Verify Arabic and English reaction labels.
- [ ] Verify Arabic and English comment labels.
- [ ] Verify Arabic and English explicit zero-comment states.
- [ ] Confirm no post age or unrelated number is treated as engagement.
- [ ] Verify Group and Profile Feed post URLs in both locales.
- [ ] Ask the user for the rendered engagement DOM for each available locale and
      post type before changing extraction behavior.
- [ ] Ask the user to run the engagement check manually and report the values
      shown by Facebook and returned by PostFlow.

## Review Gate

Do not infer English engagement DOM from Arabic markup. Continue only after the
user provides the relevant input and reports the manual result.

## Review Notes

```text
Status: NOT STARTED

Files changed:
-

User-provided DOM/behavior input:
-

Manual status reported by user:
-

Known gaps:
-
```

---

# Phase 7 - Diagnostics, Manual QA, and Rollout

## Checklist

- [ ] Log detected document locale and matched semantic locale safely.
- [ ] Log candidate counts and ambiguity reasons without full post content.
- [ ] Confirm diagnostics contain no cookies, tokens, or full page HTML.
- [ ] Run the extension production build.
- [ ] Ask the user to check Arabic UI with Arabic, English, and mixed content.
- [ ] Ask the user to check English UI with Arabic, English, and mixed content.
- [ ] Ask the user to check Group text, image, and video publishing in both
      locales.
- [ ] Ask the user to check Profile Feed text, image, and video publishing in
      both locales.
- [ ] Ask the user to check immediate and scheduled jobs.
- [ ] Ask the user to check a Group requiring admin approval.
- [ ] Ask the user to check safe behavior for any available temporary block or
      manual-verification surface.
- [ ] Confirm each job submits no more than once.
- [ ] Ask the user to re-run the Arabic manual checks after completing English
      QA.
- [ ] Record rollout decision and any temporary feature flag.

## Manual QA Matrix

| Facebook UI | Target       | Content              | Media | Status |
| ----------- | ------------ | -------------------- | ----- | ------ |
| Arabic      | Group        | Arabic               | None  | Not run |
| Arabic      | Group        | English              | Image | Not run |
| Arabic      | Profile Feed | Mixed Arabic/English | Video | Not run |
| English     | Group        | English              | None  | Not run |
| English     | Group        | Arabic               | Image | Not run |
| English     | Profile Feed | Mixed Arabic/English | Video | Not run |

## Review Notes

```text
Status: NOT STARTED

Build:
-

Manual status reported by user:
-

Rollout decision:
-

Known limitations:
-
```

---

# Completion Checklist

- [ ] The user confirms the Arabic manual baseline still works.
- [ ] The user confirms English Group publishing for text, image, and video.
- [ ] The user confirms English Profile Feed publishing for text, image, and
      video.
- [ ] The user confirms available mixed UI/message language behavior.
- [ ] Post content language does not affect UI locale resolution.
- [ ] Pending approval and interruption behavior has locale parity.
- [ ] Tracking and engagement extraction has locale parity.
- [ ] Ambiguous submit controls fail safely before the final click.
- [ ] The production extension build passes.
- [ ] DOM- or behavior-dependent work used user-provided input rather than
      assumed parity between Arabic and English.
- [ ] The user-reported status is recorded after every manual check.
- [ ] No API or database locale field was introduced unnecessarily.
- [ ] Documentation reflects the final implementation and known limitations.

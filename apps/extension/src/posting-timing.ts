/**
 * Plain content-script configuration.
 *
 * Content scripts declared in the manifest are classic scripts, not ES
 * modules. Keep this file import-free so Chrome can execute it before the
 * Facebook composer scripts. The background service worker imports it for the
 * same global configuration through posting-config.ts.
 */
const postingTiming: PostFlowPostingTimingConfig = {
  // Max time to wait for the Facebook tab to finish loading and for content.ts to report ready.
  facebookTabReadyTimeoutMs: 25000,

  // How often the background retries sending EXECUTE_JOB while the Facebook content script is loading.
  facebookMessageRetryIntervalMs: 250,

  // Max time to wait for the group page's main content or composer area to appear.
  // Group pages stream the composer after the main feed shell.
  groupPageReadyTimeoutMs: 7000,

  // Short pause after clicking the group composer trigger before checking for the next UI state.
  composerOpenDelayMs: 400,

  // Pause after selecting the "Post/Text" option if Facebook shows an intermediate creation modal.
  intermediateComposerOptionDelayMs: 400,

  // Max time to wait for the real create-post surface that contains the editable text box.
  createPostDialogTimeoutMs: 20000,

  // Pause after scrolling the editor into view so focus/click events land reliably.
  editorScrollDelayMs: 120,

  // Pause after focusing the editor before sending mouse events.
  editorFocusDelayMs: 120,

  // Pause after clicking the editor before placing the caret and inserting text.
  editorClickDelayMs: 180,

  // Pause after placing the caret inside Facebook's editor.
  editorCaretDelayMs: 120,

  // Pause after using execCommand to insert post text, giving Facebook/Lexical time to register it.
  textInsertDelayMs: 220,

  // Pause after the keyboard-event fallback text insertion path.
  keyboardFallbackDelayMs: 220,

  // Max time to wait for Facebook's Post button to become enabled after content/media is inserted.
  postButtonEnableTimeoutMs: 7000,

  // Max time to watch for success/error signals after clicking Facebook's Post button.
  publishConfirmationTimeoutMs: 15000,

  // Facebook may keep a video-processing notice visible before the final post card/permalink appears.
  videoPublishConfirmationTimeoutMs: 60000,

  // Profile videos can remain in processing before the new TimelineFeedUnit exposes its reel identity.
  profileVideoPermalinkTimeoutMs: 180000,

  // After Facebook accepts a profile video, its processed-reel notification can expose the canonical URL first.
  profileVideoNotificationTimeoutMs: 180000,

  // Poll the already-open notifications document without creating more tabs.
  profileVideoNotificationPollIntervalMs: 2000,

  // Reload occasionally because Facebook does not always stream a new notification into an inactive tab.
  profileVideoNotificationRefreshIntervalMs: 15000,

  // Poll a hidden profile-feed tab while Facebook finishes processing a profile video.
  profileVideoProfileTimeoutMs: 120000,

  // Poll the profile feed DOM without creating another tab or touching the composer tab.
  profileVideoProfilePollIntervalMs: 2000,

  // Reload the hidden profile feed because Facebook may not hydrate a new reel in place.
  profileVideoProfileRefreshIntervalMs: 10000,

  // Once Facebook closes the composer, give the page a short grace period for
  // a permalink to appear before handing reconciliation to the background worker.
  profileVideoAcceptedEvidenceGraceMs: 5000,

  // How often to re-check the dialog/page while waiting for publish confirmation.
  publishPollIntervalMs: 500,

  // Pause after clicking Facebook's media/photo button before searching for the hidden file input.
  mediaButtonDelayMs: 600,

  // Max time to wait for Facebook's file input to appear.
  mediaInputTimeoutMs: 7000,

  // Max time to wait for Facebook to show a selected image preview in the composer.
  mediaPreviewTimeoutMs: 15000,

  // How often to check for media preview while waiting.
  mediaPreviewPollIntervalMs: 250,

  // Delay between GraphQL group-list pages during group sync to avoid rapid-fire requests.
  groupSyncPageDelayMs: 500,
};

(globalThis as { PostFlowPostingTiming?: PostFlowPostingTimingConfig }).PostFlowPostingTiming = postingTiming;

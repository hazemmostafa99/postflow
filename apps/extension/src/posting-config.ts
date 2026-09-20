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
  // Facebook can mount this late after several back-to-back group navigations.
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

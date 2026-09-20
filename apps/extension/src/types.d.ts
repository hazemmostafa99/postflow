interface FacebookGroup {
  id: string;        // URL slug (vanity name or numeric if no vanity)
  numericId?: string; // Facebook's internal numeric group ID
  name: string;
  url: string;
}

interface PostFlowPostingTimingConfig {
  facebookTabReadyTimeoutMs: number;
  facebookMessageRetryIntervalMs: number;
  groupPageReadyTimeoutMs: number;
  composerOpenDelayMs: number;
  intermediateComposerOptionDelayMs: number;
  createPostDialogTimeoutMs: number;
  editorScrollDelayMs: number;
  editorFocusDelayMs: number;
  editorClickDelayMs: number;
  editorCaretDelayMs: number;
  textInsertDelayMs: number;
  keyboardFallbackDelayMs: number;
  postButtonEnableTimeoutMs: number;
  publishConfirmationTimeoutMs: number;
  videoPublishConfirmationTimeoutMs: number;
  publishPollIntervalMs: number;
  mediaButtonDelayMs: number;
  mediaInputTimeoutMs: number;
  mediaPreviewTimeoutMs: number;
  mediaPreviewPollIntervalMs: number;
  groupSyncPageDelayMs: number;
}

interface Window {
  PostFlowPostingTiming?: PostFlowPostingTimingConfig;
}

interface WorkerGlobalScope {
  PostFlowPostingTiming?: PostFlowPostingTimingConfig;
}

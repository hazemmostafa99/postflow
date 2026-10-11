type TikTokComposerCommand = {
  jobId: string;
  targetType: 'TIKTOK_VIDEO' | 'TIKTOK_PHOTO';
  expectedUsername: string;
  apiBaseUrl: string;
  /** Continue an upload that already reached TikTok's editor after a page/context reload. */
  resume?: boolean;
  /** Temporary diagnostic stop used to inspect Studio immediately after media ingestion. */
  pauseAfterUpload?: boolean;
  /** Temporary diagnostic stop used after caption injection/verification. */
  pauseAfterCaption?: boolean;
  post: { content?: string; media?: PostFlowJobMediaReference[] };
};
type TikTokComposerResult = { success: boolean; status: 'PUBLISHED' | 'PROCESSING' | 'UNKNOWN' | 'FAILED';
  reason?: string; postUrl?: string; canceled?: boolean; shouldPauseQueue?: boolean; detector?: string;
  diagnostics?: Record<string, unknown> };

const tiktokComposer = (() => {
  let busy = false;
  const selectors = tiktokSelectors;
  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const unknown = (reason: string, targetType: TikTokComposerCommand['targetType'] = 'TIKTOK_VIDEO'): TikTokComposerResult => ({
    success: true,
    status: 'UNKNOWN',
    reason,
    diagnostics: selectors.diagnostics(targetType),
  });
  const logStage = (stage: string, command: TikTokComposerCommand, details?: Record<string, unknown>) => {
    console.info('[PostFlow][TikTok] Composer stage', { stage, jobId: command.jobId, ...details });
    // Content-script console output is only visible from the TikTok tab's
    // DevTools. Relay sanitized stage metadata to the background console too.
    try {
      void chrome.runtime.sendMessage({
        type: 'TIKTOK_COMPOSER_STAGE',
        jobId: command.jobId,
        username: command.expectedUsername,
        stage,
        details,
      })
        .catch(() => undefined);
    } catch {
      // The page may be unloading; the background execution watchdog remains
      // responsible for converting a lost response into UNKNOWN.
    }
  };
  async function prepare(targetType: TikTokComposerCommand['targetType']): Promise<boolean> {
    if (selectors.root(targetType)) return true;
    const tab = selectors.uploadTab(targetType);
    if (!tab || !selectors.enabled(tab)) return false;
    tab.click();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (selectors.root(targetType)) return true;
      await sleep(250);
    }
    return false;
  }
  function assertIdentity(expected: string, ignoreLocalDraft = false): void {
    const interruption = selectors.interruption(ignoreLocalDraft);
    if (interruption) throw new Error(interruption);
    const evidence = detectTikTokIdentity();
    console.info('[PostFlow][TikTok] Composer identity check', {
      expectedUsername: expected,
      evidenceState: evidence.evidenceState,
      detectedUsername: evidence.externalUsername ?? null,
      source: evidence.source,
      path: location.pathname,
    });
    // TikTok Studio's upload surface can omit the account navigation shell
    // even while the authenticated session is valid. CHECKING is therefore
    // deferred to the installation-bound background/API guard below; an
    // explicit login page or a verified different account remains a hard
    // mismatch.
    if (evidence.evidenceState === 'LOGIN_REQUIRED' ||
      (evidence.evidenceState === 'VERIFIED' &&
        evidence.externalUsername?.toLowerCase() !== expected.toLowerCase())) {
      throw new Error('ACCOUNT_MISMATCH');
    }
  }
  async function guard(command: TikTokComposerCommand, ignoreLocalDraft = false): Promise<void> {
    assertIdentity(command.expectedUsername, ignoreLocalDraft);
    const result = await chrome.runtime.sendMessage({ type: 'TIKTOK_CHECK_JOB', jobId: command.jobId, username: command.expectedUsername });
    if (result?.canceled) throw new Error('CANCELED');
    if (!result?.ok) throw new Error(result?.uncertain ? 'SUBMISSION_ALREADY_ARMED' : 'JOB_CHECK_UNAVAILABLE');
  }
  async function clearLocalDraft(command: TikTokComposerCommand): Promise<void> {
    const diagnostics = selectors.diagnostics();
    if (!diagnostics.localDraftPresent) return;
    await guard(command, true);
    const draft = selectors.localDraft();
    const discard = draft ? selectors.localDraftDiscardButton(draft) : null;
    if (!draft || !discard || !selectors.enabled(discard)) throw new Error('LOCAL_DRAFT_PRESENT');
    logStage('local-draft-discarding', command, { diagnostics });
    discard.click();
    const deadline = Date.now() + 10_000;
    let confirmationClicked = false;
    let clearSamples = 0;
    while (Date.now() < deadline) {
      const dialog = selectors.localDraftDiscardDialog();
      if (dialog) {
        clearSamples = 0;
        if (!confirmationClicked) {
          const confirm = selectors.localDraftConfirmButton(dialog);
          if (!confirm || !selectors.enabled(confirm)) throw new Error('LOCAL_DRAFT_CONFIRMATION_UNAVAILABLE');
          logStage('local-draft-confirming', command, { diagnostics: selectors.diagnostics() });
          confirm.click();
          confirmationClicked = true;
        }
      } else if (!selectors.diagnostics().localDraftPresent) {
        clearSamples++;
      } else {
        clearSamples = 0;
      }
      if (clearSamples >= (confirmationClicked ? 2 : 4)) {
        logStage('local-draft-discarded', command, { diagnostics: selectors.diagnostics() });
        return;
      }
      await sleep(250);
    }
    throw new Error('LOCAL_DRAFT_DISCARD_TIMEOUT');
  }
  async function writeCaption(field: HTMLElement, text: string,
    command: TikTokComposerCommand): Promise<void> {
    field.focus();
    const readValue = () => field instanceof HTMLTextAreaElement ? field.value : field.textContent;
    const expected = text.replace(/\r\n/g, '\n');
    const selectAll = () => {
      const range = document.createRange();
      range.selectNodeContents(field);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    };
    const waitForStableValue = async (timeoutMs: number, value = expected): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      let stableSamples = 0;
      while (Date.now() < deadline) {
        if (selectors.pageError()) throw new Error('TIKTOK_PAGE_ERROR');
        if (readValue()?.replace(/\r\n/g, '\n') === value) {
          stableSamples++;
          if (stableSamples >= 2) return true;
        } else {
          stableSamples = 0;
        }
        await sleep(20);
      }
      return false;
    };
    if (field instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (command.targetType === 'TIKTOK_PHOTO') {
      // Use Chrome's tab-scoped input protocol for TikTok's Draft.js photo
      // editor. Synthetic DOM edits cause TikTok Studio to replace the page
      // with its error shell, while browser-level input matches real typing.
      if (readValue() === expected) return;
      if (readValue()?.trim()) throw new Error('CAPTION_FIELD_NOT_EMPTY');
      const range = document.createRange();
      range.selectNodeContents(field);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await sleep(100);
      logStage('browser-caption-input-started', command, { length: expected.length });
      const input = await chrome.runtime.sendMessage({
        type: 'TIKTOK_INSERT_CAPTION',
        jobId: command.jobId,
        username: command.expectedUsername,
        text,
      });
      if (!input?.ok) throw new Error(input?.reason || 'BROWSER_CAPTION_INPUT_FAILED');
      logStage('browser-caption-input-completed', command, { length: expected.length });
    } else {
      // Draft.js handles beforeinput as its closest equivalent to real typing.
      // Try that first; it avoids mutating the editor DOM behind React's back.
      // Older/fixture contexts may not expose InputEvent, so retain the
      // execCommand path as a compatibility fallback.
      selectAll();
      if (typeof InputEvent === 'function') {
        field.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        }));
        field.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text,
        }));
        if (await waitForStableValue(250)) return;
      }

      selectAll();
      if (!document.execCommand('insertText', false, text)) throw new Error('CAPTION_INSERT_FAILED');
      field.dispatchEvent(typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
        : new Event('input', { bubbles: true }));
    }
    if (!await waitForStableValue(3_000)) throw new Error('CAPTION_VERIFICATION_FAILED');
  }
  async function attach(scope: HTMLElement, command: TikTokComposerCommand): Promise<void> {
    const media = command.post.media;
    const valid = command.targetType === 'TIKTOK_PHOTO'
      ? Boolean(media && media.length >= 1 && media.length <= 4 && media.every((item) => item.contentType.startsWith('image/')))
      : Boolean(media && media.length === 1 && media[0].contentType.startsWith('video/'));
    if (!valid || !media) throw new Error(command.targetType === 'TIKTOK_PHOTO' ? 'INVALID_PHOTOS' : 'INVALID_VIDEO');
    const runtime = (globalThis as typeof globalThis & { PostFlowJobMedia?: PostFlowJobMediaRuntime }).PostFlowJobMedia;
    if (!runtime) throw new Error('MEDIA_RUNTIME_UNAVAILABLE');
    const files = await Promise.all(media.map((item) => runtime.fetchJobMediaFile(item, command.apiBaseUrl)));
    logStage('media-fetched', command, { count: files.length });
    await guard(command);
    const input = selectors.mediaInput(scope, command.targetType);
    if (!input) throw new Error('UPLOAD_INPUT_UNAVAILABLE');
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    logStage('media-attached', command);
  }
  async function waitPreparation(scope: HTMLElement, command: TikTokComposerCommand): Promise<HTMLElement> {
    const deadline = Date.now() + 120_000;
    let transitionLogged = false;
    let reacquisitionLogged = false;
    let stableReadySamples = 0;
    logStage('preparation-wait-started', command);
    while (Date.now() < deadline) {
      if (selectors.pageError()) throw new Error('TIKTOK_PAGE_ERROR');
      await guard(command);
      const liveScope = selectors.editorRoot() ?? (scope.isConnected ? scope : null);
      if (!liveScope) {
        if (!transitionLogged) {
          transitionLogged = true;
          logStage('editor-scope-transition', command, { diagnostics: selectors.diagnostics() });
        }
        await sleep(250);
        continue;
      }
      if (liveScope !== scope && !reacquisitionLogged) {
        reacquisitionLogged = true;
        logStage('editor-scope-reacquired', command, { diagnostics: selectors.diagnostics() });
      }
      scope = liveScope;
      if (selectors.preparationComplete(scope, command.targetType, command.post.media?.length ?? 0)) {
        stableReadySamples++;
        if (stableReadySamples >= 2) {
          logStage('preparation-complete', command, { diagnostics: selectors.diagnostics(command.targetType) });
          return scope;
        }
      } else {
        stableReadySamples = 0;
      }
      await sleep(1_000);
    }
    throw new Error('UPLOAD_PREPARATION_TIMEOUT');
  }
  async function waitPostControl(scope: HTMLElement, command: TikTokComposerCommand): Promise<{
    scope: HTMLElement;
    button: HTMLElement;
  }> {
    const deadline = Date.now() + 30_000;
    let waitingLogged = false;
    while (Date.now() < deadline) {
      if (selectors.pageError()) throw new Error('TIKTOK_PAGE_ERROR');
      await guard(command);
      scope = selectors.editorRoot() ?? (scope.isConnected ? scope : null) ?? scope;
      const button = selectors.postButton(scope);
      if (button && selectors.enabled(button)) {
        if (waitingLogged) logStage('post-control-ready', command, { diagnostics: selectors.diagnostics(command.targetType) });
        return { scope, button };
      }
      if (!waitingLogged) {
        waitingLogged = true;
        logStage('post-control-waiting', command, {
          controlPresent: Boolean(button),
          diagnostics: selectors.diagnostics(command.targetType),
        });
      }
      await sleep(500);
    }
    throw new Error('POST_CONTROL_UNAVAILABLE');
  }
  async function reacquirePostControlAfterArm(scope: HTMLElement, command: TikTokComposerCommand,
    previousButton: HTMLElement): Promise<{ scope: HTMLElement; button: HTMLElement } | null> {
    const deadline = Date.now() + 10_000;
    let changedLogged = false;
    while (Date.now() < deadline) {
      // The confirmation checkpoint is the last asynchronous boundary before
      // Post. If TikTok has not replaced the verified control, click it on the
      // first pass instead of spending another DOM scan on a fragile SPA.
      if (previousButton.isConnected && selectors.enabled(previousButton)) {
        return { scope, button: previousButton };
      }
      scope = selectors.editorRoot() ?? (scope.isConnected ? scope : null) ?? scope;
      const button = selectors.postButton(scope);
      if (button && selectors.enabled(button)) {
        if (button !== previousButton && !changedLogged) {
          changedLogged = true;
          logStage('post-control-reacquired-after-arm', command, { diagnostics: selectors.diagnostics(command.targetType) });
        }
        return { scope, button };
      }
      await sleep(250);
    }
    return null;
  }
  async function observe(scope: HTMLElement, command: TikTokComposerCommand, baseline: Set<string>,
    submissionStartedAt: number): Promise<TikTokComposerResult> {
    const deadline = Date.now() + 150_000;
    let copyrightContinuationConfirmed = false;
    let contentPageLogged = false;
    let reviewLogged = false;
    let processingResult: TikTokComposerResult | null = null;
    while (Date.now() < deadline) {
      const contentResult = selectors.contentPageOutcome(
        command.expectedUsername,
        command.post.content ?? '',
        submissionStartedAt,
      );
      if (/^\/tiktokstudio\/content\/?$/.test(location.pathname) && !contentPageLogged) {
        contentPageLogged = true;
        logStage('content-page-detected', command, { diagnostics: selectors.diagnostics() });
      }
      if (contentResult?.status === 'PUBLISHED') {
        logStage('content-row-published', command, { postUrl: contentResult.postUrl });
        return contentResult;
      }
      if (contentResult?.status === 'PROCESSING') {
        processingResult = contentResult;
        if (!reviewLogged) {
          reviewLogged = true;
          logStage('content-row-reviewing', command, { postUrlPresent: Boolean(contentResult.postUrl) });
        }
      }
      const result = selectors.outcome(scope, command.expectedUsername, baseline);
      if (result) return result;
      const continuation = selectors.copyrightContinuationDialog();
      if (continuation && !copyrightContinuationConfirmed) {
        const postNow = selectors.copyrightPostNowButton(continuation);
        if (!postNow || !selectors.enabled(postNow)) {
          return unknown('TikTok copyright-check confirmation changed after Post; confirm the submission manually', command.targetType);
        }
        logStage('copyright-check-continuation-confirming', command, { diagnostics: selectors.diagnostics() });
        postNow.click();
        copyrightContinuationConfirmed = true;
        logStage('copyright-check-post-now-clicked', command);
        continue;
      }
      if (selectors.interruption()) return unknown('TikTok interrupted after Post; confirm the submission manually', command.targetType);
      await sleep(1_000);
    }
    if (processingResult) return processingResult;
    return unknown('TikTok result timed out after Post; automatic retry is unsafe', command.targetType);
  }
  async function execute(command: TikTokComposerCommand): Promise<TikTokComposerResult> {
    if (busy) return { success: false, status: 'FAILED', reason: 'TikTok composer is busy' };
    busy = true;
    let armed = false;
    try {
      logStage('started', command, { path: location.pathname });
      if (!/^\/(?:tiktokstudio\/upload(?:\/post\/(?:photo|video))?|creator-center\/upload|upload)\/?$/.test(location.pathname)) throw new Error('UNSUPPORTED_UPLOAD_PAGE');
      if (!command.resume) {
        await clearLocalDraft(command);
        await guard(command);
      } else {
        logStage('resuming-existing-upload', command, { diagnostics: selectors.diagnostics(command.targetType) });
        await guard(command);
      }
      if (!await prepare(command.targetType)) throw new Error('UNSUPPORTED_COMPOSER');
      let scope = selectors.root(command.targetType);
      if (!scope) throw new Error('UNSUPPORTED_COMPOSER');
      logStage('composer-found', command);
      const baseline = new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((node) => {
        try { return new URL(node.href, location.href).pathname; } catch { return ''; }
      }));
      if (!command.resume) await attach(scope, command);
      scope = await waitPreparation(scope, command);
      if (command.pauseAfterUpload) {
        logStage('debug-paused-after-upload', command, {
          diagnostics: selectors.diagnostics(command.targetType),
        });
        return {
          success: false,
          status: 'FAILED',
          reason: 'DEBUG_PAUSED_AFTER_UPLOAD',
          diagnostics: selectors.diagnostics(command.targetType),
        };
      }
      const field = selectors.caption(scope);
      if (!field) throw new Error('CAPTION_FIELD_UNAVAILABLE');
      logStage('caption-entry-started', command, {
        length: (command.post.content ?? '').length,
        editor: command.targetType === 'TIKTOK_PHOTO' ? 'draft-js' : field.tagName.toLowerCase(),
      });
      await writeCaption(field, command.post.content ?? '', command);
      logStage('caption-verified', command, { length: (command.post.content ?? '').length });
      if (command.pauseAfterCaption && command.targetType === 'TIKTOK_PHOTO') {
        logStage('debug-paused-after-caption', command, {
          diagnostics: selectors.diagnostics(command.targetType),
        });
        return {
          success: false,
          status: 'FAILED',
          reason: 'DEBUG_PAUSED_AFTER_CAPTION',
          diagnostics: selectors.diagnostics(command.targetType),
        };
      }
      const postControl = await waitPostControl(scope, command);
      scope = postControl.scope;
      const button = postControl.button;
      logStage('post-control-verified', command);
      const submissionStartedAt = Date.now();
      // Any lost acknowledgement here is uncertain: the server may have armed it.
      armed = true;
      const permission = await chrome.runtime.sendMessage({ type: 'TIKTOK_ARM_SUBMISSION', jobId: command.jobId, username: command.expectedUsername });
      if (!permission?.ok) return unknown('Submission permission was not confirmed; inspect the job before any retry', command.targetType);
      logStage('submission-armed', command);
      logStage('submission-confirmation-waiting', command);
      const confirmed = await chrome.runtime.sendMessage({ type: 'TIKTOK_CONFIRM_SUBMISSION', jobId: command.jobId, username: command.expectedUsername });
      if (!confirmed?.ok) return unknown('Job stopped after submission was armed; confirm the upload manually', command.targetType);
      logStage('submission-confirmed', command);
      // Identity and cancellation were already checked by guard() and the
      // installation-bound API checkpoint. Avoid another DOM-wide identity
      // scan here: TikTok can tear down the Studio editor immediately after
      // confirmation, and that scan would prevent the already-verified Post
      // control from being clicked.
      const finalControl = await reacquirePostControlAfterArm(scope, command, button);
      if (!finalControl) return unknown('Post control changed after submission was armed', command.targetType);
      scope = finalControl.scope;
      finalControl.button.click();
      logStage('post-clicked', command);
      return await observe(scope, command, baseline, submissionStartedAt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn('[PostFlow][TikTok] Composer stage failed', { jobId: command.jobId, reason, armed });
      if (armed || reason === 'SUBMISSION_ALREADY_ARMED') return unknown(reason, command.targetType);
      return { success: false, status: 'FAILED', reason, canceled: reason === 'CANCELED',
        shouldPauseQueue: ['ACCOUNT_MISMATCH', 'LOGIN_REQUIRED', 'MANUAL_INTERVENTION_REQUIRED',
          'LOCAL_DRAFT_PRESENT', 'LOCAL_DRAFT_CONFIRMATION_UNAVAILABLE',
          'LOCAL_DRAFT_DISCARD_TIMEOUT'].includes(reason), detector: reason,
        diagnostics: selectors.diagnostics(command.targetType) };
    } finally { busy = false; }
  }
  return {
    execute,
    prepare,
    ready: (targetType: TikTokComposerCommand['targetType']) => Boolean(selectors.root(targetType)),
    diagnostics: (targetType: TikTokComposerCommand['targetType']) => selectors.diagnostics(targetType),
    isBusy: () => busy,
  };
})();
(globalThis as typeof globalThis & { PostFlowTikTokComposer?: typeof tiktokComposer }).PostFlowTikTokComposer = tiktokComposer;

// Classic content-script facade. Every action is scoped to a recognized TikTok surface.
const tiktokSelectors = (() => {
  const visible = (node: Element): boolean => {
    const style = getComputedStyle(node);
    return !node.closest('[hidden], [aria-hidden="true"]') && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const enabled = (node: HTMLElement): boolean => !node.hasAttribute('disabled') &&
    node.getAttribute('aria-disabled') !== 'true' && node.getAttribute('data-disabled') !== 'true' && visible(node);
  type TikTokTargetType = 'TIKTOK_VIDEO' | 'TIKTOK_PHOTO';
  function mediaInputs(targetType: TikTokTargetType): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      .filter((input) => targetType === 'TIKTOK_PHOTO'
        ? /image|\.jpe?g|\.png|\.webp/i.test(input.getAttribute('accept') ?? '') && input.hasAttribute('multiple')
        : /video|\.mp4|\.mov/i.test(input.getAttribute('accept') ?? ''));
  }
  function mediaInput(scope: HTMLElement, targetType: TikTokTargetType): HTMLInputElement | null {
    const matches = mediaInputs(targetType).filter((input) => scope.contains(input));
    return matches.length === 1 ? matches[0] : null;
  }
  function root(targetType: TikTokTargetType = 'TIKTOK_VIDEO'): HTMLElement | null {
    const inputs = mediaInputs(targetType);
    if (inputs.length !== 1) return null;
    const scoped = inputs[0].closest<HTMLElement>(
      '[role="tabpanel"], form, [data-e2e="upload-container"], [data-e2e="upload-form"], [aria-live="polite"]',
    );
    if (scoped) return scoped;
    // Arabic TikTok Studio photo pages place the multi-file input beside the
    // photo grid inside the page container, without a form or tabpanel.
    if (targetType === 'TIKTOK_PHOTO') {
      const editor = editorRoot();
      if (editor?.contains(inputs[0]) && editor.querySelector('[class*="photoGrid"]')) return editor;
    }
    return null;
  }
  function uploadTab(targetType: TikTokTargetType): HTMLElement | null {
    const label = targetType === 'TIKTOK_PHOTO'
      ? /^(?:photos?|الصور|صور)$/i
      : /^(?:videos?|الفيديو|فيديو|الفيديوهات|مقاطع الفيديو)$/i;
    const controls = targetType === 'TIKTOK_PHOTO' ? 'panel-photo' : 'panel-video';
    const matches = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"], button')).filter((node) =>
      visible(node) && (node.getAttribute('aria-controls') === controls ||
        label.test((node.textContent ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim())));
    return matches.length === 1 ? matches[0] : null;
  }
  function editorRoot(): HTMLElement | null {
    const anchor = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-e2e="caption_container"], [data-e2e="upload_status_container"]',
    )).find(visible) ?? null;
    return anchor?.closest<HTMLElement>(
      '[data-tt="PageContainer_NewPageContainer_FlexColumn"], .main-body',
    ) ?? anchor?.parentElement ?? null;
  }
  function localDraft(): HTMLElement | null {
    const matches = Array.from(document.querySelectorAll<HTMLElement>('[data-e2e="local_draft_container"]'))
      .filter(visible);
    return matches.length === 1 ? matches[0] : null;
  }
  function localDraftDiscardButton(scope: HTMLElement): HTMLElement | null {
    const matches = Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"]')).filter((node) =>
      visible(node) && /^(discard|ignore|تجاهل)$/i.test((node.getAttribute('aria-label') ?? node.textContent ?? '').trim()));
    return matches.length === 1 ? matches[0] : null;
  }
  function localDraftDiscardDialog(): HTMLElement | null {
    const matches = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((node) => {
      if (!visible(node)) return false;
      const title = node.getAttribute('title') ??
        node.querySelector<HTMLElement>('.common-modal-header, [id$="_title"]')?.textContent ?? '';
      return /^(?:discard this post\?|هل تريد تجاهل هذا المنشور؟)$/i.test(title.trim());
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function localDraftConfirmButton(scope: HTMLElement): HTMLElement | null {
    const matches = Array.from(scope.querySelectorAll<HTMLElement>('button')).filter((node) =>
      visible(node) && /^(discard|ignore|remove|تجاهل|إزالة)$/i.test((node.getAttribute('aria-label') ?? node.textContent ?? '').trim()));
    return matches.length === 1 ? matches[0] : null;
  }
  function copyrightContinuationDialog(): HTMLElement | null {
    const matches = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((node) => {
      if (!visible(node)) return false;
      const title = node.getAttribute('title') ??
        node.querySelector<HTMLElement>('.common-modal-header, [id$="_title"]')?.textContent ?? '';
      const content = node.textContent ?? '';
      return /^(?:continue to post\?|هل تريد المتابعة للنشر؟)$/i.test(title.trim()) &&
        /(?:copyright check is incomplete|ما زلنا نفحص الفيديو)/i.test(content) &&
        /(?:posting your video now will stop the check|مواصلة النشر قبل اكتمال الفحص)/i.test(content);
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function copyrightPostNowButton(scope: HTMLElement): HTMLElement | null {
    const matches = Array.from(scope.querySelectorAll<HTMLElement>('button')).filter((node) =>
      visible(node) && /^(?:post now|النشر الآن)$/i.test((node.getAttribute('aria-label') ?? node.textContent ?? '').trim()));
    return matches.length === 1 ? matches[0] : null;
  }
  function contentRows(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-tt="components_PostTable_Absolute"]'))
      .filter((row) => visible(row) && Boolean(row.querySelector('[data-tt="components_PostInfoCell_Container"]')));
  }
  /**
   * TikTok sometimes replaces the upload composer with a full-page error
   * shell.  The URL remains `/tiktokstudio/upload`, so URL-only readiness
   * checks incorrectly treat that shell as a live editor.
   */
  function pageError(): boolean {
    const bodyText = document.body?.textContent ?? '';
    if (!/something went wrong/i.test(bodyText) || !/please try again/i.test(bodyText)) return false;
    return Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .some((node) => visible(node) && /^retry$/i.test((node.textContent ?? '').trim()));
  }
  function diagnostics(targetType: TikTokTargetType = 'TIKTOK_VIDEO') {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const videoInputs = inputs.filter((input) => /video|\.mp4|\.mov/i.test(input.getAttribute('accept') ?? ''));
    const imageInputs = inputs.filter((input) => /image|\.jpe?g|\.png|\.webp/i.test(input.getAttribute('accept') ?? ''));
    const editor = editorRoot();
    const controls = editor ? postButtons(editor) : [];
    return {
      inputCount: inputs.length,
      videoInputCount: videoInputs.length,
      imageInputCount: imageInputs.length,
      targetType,
      scoped: Boolean(root(targetType)),
      editorReady: Boolean(editor),
      postControlCount: controls.length,
      enabledPostControlCount: controls.filter(enabled).length,
      localDraftPresent: Boolean(Array.from(document.querySelectorAll('[data-e2e="local_draft_container"]')).some(visible)),
      localDraftConfirmationPresent: Boolean(localDraftDiscardDialog()),
      copyrightContinuationPresent: Boolean(copyrightContinuationDialog()),
      contentRowCount: contentRows().length,
      pageErrorPresent: pageError(),
    };
  }
  function postButtons(scope: HTMLElement): HTMLElement[] {
    return Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"]')).filter((node) =>
      visible(node) && (node.getAttribute('data-e2e') === 'post_video_button' ||
      /^(post|publish|نشر)$/i.test((node.getAttribute('aria-label') ?? node.textContent ?? '').trim())));
  }
  function postButton(scope: HTMLElement): HTMLElement | null {
    const matches = postButtons(scope);
    return matches.length === 1 ? matches[0] : null;
  }
  function caption(scope: HTMLElement): HTMLElement | null {
    const matches = Array.from(scope.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')).filter((node) =>
      visible(node) && (/caption|description/i.test(node.getAttribute('data-e2e') ?? '') ||
      Boolean(node.closest('[data-e2e="caption_container"]')) ||
      /^(caption|description|وصف|الوصف|شرح توضيحي)$/i.test(node.getAttribute('aria-label') ?? '')));
    return matches.length === 1 ? matches[0] : null;
  }
  function interruption(ignoreLocalDraft = false): string | null {
    if (/^\/(login|signup)(\/|$)/.test(location.pathname)) return 'LOGIN_REQUIRED';
    if (pageError()) return 'TIKTOK_PAGE_ERROR';
    if (!ignoreLocalDraft && Array.from(document.querySelectorAll('[data-e2e="local_draft_container"]')).some(visible)) {
      return 'LOCAL_DRAFT_PRESENT';
    }
    if (document.querySelector('iframe[src*="captcha"], [data-e2e="captcha"], [data-e2e="verification"]')) return 'MANUAL_INTERVENTION_REQUIRED';
    const alerts = Array.from(document.querySelectorAll('[role="alert"], [role="dialog"]')).filter(visible);
    return alerts.some((node) => /captcha|verify your identity|security check|تحقق من هويتك|التحقق الأمني/i.test(node.textContent ?? ''))
      ? 'MANUAL_INTERVENTION_REQUIRED' : null;
  }
  function preparationComplete(
    scope: HTMLElement,
    targetType: TikTokTargetType = 'TIKTOK_VIDEO',
    expectedMediaCount = 0,
  ): boolean {
    if (scope.querySelector('[aria-busy="true"], progress:not([value="100"])')) return false;
    const completedUploadText = (value: string) => {
      const normalized = value.normalize('NFKC')
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return /(?:uploaded|upload complete|ready to post|تم\s+التحميل|اكتمل\s+التحميل|تم\s+رفع(?:\s+الفيديو)?|اكتمل\s+الرفع)/i.test(normalized);
    };
    const uploadCard = scope.querySelector('[data-e2e="upload_status_container"]');
    if (uploadCard?.querySelector('.info-status.success')) return true;
    if (uploadCard && completedUploadText(uploadCard.textContent ?? '')) return true;
    const successfulStatuses = Array.from(scope.querySelectorAll('.info-status.success')).filter(visible);
    if (successfulStatuses.some((node) => completedUploadText(node.textContent ?? '') ||
      Boolean(node.querySelector('[data-icon="CheckCircleFill"], [data-testid="CheckCircleFill"]')))) return true;
    if (targetType === 'TIKTOK_PHOTO' && postButton(scope)) {
      const photoGrid = scope.querySelector<HTMLElement>('[class*="photoGrid"]');
      const photoTileCount = photoGrid?.querySelectorAll('[aria-roledescription="draggable"] img').length ?? 0;
      if (expectedMediaCount > 0 && photoTileCount === expectedMediaCount) return true;
      // TikTok often renders the count directly next to the Post label, so
      // avoid requiring a word boundary after "uploaded".
      const uploaded = Number((scope.textContent ?? '').match(/(\d+)\s+photos?\s+uploaded/i)?.[1] ?? 0);
      const selected = mediaInput(scope, targetType)?.files?.length ?? 0;
      // TikTok may clear the file input after ingesting the files. When it
      // keeps the FileList, require the editor's uploaded count to catch up
      // before allowing the caption/Post phase to begin.
      if (uploaded > 0 && (selected === 0 || uploaded >= selected)) return true;
    }
    const statuses = Array.from(scope.querySelectorAll('[data-e2e="upload-status"], [role="status"]')).filter(visible);
    return statuses.some((node) => completedUploadText(node.textContent ?? ''));
  }
  function contentPageOutcome(expected: string, expectedCaption: string, submissionStartedAt: number) {
    if (!/^\/tiktokstudio\/content\/?$/.test(location.pathname)) return null;
    const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
    const caption = normalizeText(expectedCaption);
    const rows = contentRows();
    for (const row of rows) {
      const title = row.querySelector<HTMLElement>('[data-tt="components_PostInfoCell_Container"]')?.textContent ?? '';
      if (caption && normalizeText(title) !== caption) continue;
      const reviewing = /\b(reviewing|under review|processing|checking)\b/i.test(row.textContent ?? '');
      const links = Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href]'));
      for (const anchor of links) {
        try {
          const url = new URL(anchor.href, location.href);
          const match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d{15,24})\/?$/);
          if (url.protocol !== 'https:' || !['www.tiktok.com', 'tiktok.com'].includes(url.hostname) || !match ||
            match[1].toLowerCase() !== expected.toLowerCase()) continue;
          const createdAt = Number(BigInt(match[3]) >> 32n) * 1_000;
          if (!Number.isFinite(createdAt) || createdAt < submissionStartedAt - 60_000 || createdAt > Date.now() + 60_000) continue;
          const postUrl = `https://www.tiktok.com${url.pathname.replace(/\/$/, '')}`;
          if (reviewing) return { success: true, status: 'PROCESSING' as const,
            reason: 'TikTok accepted the post and is reviewing it', postUrl };
          return { success: true, status: 'PUBLISHED' as const, postUrl };
        } catch { /* Ignore unsupported or malformed content-table links. */ }
      }
      if (reviewing) return { success: true, status: 'PROCESSING' as const,
        reason: 'TikTok accepted the post and is reviewing it' };
    }
    return null;
  }
  function outcome(scope: HTMLElement, expected: string, baseline: Set<string>) {
    const success = document.querySelector('[data-e2e="upload-success"], [data-e2e="post-success"]');
    if (success && visible(success)) {
      for (const anchor of Array.from(success.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        try {
          const url = new URL(anchor.href, location.href);
          const match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,24})\/(video|photo)\/(\d+)\/?$/);
          if (url.protocol === 'https:' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && match &&
            match[1].toLowerCase() === expected.toLowerCase() && !baseline.has(url.pathname)) {
            return { success: true, status: 'PUBLISHED' as const, postUrl: `https://www.tiktok.com${url.pathname.replace(/\/$/, '')}` };
          }
        } catch { /* Ignore unsupported links. */ }
      }
    }
    const statuses = Array.from(scope.querySelectorAll('[role="status"], [data-e2e="upload-status"]')).filter(visible);
    if (statuses.some((node) => /^(processing|video is processing|جارٍ معالجة الفيديو|جاري معالجة الفيديو)$/i.test(node.textContent?.trim() ?? ''))) {
      return { success: true, status: 'PROCESSING' as const, reason: 'TikTok accepted the video for processing; confirm its final status manually' };
    }
    return null;
  }
  return { root, mediaInput, uploadTab, editorRoot, localDraft, localDraftDiscardButton, localDraftDiscardDialog,
    localDraftConfirmButton, copyrightContinuationDialog, copyrightPostNowButton, diagnostics,
    postButton, caption, interruption, pageError, preparationComplete, contentPageOutcome, outcome, enabled };
})();
(globalThis as typeof globalThis & { PostFlowTikTokSelectors?: typeof tiktokSelectors }).PostFlowTikTokSelectors = tiktokSelectors;

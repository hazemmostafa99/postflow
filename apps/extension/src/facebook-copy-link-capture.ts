(() => {
  const captureWindow = window as Window & {
    __postflowFacebookCopyLinkCaptureInstalled?: boolean;
  };
  if (captureWindow.__postflowFacebookCopyLinkCaptureInstalled) return;
  captureWindow.__postflowFacebookCopyLinkCaptureInstalled = true;

  const normalizeShareVideoUrl = (value: string): string | null => {
    try {
      const url = new URL(value.trim());
      if (url.hostname !== 'facebook.com' && !url.hostname.endsWith('.facebook.com')) return null;
      const shareMatch = url.pathname.match(/^\/share\/v\/([A-Za-z0-9_-]+)\/?$/i);
      if (shareMatch) return `https://www.facebook.com/share/v/${shareMatch[1]}/`;
      const groupPostMatch = url.pathname.match(
        /^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)\/?$/i,
      );
      if (!groupPostMatch) return null;
      return `https://www.facebook.com/groups/${groupPostMatch[1]}/${groupPostMatch[2]}/${groupPostMatch[3]}/`;
    } catch {
      return null;
    }
  };

  const emit = (value: string, captureMethod: string): boolean => {
    const shareUrl = normalizeShareVideoUrl(value);
    if (!shareUrl) return false;
    window.postMessage({
      source: 'postflow-facebook-copy-link',
      text: shareUrl,
      captureMethod,
    }, window.location.origin);
    return true;
  };

  const selectedText = (): string => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      return activeElement.value.slice(
        activeElement.selectionStart ?? 0,
        activeElement.selectionEnd ?? 0,
      );
    }
    return window.getSelection()?.toString() ?? '';
  };

  const clipboard = navigator.clipboard;
  if (clipboard) {
    const clipboardPrototype = Object.getPrototypeOf(clipboard);
    const originalWriteText = typeof clipboard.writeText === 'function'
      ? clipboard.writeText.bind(clipboard)
      : null;
    const originalWrite = typeof clipboard.write === 'function'
      ? clipboard.write.bind(clipboard)
      : null;
    const installClipboardMethod = (
      name: 'writeText' | 'write',
      value: (...args: any[]) => Promise<void>,
    ) => {
      try {
        Object.defineProperty(clipboard, name, { configurable: true, writable: true, value });
      } catch {
        try {
          Object.defineProperty(clipboardPrototype, name, { configurable: true, writable: true, value });
        } catch {
          // The copy-event and execCommand paths below remain available.
        }
      }
    };

    installClipboardMethod('writeText', async (text: string) => {
      if (emit(text, 'clipboard.writeText')) return;
      if (originalWriteText) return originalWriteText(text);
      throw new DOMException('Clipboard writeText is unavailable', 'NotSupportedError');
    });
    installClipboardMethod('write', async (items: ClipboardItem[]) => {
      for (const item of items ?? []) {
        if (!item?.types?.includes('text/plain')) continue;
        try {
          const blob = await item.getType('text/plain');
          if (emit(await blob.text(), 'clipboard.write')) return;
        } catch {
          // Inspect the next ClipboardItem before using Facebook's original call.
        }
      }
      if (originalWrite) return originalWrite(items);
      throw new DOMException('Clipboard write is unavailable', 'NotSupportedError');
    });
  }

  const originalExecCommand = typeof document.execCommand === 'function'
    ? document.execCommand.bind(document)
    : null;
  if (originalExecCommand) {
    document.execCommand = ((commandId: string, showUI?: boolean, value?: string): boolean => {
      const result = originalExecCommand(commandId, showUI, value);
      if (commandId.toLowerCase() === 'copy') {
        emit(selectedText(), 'document.execCommand');
      }
      return result;
    }) as typeof document.execCommand;
  }

  window.addEventListener('copy', (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text/plain') || selectedText();
    if (emit(text, 'copy-event')) event.preventDefault();
  });
})();

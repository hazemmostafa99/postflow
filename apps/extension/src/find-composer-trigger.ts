/** Find an explicitly labelled composer action, never an arbitrary focusable control. */
function findComposerTrigger(root: ParentNode = document): HTMLElement | null {
  const prompts = [
    'اكتب شيئًا', 'اكتب شيئ', 'اكتب شيء', 'ما الذي يدور',
    'write something', "what's on your mind", 'create a post', 'create post',
    'écrivez quelque chose', 'was möchtest du',
  ];
  const matchesPrompt = (value: string | null): boolean => {
    const text = (value ?? '').trim().toLowerCase().replace(/’/g, "'");
    return text.length <= 120 && prompts.some(prompt => text.startsWith(prompt));
  };
  const findIn = (scope: ParentNode): HTMLElement | null => {
    // Facebook's English inline composer is rendered as an unlabelled
    // role=button containing the visible "Write something..." span. Resolve
    // that exact text first so nearby actions (Invite, Create event, etc.) can
    // never win because they happen to be earlier in the DOM.
    for (const span of scope.querySelectorAll<HTMLElement>('span')) {
      if (!matchesPrompt(span.textContent) || !/^write something/i.test((span.textContent ?? '').trim())) continue;
      const trigger = span.parentElement?.closest<HTMLElement>('[role="button"], button');
      if (trigger && (trigger.textContent ?? '').trim().toLowerCase() === (span.textContent ?? '').trim().toLowerCase()
        && !trigger.closest('[role="article"], [role="dialog"], [hidden], [aria-hidden="true"]')) return trigger;
    }
    for (const candidate of scope.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      if (candidate.closest('[role="article"], [role="dialog"], [hidden], [aria-hidden="true"]')) continue;
      if (candidate.matches(':disabled, [aria-disabled="true"]')) continue;
      const style = window.getComputedStyle(candidate);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const label = candidate.getAttribute('aria-label');
      // An explicit accessible label takes precedence over descendant text.
      if (matchesPrompt(label) || (!label && (
        matchesPrompt(candidate.getAttribute('aria-placeholder')) ||
        matchesPrompt(candidate.textContent)
      ))) return candidate;
    }
    return null;
  };
  for (const inline of root.querySelectorAll('[data-pagelet="GroupInlineComposer"]')) {
    const trigger = findIn(inline);
    if (trigger) return trigger;
  }
  return findIn(root.querySelector('[role="main"]') ?? root);
}

interface FacebookInterruptionDetectorOptions {
  root?: ParentNode;
  hasVideo?: boolean;
  activeComposer?: Element | null;
  initialPageUrl?: string;
}

const FACEBOOK_INTERRUPTION_PATTERNS: Array<{
  status: FacebookPublishInterruptionStatus;
  detector: string;
  shouldPauseQueue: boolean;
  patterns: string[];
}> = [
  {
    status: 'TEMPORARY_BLOCK',
    detector: 'temporary-block-text',
    shouldPauseQueue: true,
    patterns: [
      'temporarily blocked',
      'temporary block',
      'action blocked',
      'you are temporarily restricted',
      'you have been temporarily restricted',
      'you can\'t post right now',
      'you cannot post right now',
      'you can\u2019t use this feature right now',
      'you\u2019re using this feature too fast',
      'performed this action too many times',
      'try again later',
      '\u062a\u0645 \u062d\u0638\u0631\u0643 \u0645\u0624\u0642\u062a\u0627',
      '\u062a\u0645 \u062d\u0638\u0631\u0643 \u0645\u0624\u0642\u062a\u064b\u0627',
      '\u0627\u0646\u062a \u0645\u062d\u0638\u0648\u0631 \u0645\u0624\u0642\u062a\u0627',
      '\u0623\u0646\u062a \u0645\u062d\u0638\u0648\u0631 \u0645\u0624\u0642\u062a\u064b\u0627',
      '\u0645\u062d\u0638\u0648\u0631 \u0645\u0624\u0642\u062a\u0627',
      '\u062a\u0645 \u062a\u0642\u064a\u064a\u062f\u0643 \u0645\u0624\u0642\u062a\u0627',
      '\u062a\u0645 \u062a\u0642\u064a\u064a\u062f \u062d\u0633\u0627\u0628\u0643 \u0645\u0624\u0642\u062a\u0627',
      '\u0645\u0642\u064a\u062f \u0645\u0624\u0642\u062a\u0627',
      '\u0644\u0627 \u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u0627\u0646',
      '\u0644\u0627 \u064a\u0645\u0643\u0646\u0643 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0647\u0630\u0647 \u0627\u0644\u0645\u064a\u0632\u0629 \u0627\u0644\u0627\u0646',
      '\u0627\u0633\u062a\u062e\u062f\u0645\u062a \u0647\u0630\u0647 \u0627\u0644\u0645\u064a\u0632\u0629 \u0628\u0633\u0631\u0639\u0629 \u0643\u0628\u064a\u0631\u0629',
      '\u062a\u0633\u062a\u062e\u062f\u0645 \u0647\u0630\u0647 \u0627\u0644\u0645\u064a\u0632\u0629 \u0628\u0633\u0631\u0639\u0629',
      '\u0644\u0642\u062f \u0642\u0645\u062a \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u062c\u0631\u0627\u0621 \u0645\u0631\u0627\u062a \u0643\u062b\u064a\u0631\u0629',
      '\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0627\u062e\u0631\u0649 \u0644\u0627\u062d\u0642\u0627',
      '\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0627\u062e\u0631\u0649 \u0644\u0627\u062d\u0642\u064b\u0627',
    ],
  },
  {
    status: 'CAPTCHA_OR_CHALLENGE',
    detector: 'captcha-or-challenge-text',
    shouldPauseQueue: true,
    patterns: [
      'captcha',
      'security check',
      'verify you are human',
      "verify you're human",
      'human verification',
      'confirm you are not a robot',
      'suspicious activity',
      'unusual activity',
      'complete this security check',
      '\u0643\u0627\u0628\u062a\u0634\u0627',
      '\u062a\u062d\u0642\u0642 \u0627\u0645\u0627\u0646\u064a',
      '\u0641\u062d\u0635 \u0627\u0645\u0627\u0646\u064a',
      '\u0627\u0643\u0645\u0644 \u0641\u062d\u0635 \u0627\u0644\u0627\u0645\u0627\u0646',
      '\u0627\u0643\u0645\u0644 \u0627\u062e\u062a\u0628\u0627\u0631 \u0627\u0644\u0627\u0645\u0627\u0646',
      '\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0646\u0643 \u0627\u0646\u0633\u0627\u0646',
      '\u062a\u0627\u0643\u062f \u0645\u0646 \u0627\u0646\u0643 \u0644\u0633\u062a \u0631\u0648\u0628\u0648\u062a\u0627',
      '\u0644\u0633\u062a \u0631\u0648\u0628\u0648\u062a\u0627',
      '\u0646\u0634\u0627\u0637 \u0645\u0634\u0628\u0648\u0647',
      '\u0646\u0634\u0627\u0637 \u063a\u064a\u0631 \u0645\u0639\u062a\u0627\u062f',
    ],
  },
  {
    status: 'CHECKPOINT_OR_VERIFICATION',
    detector: 'checkpoint-or-verification-text',
    shouldPauseQueue: true,
    patterns: [
      'confirm your identity',
      'account confirmation',
      'account verification',
      'security verification',
      'checkpoint',
      'help us confirm it\'s you',
      'help us confirm it\u2019s you',
      'protect your account',
      '\u062a\u0627\u0643\u064a\u062f \u0647\u0648\u064a\u062a\u0643',
      '\u0627\u0643\u062f \u0647\u0648\u064a\u062a\u0643',
      '\u0627\u0643\u062f \u0627\u0646\u0647 \u0627\u0646\u062a',
      '\u0633\u0627\u0639\u062f\u0646\u0627 \u0641\u064a \u062a\u0627\u0643\u064a\u062f \u0627\u0646\u0647 \u0627\u0646\u062a',
      '\u062a\u0627\u0643\u064a\u062f \u0627\u0644\u062d\u0633\u0627\u0628',
      '\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u062d\u0633\u0627\u0628',
      '\u062d\u0645\u0627\u064a\u0629 \u062d\u0633\u0627\u0628\u0643',
    ],
  },
];

function detectFacebookPublishingInterruption({
  root = document,
  activeComposer = null,
}: FacebookInterruptionDetectorOptions = {}): FacebookPublishInterruption | null {
  const navigationResult = detectFacebookNavigationInterruption();
  if (navigationResult) return navigationResult;

  const surfaces = getFacebookInterruptionSurfaces(root, activeComposer);
  for (const surface of surfaces) {
    const text = normalizeFacebookDetectorText(getFacebookVisibleText(surface));
    if (!text) continue;
    for (const config of FACEBOOK_INTERRUPTION_PATTERNS) {
      const matched = config.patterns.find((pattern) => text.includes(normalizeFacebookDetectorText(pattern)));
      if (!matched) continue;
      return {
        status: config.status,
        reason: getFacebookInterruptionReason(config.status),
        source: surface === activeComposer ? 'composer' : 'dom',
        detector: config.detector,
        shouldPauseQueue: config.shouldPauseQueue,
        diagnosticText: compactFacebookDiagnosticText(text),
      };
    }
  }

  return null;
}

function detectFacebookNavigationInterruption(): FacebookPublishInterruption | null {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return null;
  }

  const path = url.pathname.toLowerCase();
  if (/^\/(?:login|r\.php|recover|checkpoint\/login)/.test(path) || path.includes('/login/')) {
    return {
      status: 'LOGIN_REQUIRED',
      reason: 'Facebook requires login before publishing can continue',
      source: 'navigation',
      detector: 'login-url',
      shouldPauseQueue: true,
    };
  }

  if (path.includes('/checkpoint') || path.includes('/security') || path.includes('/confirmemail')) {
    return {
      status: 'CHECKPOINT_OR_VERIFICATION',
      reason: 'Facebook redirected to a checkpoint or verification flow',
      source: 'navigation',
      detector: 'checkpoint-url',
      shouldPauseQueue: true,
    };
  }

  return null;
}

function getFacebookInterruptionSurfaces(root: ParentNode, activeComposer: Element | null): Element[] {
  const candidates = new Set<Element>();
  for (const selector of [
    '[role="alertdialog"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[role="alert"]',
    '[role="status"]',
    '[aria-live]',
  ]) {
    root.querySelectorAll?.(selector).forEach((element) => {
      if (isFacebookVisibleElement(element)) candidates.add(element);
    });
  }
  if (activeComposer && isFacebookVisibleElement(activeComposer)) candidates.add(activeComposer);
  return Array.from(candidates);
}

function getFacebookVisibleText(root: ParentNode | Element | null): string {
  if (!root) return '';
  const documentBody = (root as Document).body;
  if (documentBody instanceof Element) return getFacebookVisibleText(documentBody);
  if (root instanceof Element && !isFacebookVisibleElement(root)) return '';
  const element = root as Element;
  return [
    element.textContent ?? '',
    element instanceof HTMLElement ? element.innerText ?? '' : '',
    element instanceof Element ? element.getAttribute('aria-label') ?? '' : '',
    element instanceof Element ? element.getAttribute('title') ?? '' : '',
  ].join(' ');
}

function isFacebookVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function getFacebookInterruptionReason(status: FacebookPublishInterruptionStatus): string {
  switch (status) {
    case 'TEMPORARY_BLOCK':
      return 'Facebook temporarily blocked or restricted posting';
    case 'CAPTCHA_OR_CHALLENGE':
      return 'Facebook requires a CAPTCHA or manual security challenge';
    case 'CHECKPOINT_OR_VERIFICATION':
      return 'Facebook requires account checkpoint or verification';
    case 'LOGIN_REQUIRED':
      return 'Facebook login is required';
    default:
      return 'Facebook interrupted publishing';
  }
}

function compactFacebookDiagnosticText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function normalizeFacebookDetectorText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0625\u0623\u0622\u0671]/g, '\u0627')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064a')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

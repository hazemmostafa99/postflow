type PendingApprovalDetectionResult =
  | { detected: true; evidence?: string; surface: Element }
  | { detected: false };

const APPROVAL_PHRASES = [
  "pending approval",
  "pending admin approval",
  "submitted for approval",
  "submitted to admins",
  "submitted to moderators",
  "waiting for approval",
  "awaiting approval",
  "reviewing your post",
  "your post is awaiting approval",
  "your post is pending review",
  "\u0645\u0646\u0634\u0648\u0631\u0643 \u0641\u064a \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631",
  "\u0645\u0646\u0634\u0648\u0631\u0643 \u0642\u064a\u062f \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631",
  "\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629",
  "\u0641\u064a \u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629",
  "\u0645\u0646\u0634\u0648\u0631\u0643 \u0642\u064a\u062f \u0627\u0644\u0645\u0631\u0627\u062c\u0639\u0629",
  "\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0645\u0646\u0634\u0648\u0631\u0643 \u0644\u0644\u0645\u0631\u0627\u062c\u0639\u0629",
  "\u062a\u0645 \u0627\u0631\u0633\u0627\u0644 \u0645\u0646\u0634\u0648\u0631\u0643 \u0644\u0644\u0645\u0631\u0627\u062c\u0639\u0629",
  "\u0641\u064a \u062d\u0627\u0644\u0629 \u0645\u0648\u0627\u0641\u0642\u0629 \u0641\u0631\u064a\u0642 \u0627\u0644\u0645\u0633\u0624\u0648\u0644\u064a\u0646 \u0639\u0644\u064a\u0647",
  "\u0633\u064a\u0635\u0628\u062d \u0645\u0631\u0626\u064a\u064b\u0627 \u0641\u064a \u0627\u0644\u0645\u062c\u0645\u0648\u0639\u0629",
  "\u0633\u064a\u0635\u0628\u062d \u0645\u0631\u0626\u064a\u0627 \u0641\u064a \u0627\u0644\u0645\u062c\u0645\u0648\u0639\u0629",
  "بانتظار الموافقة",
  "في انتظار الموافقة",
  "قيد الموافقة",
  "قيد المراجعة",
  "منشورك قيد المراجعة",
  "منشورك بانتظار الموافقة",
  "تم إرسال منشورك للمراجعة",
  "تم ارسال منشورك للمراجعة",
  "تم إرسال منشورك إلى مسؤولي المجموعة",
  "تم ارسال منشورك الى مسؤولي المجموعة",
  "تم إرسال منشورك إلى المشرفين",
  "تم ارسال منشورك الى المشرفين",
  "سيتم نشر منشورك بعد موافقة المسؤولين",
  "يحتاج منشورك إلى موافقة",
  "يحتاج منشورك الى موافقة",
];

const SEMANTIC_SURFACE_SELECTOR = [
  '[role="alert"]',
  '[role="status"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[role="article"]',
  '[data-pagelet*="FeedUnit"]',
].join(",");

let lastLoggedEvidence: string | null = null;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    // Remove Arabic diacritics and tatweel so equivalent UI text matches.
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function getSurfaceText(element: Element): string {
  const text = element.textContent ?? "";
  const label = element.getAttribute("aria-label") ?? "";
  const title = element.getAttribute("title") ?? "";
  return normalizeText(`${text} ${label} ${title}`);
}

/**
 * Detect a positive Facebook approval signal from visible semantic surfaces.
 *
 * The default document scan is deliberately limited to alerts, statuses, and
 * modal/dialog surfaces so unrelated feed text cannot mark a submission as
 * pending. Callers can pass a specific post-submission container when one is
 * available.
 */
function detectPendingApprovalMessage(
  root: ParentNode = document,
): PendingApprovalDetectionResult {
  const surfaces: Element[] = [];

  if (root instanceof Element) surfaces.push(root);
  surfaces.push(...Array.from(root.querySelectorAll(SEMANTIC_SURFACE_SELECTOR)));

  const seen = new Set<Element>();
  for (const surface of surfaces) {
    if (seen.has(surface) || !isVisible(surface)) continue;
    seen.add(surface);

    const text = getSurfaceText(surface);
    const phrase = APPROVAL_PHRASES.find((candidate) => text.includes(normalizeText(candidate)));
    if (phrase) {
      if (lastLoggedEvidence !== phrase) {
        console.log("[PostTracking] Pending approval detected", { evidence: phrase });
        lastLoggedEvidence = phrase;
      }
      return { detected: true, evidence: phrase, surface };
    }
  }

  lastLoggedEvidence = null;
  return { detected: false };
}

const PHONE_CANDIDATE_PATTERN = /(^|[^\p{L}\p{N}])((?:\+|00)?\p{Nd}(?:[\p{Nd} \t\u00a0()./-]{4,}\p{Nd}))(?![\p{L}\p{N}])/gu;
const PHONE_ATTRIBUTE_NAMES = [
  "aria-label",
  "title",
  "data-phone",
  "data-telephone",
  "data-mobile",
];
const PHONE_ATTRIBUTE_SELECTOR = [
  "a[href]",
  "[aria-label]",
  "[title]",
  "[data-phone]",
  "[data-telephone]",
  "[data-mobile]",
  '[itemprop~="telephone"]',
].join(",");

let phoneCandidateFallbackSequence = 0;

// Collects raw phone candidates from already-rendered text, links, and semantic attributes.
function extractPhoneCandidates(doc: Document = document): PhoneCollectionCandidate[] {
  if (!doc.body) return [];

  const candidates = extractPhoneCandidatesFromText(doc.body.innerText ?? "", "visible-text");

  for (const element of Array.from(doc.querySelectorAll(PHONE_ATTRIBUTE_SELECTOR))) {
    if (!isPhoneCandidateElementVisible(element)) continue;

    if (element.matches("a[href]")) {
      const href = element.getAttribute("href")?.trim() ?? "";
      if (/^tel:/i.test(href)) {
        let telephone = href.slice(4).split(";", 1)[0].split("?", 1)[0];
        try {
          telephone = decodeURIComponent(telephone);
        } catch {
          // Keep the original URI value if it contains invalid percent escapes.
        }
        candidates.push(...extractPhoneCandidatesFromText(telephone, "tel-link"));
      }
    }

    for (const name of PHONE_ATTRIBUTE_NAMES) {
      const value = element.getAttribute(name);
      if (value) candidates.push(...extractPhoneCandidatesFromText(value, "attribute"));
    }

    if (element.matches('[itemprop~="telephone"]')) {
      const value = element.getAttribute("content");
      if (value) candidates.push(...extractPhoneCandidatesFromText(value, "attribute"));
    }
  }

  return candidates;
}

// Finds phone-shaped substrings and records where each candidate came from.
function extractPhoneCandidatesFromText(
  text: string,
  origin: PhoneCandidateOrigin,
): PhoneCollectionCandidate[] {
  const candidates: PhoneCollectionCandidate[] = [];
  PHONE_CANDIDATE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PHONE_CANDIDATE_PATTERN.exec(text)) !== null) {
    const raw = match[2].trim();
    const digitCount = raw.match(/\p{Nd}/gu)?.length ?? 0;
    if (digitCount < 7 || digitCount > 15) continue;

    candidates.push({
      id: createPhoneCandidateId(),
      raw,
      origin,
    });
  }

  return candidates;
}

// Ignores elements hidden directly or through one of their ancestors.
function isPhoneCandidateElementVisible(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
    ) {
      return false;
    }

    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style &&
      (style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.getPropertyValue("content-visibility") === "hidden" ||
        (style.opacity !== "" && Number(style.opacity) === 0))
    ) {
      return false;
    }

    current = current.parentElement;
  }
  return true;
}

// Creates a non-sensitive identifier for linking a candidate to its review row.
function createPhoneCandidateId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `phone-${uuid}`;

  phoneCandidateFallbackSequence += 1;
  return `phone-${Date.now().toString(36)}-${phoneCandidateFallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

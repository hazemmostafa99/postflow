// Describes the page that produced the phone candidates.
function getPhoneCollectionSource(): PhoneCollectionSource {
  const hostname = location.hostname.toLowerCase();
  const isFacebook = hostname === "facebook.com" || hostname.endsWith(".facebook.com");
  return {
    type: isFacebook ? "facebook" : "generic",
    url: location.href,
    title: document.title,
  };
}

// Extracts and normalizes numbers in the page context without sending them to a backend.
function collectPhoneNumbersForCurrentPage(): PhoneCollectionResponse {
  const candidates = extractPhoneCandidates(document);
  const normalized = normalizeAndDeduplicatePhoneCandidates(candidates);
  return {
    ok: true,
    source: getPhoneCollectionSource(),
    candidates,
    numbers: normalized.numbers,
    summary: normalized.summary,
  };
}

// Answers readiness and collection requests without persisting or logging page numbers.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PHONE_COLLECTOR_PING") {
    sendResponse({ ok: true, collectorReady: true });
    return;
  }

  if (message?.type !== "PHONE_COLLECTOR_COLLECT") return;

  try {
    sendResponse(collectPhoneNumbersForCurrentPage());
  } catch {
    sendResponse({
      ok: false,
      code: "COLLECTION_FAILED",
      error: "Could not scan this page. Try again after it finishes loading.",
    });
  }
});

// ── Constants ──

const EXCLUDED_SLUGS = new Set([
  "feed", "discover", "create", "joins",
  "requests", "questions", "members",
  "media", "events", "files", "search", "about",
]);

// Facebook UI button texts that are NOT group names (Arabic + English)
const EXCLUDED_NAMES = new Set([
  // Arabic
  "عرض المجموعة",
  "انضم إلى المجموعة",
  "الانضمام",
  "انضم",
  "متابعة",
  "إلغاء المتابعة",
  "إعداداتي",
  "مشاركة",
  "المزيد",
  "أعجبني",
  "تعرف على المزيد عن هذه المجموعة",
  "تعرف على المزيد",
  "حول هذه المجموعة",
  // English
  "View Group",
  "View group",
  "Join Group",
  "Join group",
  "Join",
  "Follow",
  "Unfollow",
  "Like",
  "Share",
  "More",
  "My settings",
  "Invite",
  "Joined",
  "Learn more about this group",
  "About this group",
]);

const EXCLUDED_NAME_SUBSTRINGS = [
  "تعرف على المزيد",
  "learn more about this group",
  "about this group",
];

// ── State ──

const POSTING_TIMING = (globalThis as { PostFlowPostingTiming?: PostFlowPostingTimingConfig }).PostFlowPostingTiming!;

type PostingLogDetails = Record<string, string | number | boolean | null | undefined>;

function recordPostingStep(jobId: string, step: string, details: PostingLogDetails = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    jobId,
    step,
    url: location.href,
    details,
  };
  console.log(`[PostFlow][${jobId}][${step}]`, details);
  try {
    chrome.runtime.sendMessage({ type: 'POSTING_LOG', entry }).catch(() => undefined);
  } catch {
    // The page can be unloading while Facebook navigates.
  }
}
const groups = new Map<string, FacebookGroup>();
let lastSentSignature = "";
let isExecutingJob = false;
let activeJobId: string | null = null;

// ── Cleanup registry ──

let mutationObserver: MutationObserver | null = null;
let port: chrome.runtime.Port | null = null;

function cleanup() {
  mutationObserver?.disconnect();
  mutationObserver = null;

  console.log("[PostFlow] Cleaned up");
}

// ── Port connection ──

function connect() {
  try {
    port = chrome.runtime.connect({ name: "postflow-content" });
  } catch {
    // Extension not available
    return;
  }

  port.onDisconnect.addListener(() => {
    // Extension was reloaded or updated — stop everything
    port = null;
    cleanup();
  });

  console.log("[PostFlow] Connected to background");
}

function sendGroups() {
  if (!port) return;

  const groupList = Array.from(groups.values());
  const signature = groupList.map((g) => `${g.id}:${g.name}`).join("|");

  if (signature === lastSentSignature) return;

  lastSentSignature = signature;

  try {
    port.postMessage({
      type: "GROUPS_DETECTED",
      groups: groupList,
    });
  } catch {
    // Port disconnected before onDisconnect fired (async timing gap)
    port = null;
    cleanup();
    return;
  }

  console.log(`[PostFlow] Sent ${groupList.length} groups`);
}

// ── URL helpers ──

function extractGroupId(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    // Strip trailing slash before matching to avoid "joins/" not matching "joins"
    const path = url.pathname.replace(/\/$/, "");
    const match = path.match(/^\/groups\/([^/?#]+)/);
    if (!match) return null;
    const slug = match[1];
    return EXCLUDED_SLUGS.has(slug) ? null : slug;
  } catch {
    return null;
  }
}

function canonicalizeGroupUrl(id: string): string {
  return `https://www.facebook.com/groups/${id}/`;
}

// ── Strategy 1: DOM extraction (aria-label first) ──

function isValidName(text: string): boolean {
  if (!text || text.length < 2 || text.length > 150) return false;
  if (EXCLUDED_NAMES.has(text)) return false;
  const lower = text.toLowerCase();
  return !EXCLUDED_NAME_SUBSTRINGS.some((s) => lower.includes(s.toLowerCase()));
}

function extractNameFromLink(link: HTMLAnchorElement): string | null {
  // 1. aria-label on the link itself — most reliable on Facebook
  const ariaLabel = link.getAttribute("aria-label")?.trim();
  if (ariaLabel && isValidName(ariaLabel)) {
    return ariaLabel;
  }

  // 2. innerText of the link — works for sidebar and card titles
  const text = link.innerText.trim();
  if (text && isValidName(text)) {
    return text;
  }

  // 3. aria-label on nearest parent (up to 5 levels)
  let parent = link.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    const parentAria = parent.getAttribute("aria-label")?.trim();
    if (parentAria && isValidName(parentAria)) {
      return parentAria;
    }
    parent = parent.parentElement;
    depth++;
  }

  return null;
}

function extractGroupFromLink(link: HTMLAnchorElement): FacebookGroup | null {
  const id = extractGroupId(link.href);
  if (!id) return null;

  const name = extractNameFromLink(link);
  if (!name) return null;

  // If the slug is all digits, it IS the numeric ID
  const numericId = /^\d+$/.test(id) ? id : undefined;

  return { id, numericId, name, url: canonicalizeGroupUrl(id) };
}

function addGroup(group: FacebookGroup): boolean {
  if (!isValidName(group.name)) return false;

  const existing = groups.get(group.id);
  const url = canonicalizeGroupUrl(group.id);

  if (!existing) {
    groups.set(group.id, { ...group, url });
    console.log("[PostFlow] Group:", group.name);
    return true;
  }

  // Keep the first trusted name. Opening a group page to publish should not rename it.
  const updatedNumericId = group.numericId ?? existing.numericId;
  const hasChanges =
    existing.url !== url ||
    existing.numericId !== updatedNumericId;

  if (hasChanges) {
    groups.set(group.id, {
      ...existing,
      ...group,
      name: existing.name,
      url,
      numericId: updatedNumericId,
    });
    return true;
  }

  return false;
}

function scanDOM(root: ParentNode = document): boolean {
  if (isExecutingJob) return false;
  let changed = false;
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]');

  for (const link of links) {
    const group = extractGroupFromLink(link);
    if (group && addGroup(group)) {
      changed = true;
    }
  }

  return changed;
}

// ── Scan scheduling ──

function scheduleScan() {
  if (!port) return;
  const changed = scanDOM();
  if (changed) sendGroups();
}

// ── Strategy 2: GraphQL interception (passive spy removed) ──
// The GraphQL spy is no longer injected automatically.
// It was causing group names to be overwritten from Facebook's API calls
// whenever the extension opened a group page to execute a post.
// Manual sync uses fetchAllGroupsFromGraphQL() directly instead.

// ── Strategy 3: Active GraphQL fetch (gets ALL groups the user is a member of) ──
// Facebook exposes the user's groups via the same GraphQL API the app uses.
// We call it directly using the session cookies already in the browser.

async function fetchAllGroupsFromGraphQL(): Promise<void> {
  // Grab the __dtsg token Facebook requires on every API call (anti-CSRF)
  let dtsg = '';
  try {
    // Facebook stores it in a meta tag or in the page's __d("DTSGInitData",...) call
    const metaDtsg = document.querySelector<HTMLInputElement>('input[name="fb_dtsg"]');
    if (metaDtsg) {
      dtsg = metaDtsg.value;
    } else {
      // Parse from inline script
      const regexes = [
        /"token":"(AQIA[^"]+)"/,
        /"(?:fb_dtsg|token)"\s*:\s*"([^"]+)"/,
        /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
        /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
      ];
      for (const rx of regexes) {
        const match = document.documentElement.innerHTML.match(rx);
        if (match) {
          dtsg = match[1];
          break;
        }
      }
    }
  } catch {
    // dtsg may not be available — Facebook will reject the request without it
  }

  if (!dtsg) {
    console.warn('[PostFlow] Could not find fb_dtsg token — skipping active GraphQL fetch');
    return;
  }

  let cursor: string | null = null;
  let pagesFetched = 0;
  let totalGroupsFetched = 0;
  const MAX_PAGES = 30; // safety limit (30 pages × ~10 groups = up to 300 groups)

  do {
    try {
      const variables: Record<string, unknown> = {
        count: 10,
        ...(cursor ? { cursor } : {}),
      };

      const body = new URLSearchParams({
        doc_id: '7049871405048867', // Facebook's "GroupsTab" doc_id for group memberships
        variables: JSON.stringify(variables),
        fb_dtsg: dtsg,
      });

      const res = await fetch('https://www.facebook.com/api/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'include',
      });

      if (!res.ok) break;

      const text = await res.text();
      collectGroupsFromGraphQLText(text);
      const lines = text.split('\n');
      let hasMore = false;
      cursor = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const data = JSON.parse(trimmed);
          
          // Count how many groups are in this page's response
          // (rough count by looking for the __typename === 'Group')
          const countGroups = (obj: any): number => {
            if (typeof obj !== 'object' || obj === null) return 0;
            let c = 0;
            if (obj.__typename === 'Group' && obj.name) c = 1;
            for (const val of Object.values(obj)) {
              c += countGroups(val);
            }
            return c;
          };
          totalGroupsFetched += countGroups(data);

          // Look for pagination info
          const pageInfo = findPageInfo(data);
          if (pageInfo) {
            hasMore = pageInfo.has_next_page ?? false;
            cursor = pageInfo.end_cursor ?? null;
          }
        } catch { /* skip */ }
      }

      window.dispatchEvent(new CustomEvent('postflow:graphql-text', { detail: text }));

      pagesFetched++;
      if (!hasMore || !cursor) break;

      await sleep(POSTING_TIMING.groupSyncPageDelayMs);
    } catch (err) {
      console.warn('[PostFlow] Active GraphQL fetch error:', err);
      break;
    }
  } while (pagesFetched < MAX_PAGES);

  console.log(`[PostFlow] Active GraphQL fetch complete: ${pagesFetched} page(s), ~${totalGroupsFetched} groups found`);
}

/** Recursively search for a GraphQL PageInfo node anywhere in the tree */
function findPageInfo(obj: unknown, depth = 0): { has_next_page?: boolean; end_cursor?: string } | null {
  if (depth > 20 || obj === null || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  
  // Facebook pagination object usually has has_next_page and end_cursor
  if (record.has_next_page !== undefined || record.end_cursor !== undefined) {
    // If it has BOTH or at least one, it's likely the right object
    if (typeof record.has_next_page === 'boolean' || typeof record.end_cursor === 'string') {
      return record as { has_next_page?: boolean; end_cursor?: string };
    }
  }
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findPageInfo(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(record)) {
    const val = record[key];
    if (typeof val === 'object' && val !== null) {
      const found = findPageInfo(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Extract Group nodes from an active GraphQL response and send them to the background. */
function collectGroupsFromGraphQLText(text: string): void {
  const findGroups = (value: unknown, depth = 0): FacebookGroup[] => {
    if (depth > 20 || value === null || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap((item) => findGroups(item, depth + 1));
    }

    const record = value as Record<string, unknown>;
    const found: FacebookGroup[] = [];
    if (record.__typename === 'Group' && typeof record.name === 'string' && record.name.trim()) {
      const numericId = typeof record.id === 'string' && /^\d+$/.test(record.id) ? record.id : undefined;
      const rawUrl = typeof record.url === 'string'
        ? record.url
        : typeof record.group_url === 'string'
          ? record.group_url
          : '';
      let id = rawUrl ? extractGroupId(rawUrl) : null;
      if (!id && typeof record.vanity === 'string' && record.vanity) id = record.vanity;
      if (!id && numericId) id = numericId;
      if (id && !EXCLUDED_SLUGS.has(id) && isValidName(record.name)) {
        found.push({ id, numericId, name: record.name, url: canonicalizeGroupUrl(id) });
        return found;
      }
    }

    for (const child of Object.values(record)) {
      found.push(...findGroups(child, depth + 1));
    }
    return found;
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const groupsFromLine = findGroups(JSON.parse(trimmed));
      let changed = false;
      for (const group of groupsFromLine) changed = addGroup(group) || changed;
      if (changed) sendGroups();
    } catch {
      // Facebook may include non-JSON lines in the response stream.
    }
  }
}

// ── Init ──

function initialize() {
  console.log("[PostFlow] Group collector started — manual sync only");

  connect();

  // Do NOT auto-scan and do NOT inject the GraphQL spy.
  // Groups are only synced when the user explicitly clicks
  // "Sync with Extension" in the PostFlow web app, which triggers SCAN_NOW.
}

initialize();

// Tell the background script that this content script is fully loaded and ready.
// The background listens for this before sending EXECUTE_JOB.
try {
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
} catch {
  // Silently ignore if context is already gone (e.g. during hot reload)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCAN_NOW') {
    console.log('[PostFlow] Manual scan triggered by Web App');
    void (async () => {
      try {
        scheduleScan();
        await fetchAllGroupsFromGraphQL();
        scheduleScan();
        sendResponse({ ok: true, groupsDetected: groups.size });
      } catch (err: any) {
        console.error(err);
        sendResponse({ ok: false, error: err?.message ?? 'Facebook group sync failed' });
      }
    })();
    return true;
  }

  if (message.type === 'EXECUTE_JOB') {
    if (isExecutingJob && activeJobId === message.jobId) {
      console.warn('[PostFlow] Ignoring duplicate EXECUTE_JOB for active job:', message.jobId);
      recordPostingStep(message.jobId, 'duplicate_job_ignored');
      return;
    }
    if (isExecutingJob) {
      console.warn('[PostFlow] Ignoring EXECUTE_JOB while another job is active:', activeJobId);
      return;
    }
    console.log('[PostFlow] Received job to execute:', message);
    recordPostingStep(message.jobId, 'job_received', {
      hasContent: Boolean(message.post?.content),
      mediaCount: Array.isArray(message.post?.mediaUrls) ? message.post.mediaUrls.length : 0,
    });
    activeJobId = message.jobId;
    executeFacebookPost(message.jobId, message.post)
      .then(() => {
        // We actually use chrome.runtime.sendMessage to communicate status
        // because the tab might navigate or reload, but the background script listens for it.
        chrome.runtime.sendMessage({ type: 'JOB_SUCCESS', jobId: message.jobId, postId: message.post?._id });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({ type: 'JOB_FAILED', jobId: message.jobId, postId: message.post?._id, error: err.message });
      });
  }
});

// ── Job Execution (DOM Manipulation) ──

async function executeFacebookPost(jobId: string, post: any) {
  return new Promise<void>(async (resolve, reject) => {
    isExecutingJob = true;
    try {
      console.log(`[PostFlow] Starting job ${jobId}`);
      const mediaUrls = Array.isArray(post.mediaUrls) ? post.mediaUrls.filter((url: unknown) => typeof url === 'string') : [];
      const hasMedia = mediaUrls.length > 0;
      recordPostingStep(jobId, 'job_started', { hasContent: Boolean(post.content), mediaCount: mediaUrls.length });

      // 1. Find the "Write something…" composer trigger on the group page.

      await waitForCondition(
        () => {
          const main = document.querySelector('[role="main"]');
          const inline = document.querySelector('[data-pagelet="GroupInlineComposer"]');
          if (!main && !inline) return false;
          return !!document.querySelector(
            '[data-pagelet="GroupInlineComposer"] [role="button"], ' +
            '[data-pagelet="GroupInlineComposer"] button, ' +
            '[aria-label*="Create a post" i], ' +
            '[aria-label*="Write something" i], ' +
            '[aria-placeholder*="Write something" i]'
          );
        },
        POSTING_TIMING.groupPageReadyTimeoutMs,
      );
      recordPostingStep(jobId, 'group_composer_surface_ready', {
        hasMain: Boolean(document.querySelector('[role="main"]')),
        hasInlineComposer: Boolean(document.querySelector('[data-pagelet="GroupInlineComposer"]')),
      });

      // Facebook places the composer in `data-pagelet="GroupInlineComposer"`
      // which is often a SIBLING to the actual feed (`data-pagelet="GroupFeed"`).
      // We must search a broader container like `role="main"` to ensure we see both.
      const searchRoot: Element =
        document.querySelector('[role="main"]') ??
        document.body;

      console.log('[PostFlow] Search root found:', searchRoot.tagName, searchRoot.getAttribute('role'));

      let composerTrigger: HTMLElement | null = null;

      // Method 0: The most direct and reliable Facebook selector (GroupInlineComposer)
      const inlineComposer = document.querySelector('[data-pagelet="GroupInlineComposer"]');
      if (inlineComposer) {
        // Find the first button inside it
        const btn = inlineComposer.querySelector<HTMLElement>('[role="button"], button, [tabindex="0"]');
        if (btn) {
          composerTrigger = btn;
          console.log('[PostFlow] Found composer via GroupInlineComposer data-pagelet');
        }
      }

      // Known placeholder texts Facebook uses in the composer trigger span
      const COMPOSER_TEXTS = [
        'اكتب شيئًا',   // Arabic (exact prefix from real FB HTML)
        'اكتب شيئ',     // Arabic variant without diacritics
        'ما الذي يدور', // Arabic "what's on your mind"
        'write something',
        "what's on your mind",
        'create a post',
        'écrivez quelque chose',
        'was möchtest du',
      ];

      /** True if `el` is nested inside a post card (role="article").
       *  The real composer trigger is ABOVE all posts, never inside one. */
      function isInsideArticle(el: HTMLElement): boolean {
        let cur: HTMLElement | null = el.parentElement;
        while (cur && cur !== searchRoot) {
          if (cur.getAttribute('role') === 'article') return true;
          cur = cur.parentElement;
        }
        return false;
      }

      function textMatchesComposer(el: HTMLElement): boolean {
        const text = (el.textContent ?? '').trim();
        if (text.length < 2 || text.length > 120) return false;
        const lower = text.toLowerCase();
        return COMPOSER_TEXTS.some(t => lower.includes(t.toLowerCase()));
      }

      // Method A: Find a span with the placeholder text, then walk UP to its
      // closest role="button" parent — this is exactly what Facebook renders.
      // Skip any span that lives inside a post card (role="article").
      const allSpans = Array.from(searchRoot.querySelectorAll<HTMLElement>('span'));
      for (const span of allSpans) {
        if (textMatchesComposer(span) && !isInsideArticle(span)) {
          // Walk up to find the clickable role="button" ancestor
          let el: HTMLElement | null = span;
          while (el && el !== searchRoot) {
            if (el.getAttribute('role') === 'button') {
              composerTrigger = el;
              console.log('[PostFlow] Found composer via span→button walk:', span.textContent?.trim().substring(0, 40));
              break;
            }
            el = el.parentElement;
          }
          if (composerTrigger) break;
        }
      }

      // Method B: aria-placeholder / aria-label on the element itself
      if (!composerTrigger) {
        const candidate = searchRoot.querySelector<HTMLElement>(
          '[aria-placeholder], [aria-label*="Create" i], [aria-label*="Write" i]' /* +
          '[aria-label*="What\\'s on your mind" i], [aria-label*="اكتب"]'
        */
        );
        if (candidate && !isInsideArticle(candidate)) {
          composerTrigger = candidate;
          console.log('[PostFlow] Found composer via aria attribute:', composerTrigger.getAttribute('aria-placeholder') ?? composerTrigger.getAttribute('aria-label'));
        }
      }

      // Method C: Last resort — any role="button" whose textContent matches,
      // but NOT inside a post article.
      if (!composerTrigger) {
        const roleButtons = Array.from(searchRoot.querySelectorAll<HTMLElement>('div[role="button"]'));
        for (const btn of roleButtons) {
          if (textMatchesComposer(btn) && !isInsideArticle(btn)) {
            composerTrigger = btn;
            console.log('[PostFlow] Found composer via role=button text match:', btn.textContent?.trim().substring(0, 40));
            break;
          }
        }
      }

      if (!composerTrigger) {
        throw new Error(
          'Could not find the post composer on this group page. ' +
          'Make sure you are on a Facebook group page and the page has loaded.'
        );
      }

      recordPostingStep(jobId, 'composer_trigger_found', {
        tag: composerTrigger.tagName,
        role: composerTrigger.getAttribute('role'),
        label: composerTrigger.getAttribute('aria-label'),
        text: composerTrigger.textContent?.trim().slice(0, 80),
      });

      console.log('[PostFlow] Clicking composer trigger:', composerTrigger.getAttribute('aria-label') ?? composerTrigger.textContent?.substring(0, 40));
      clickLikeUser(composerTrigger);
      await sleep(POSTING_TIMING.composerOpenDelayMs);
      recordPostingStep(jobId, 'composer_trigger_clicked', {
        dialogs: document.querySelectorAll('div[role="dialog"], [aria-modal="true"]').length,
      });

      // Facebook sometimes shows an intermediate "What do you want to create?" modal
      // with options: Post, Photo/Video, etc. We need to click "Post/Text" in that case.
      // Use .includes() not === because FB adds extra text like "منشور مجهول الهوية"
      const interimDialog = document.querySelector<HTMLElement>('div[role="dialog"], [aria-modal="true"]');
      if (interimDialog && !interimDialog.querySelector('[contenteditable="true"], [role="textbox"], textarea')) {
        recordPostingStep(jobId, 'intermediate_dialog_detected', {
          text: interimDialog.innerText?.trim().slice(0, 120),
        });
        console.log('[PostFlow] Intermediate modal detected, looking for Text/Post option...');
        const optionButtons = Array.from(interimDialog.querySelectorAll<HTMLElement>('[role="button"], button, [tabindex="0"]'));
        const textOption = optionButtons.find(el => {
          const txt   = (el.textContent ?? '').trim().toLowerCase();
          const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase();
          const combined = txt + ' ' + label;
          // Match any button whose text/label contains a known "post" keyword
          return ['post', 'منشور', 'text', 'نص', 'write'].some(kw => combined.includes(kw));
        });
        if (textOption) {
          console.log('[PostFlow] Clicking Post/Text option in intermediate modal:', textOption.textContent?.trim().substring(0, 30));
          textOption.click();
          await sleep(POSTING_TIMING.intermediateComposerOptionDelayMs);
          recordPostingStep(jobId, 'intermediate_post_option_clicked', {
            text: textOption.textContent?.trim().slice(0, 80),
          });
        } else {
          console.warn('[PostFlow] Could not find Post/Text button in intermediate modal — proceeding anyway');
          recordPostingStep(jobId, 'intermediate_post_option_missing');
        }
      }

      // 2. Wait for the actual editor. Facebook has used both a modal dialog and
      // an inline composer for this flow. Do not require role="dialog": the
      // GroupInlineComposer markup in some locales stays on the group page.
      console.log('[PostFlow] Waiting for create-post editor...');
      let dialog = await waitForCreatePostDialog(POSTING_TIMING.createPostDialogTimeoutMs);
      if (!dialog) {
        console.warn('[PostFlow] Create-post editor not found after first click; retrying composer trigger once');
        recordPostingStep(jobId, 'editor_surface_retrying_click');
        clickLikeUser(composerTrigger);
        await sleep(POSTING_TIMING.composerOpenDelayMs);
        dialog = await waitForCreatePostDialog(Math.floor(POSTING_TIMING.createPostDialogTimeoutMs / 2));
      }

      if (!dialog) {
        throw new Error(`Facebook create-post editor did not appear within ${Math.round(POSTING_TIMING.createPostDialogTimeoutMs / 1000)}s`);
      }
      recordPostingStep(jobId, 'editor_surface_found', {
        isDialog: dialog.getAttribute('role') === 'dialog' || dialog.getAttribute('aria-modal') === 'true',
        contenteditables: dialog.querySelectorAll('[contenteditable="true"]').length,
      });
      console.log('[PostFlow] Create Post dialog found');

      // The editor is the contenteditable we already confirmed exists in the dialog
      const editorSelectors = [
        'div[data-lexical-editor="true"]',
        'div[role="textbox"][contenteditable="true"]',
        '[role="textbox"]',
        'div[contenteditable="true"][tabindex="0"]',
        'div[contenteditable="true"]',
        'textarea',
      ];

      let editor: Element | null = null;
      for (const sel of editorSelectors) {
        editor = dialog.querySelector(sel);
        if (editor) {
          console.log('[PostFlow] Found editor inside dialog with selector:', sel);
          break;
        }
      }

      if (!editor) {
        throw new Error('Could not find the text editor inside the Create Post dialog');
      }

      recordPostingStep(jobId, 'editor_found', {
        selector: editor.getAttribute('data-lexical-editor') === 'true' ? 'data-lexical-editor' : editor.tagName,
        role: editor.getAttribute('role'),
      });

      console.log('[PostFlow] Focusing editor and injecting text...');
      const editorEl = editor as HTMLElement;

      // Step 1: Bring editor into view and give it user-like focus
      editorEl.scrollIntoView({ behavior: 'auto', block: 'center' });
      await sleep(POSTING_TIMING.editorScrollDelayMs);
      editorEl.focus();
      await sleep(POSTING_TIMING.editorFocusDelayMs);
      // Dispatch a real mousedown+mouseup to convince Lexical we interacted
      editorEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      editorEl.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
      editorEl.click();
      await sleep(POSTING_TIMING.editorClickDelayMs);

      // Step 2: Place the text cursor at the END of the editor content
      //         execCommand('insertText') only works when a Selection exists inside the element.
      const placeCaret = () => {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          // Select all content and collapse to end so we start fresh
          range.selectNodeContents(editorEl);
          range.collapse(false); // false = collapse to end
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch {
          // Ignore if selection can't be set (e.g. inside shadow DOM)
        }
      };
      placeCaret();
      await sleep(POSTING_TIMING.editorCaretDelayMs);

      // Step 3a: execCommand — fires the correct synthetic InputEvent that Lexical handles
      let execResult = document.execCommand('insertText', false, post.content);
      console.log('[PostFlow] execCommand insertText result:', execResult);
      await sleep(POSTING_TIMING.textInsertDelayMs);

      const textAfterExec = editorEl.textContent ?? '';
      console.log('[PostFlow] Editor text after execCommand:', textAfterExec.substring(0, 50));
      recordPostingStep(jobId, 'text_insert_attempted', {
        execResult,
        textLength: textAfterExec.length,
      });

      if (!textAfterExec.trim()) {
        console.log('[PostFlow] execCommand did not work, trying keyboard simulation...');

        // Step 3b: Keyboard simulation — type character by character
        // This is guaranteed to work with React/Lexical because it mirrors real user input.
        placeCaret();
        await sleep(POSTING_TIMING.editorCaretDelayMs);

        for (const char of post.content) {
          editorEl.dispatchEvent(new KeyboardEvent('keydown',  { key: char, bubbles: true }));
          // beforeinput is what Lexical actually listens to
          editorEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char,
          }));
          editorEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char,
          }));
          editorEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        await sleep(POSTING_TIMING.keyboardFallbackDelayMs);
        console.log('[PostFlow] Editor text after keyboard sim:', (editorEl.textContent ?? '').substring(0, 50));
        recordPostingStep(jobId, 'keyboard_fallback_finished', { textLength: (editorEl.textContent ?? '').length });
      }

      if (!(editorEl.textContent ?? '').trim() && !hasMedia) {
        throw new Error('Failed to inject text into Facebook composer — all strategies failed');
      }

      if (hasMedia) {
        recordPostingStep(jobId, 'media_attach_started', { mediaCount: mediaUrls.length });
        await attachMediaToDialog(dialog, mediaUrls);
        recordPostingStep(jobId, 'media_attach_finished', { mediaCount: mediaUrls.length });
      }

      console.log('[PostFlow] Text injected successfully, waiting for Post button to enable...');

      // 3. Find the Post / Submit button — search inside the dialog we already found
      const dialogSearchRoot = dialog;

      // Try multiple labels since Facebook localizes these strings
      const postButtonSelectors = [
        '[aria-label="Post"]',
        '[aria-label="نشر"]',       // Arabic
        '[aria-label="Publier"]',   // French
        '[aria-label="Postar"]',    // Portuguese
        'div[role="button"][tabindex="0"]',
      ];

      const findPostButton = () => {
        for (const sel of postButtonSelectors) {
          const candidates = Array.from(dialogSearchRoot.querySelectorAll(sel));
          const enabled = candidates.find(el =>
            el.getAttribute('aria-disabled') !== 'true' &&
            el.textContent &&
            el.textContent.trim().length > 0 &&
            el.textContent.trim().length < 20
          );
          if (enabled) {
            console.log('[PostFlow] Found post button with selector:', sel, 'text:', enabled.textContent?.trim());
            return enabled;
          }
        }
        return null;
      };

      const postButton = await waitForValue(findPostButton, POSTING_TIMING.postButtonEnableTimeoutMs);

      if (!postButton) {
        throw new Error('Could not find the Post button — the text may not have registered in the editor');
      }

      recordPostingStep(jobId, 'post_button_found', {
        text: postButton.textContent?.trim().slice(0, 80),
        ariaLabel: postButton.getAttribute('aria-label'),
      });

      (postButton as HTMLElement).click();
      console.log('[PostFlow] Post button clicked, waiting for publish confirmation...');
      recordPostingStep(jobId, 'post_button_clicked');

      // 4. Wait for Facebook to reject or accept the click. Facebook often
      // publishes successfully while keeping a dialog/toast surface mounted.
      const publishSuccessCues = [
        'your post is now published',
        'your post has been published',
        'post published',
        'published',
        'تم نشر',
        'تم نشر منشورك',
      ];

      const publishErrorCues = [
        'something went wrong',
        "couldn't post",
        'could not post',
        'unable to post',
        'failed to publish',
        'post could not be shared',
        'try again later',
        'حدث خطأ',
        'تعذر النشر',
        'فشل النشر',
      ];

      const hasCue = (texts: string[], source: string) => {
        const lower = source.toLowerCase();
        return texts.some((text) => lower.includes(text.toLowerCase()));
      };

      const publishStartedAt = Date.now();
      while (Date.now() - publishStartedAt < POSTING_TIMING.publishConfirmationTimeoutMs) {
        await sleep(POSTING_TIMING.publishPollIntervalMs);

        const dialogStillOpen = document.body.contains(dialog);
        const editorStillOpen = dialogStillOpen && dialog.querySelector('div[contenteditable="true"]');
        const buttonStillEnabled = dialogStillOpen && findPostButton();
        const pageText = (document.body.innerText ?? '').toLowerCase();
        const hasPublishCue = hasCue(publishSuccessCues, pageText) || [
          'your post is now published',
          'your post has been published',
          'post published',
          'تم نشر',
          'تم نشر منشورك',
        ].some((text) => pageText.includes(text.toLowerCase()));
        const dialogText = dialogStillOpen ? ((dialog as HTMLElement).innerText ?? '') : '';
        const hasPublishError = hasCue(publishErrorCues, `${dialogText}\n${pageText}`);

        if (hasPublishError) {
          recordPostingStep(jobId, 'publish_error_detected', { text: `${dialogText}\n${pageText}`.slice(0, 300) });
          throw new Error('Facebook rejected the post after clicking Post');
        }

        if (!dialogStillOpen || hasPublishCue || (!editorStillOpen && !buttonStillEnabled)) {
          console.log('[PostFlow] Publish accepted — post successful!');
          recordPostingStep(jobId, 'publish_confirmed', { hasPublishCue, dialogStillOpen });
          resolve();
          return;
        }
      }

      console.log('[PostFlow] No Facebook error after clicking Post - treating publish as accepted');
      recordPostingStep(jobId, 'publish_confirmation_timeout_accepted');
      resolve();
      return;

    } catch (err: any) {
      recordPostingStep(jobId, 'job_failed_in_content_script', { error: err?.message ?? String(err) });
      reject(err);
    } finally {
      isExecutingJob = false;
      activeJobId = null;
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function clickLikeUser(element: HTMLElement) {
  element.scrollIntoView({ behavior: 'auto', block: 'center' });
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.click();
}

function dataUrlToFile(dataUrl: string, index: number): File {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!match) {
    throw new Error('Unsupported media format');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  return new File([bytes], `postflow-media-${index + 1}.${extension}`, { type: mimeType });
}

async function attachMediaToDialog(dialog: Element, mediaUrls: string[]) {
  console.log(`[PostFlow] Attaching ${mediaUrls.length} media file(s)`);

  const mediaFiles = mediaUrls.map((url, index) => dataUrlToFile(url, index));
  const transfer = new DataTransfer();
  mediaFiles.forEach((file) => transfer.items.add(file));

  const findDialogFileInput = () => {
    const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    return inputs.find((candidate) => {
      const accept = (candidate.getAttribute('accept') ?? '').toLowerCase();
      return !accept || accept.includes('image') || accept.includes('video') || accept.includes('*');
    }) ?? null;
  };

  const findAnyFileInput = () => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    return inputs.find((candidate) => {
      const accept = (candidate.getAttribute('accept') ?? '').toLowerCase();
      return !accept || accept.includes('image') || accept.includes('video') || accept.includes('*');
    }) ?? null;
  };

  let input = findDialogFileInput();
  if (!input) {
    const mediaButton = Array.from(dialog.querySelectorAll<HTMLElement>('[role="button"], button')).find((el) => {
      const combined = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
      return [
        'photo/video',
        'photo',
        'image',
        'add photos',
        'add photo',
        'صورة',
        'فيديو',
      ].some((keyword) => combined.includes(keyword.toLowerCase()));
    });

    if (mediaButton) {
      mediaButton.click();
      await sleep(POSTING_TIMING.mediaButtonDelayMs);
      input = await waitForValue(() => findDialogFileInput() ?? findAnyFileInput(), POSTING_TIMING.mediaInputTimeoutMs);
    }
  }

  if (!input) {
    throw new Error('Could not find Facebook media upload input');
  }

  console.log('[PostFlow] Setting Facebook media input files:', input.getAttribute('accept') ?? 'no accept attr');
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  for (const type of ['dragenter', 'dragover', 'drop']) {
    dialog.dispatchEvent(new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  }

  const attached = await waitForCondition(() => {
    const text = ((dialog as HTMLElement).innerText ?? '').toLowerCase();
    const images = Array.from(dialog.querySelectorAll<HTMLImageElement>('img'));
    const hasPreviewImage = images.some((image) => {
      const src = image.currentSrc || image.src || '';
      const alt = image.alt.toLowerCase();
      return src.startsWith('blob:') || src.startsWith('data:') || alt.includes('photo') || alt.includes('image');
    });
    return hasPreviewImage ||
      text.includes('photos/videos') ||
      text.includes('photo/video') ||
      text.includes('edit all') ||
      text.includes('add photos') ||
      text.includes('صورة') ||
      text.includes('صور');
  }, POSTING_TIMING.mediaPreviewTimeoutMs, POSTING_TIMING.mediaPreviewPollIntervalMs);

  if (!attached) {
    throw new Error('Facebook did not show the selected media in the composer');
  }

  console.log('[PostFlow] Media attached');
}

async function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return check();
}

async function waitForValue<T>(check: () => T | null, timeoutMs: number, intervalMs = 100): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await sleep(intervalMs);
  }
  return check();
}

function waitForCreatePostDialog(timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const editorSelector = [
      'div[data-lexical-editor="true"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      'textarea',
    ].join(', ');

    const isVisible = (element: Element) => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    };

    const isInsideArticle = (element: Element) => Boolean(element.closest('[role="article"]'));
    const isLikelyComposerEditor = (element: Element) => {
      if (!isVisible(element) || isInsideArticle(element)) return false;
      const node = element as HTMLElement;
      const combined = [
        node.getAttribute('aria-label'),
        node.getAttribute('aria-placeholder'),
        node.getAttribute('placeholder'),
        node.getAttribute('data-lexical-editor'),
        node.textContent,
      ].filter(Boolean).join(' ').toLowerCase();

      if (node.getAttribute('data-lexical-editor') === 'true') return true;
      if (node.getAttribute('contenteditable') === 'true' && node.getAttribute('role') === 'textbox') return true;
      return [
        'write something',
        "what's on your mind",
        'create a post',
        'post',
      ].some((keyword) => combined.includes(keyword));
    };

    const findUsefulSurfaceForEditor = (editor: Element) => {
      const postButtonSelector = [
        '[aria-label="Post"]',
        '[aria-label="Publier"]',
        '[aria-label="Postar"]',
        '[role="button"]',
        'button',
      ].join(', ');

      let current = editor.parentElement;
      while (current && current !== document.body) {
        const hasPostButton = Array.from(current.querySelectorAll<HTMLElement>(postButtonSelector)).some((candidate) => {
          const text = (candidate.textContent ?? '').trim().toLowerCase();
          const label = (candidate.getAttribute('aria-label') ?? '').trim().toLowerCase();
          return ['post', 'publier', 'postar'].some((keyword) => text === keyword || label === keyword);
        });
        if (hasPostButton) return current;
        current = current.parentElement;
      }

      return editor.closest('[role="main"]') ?? editor.parentElement;
    };

    const check = () => {
      // Prefer the modal, because its Post button and editor belong together.
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"], [aria-modal="true"]'));
      const dialog = dialogs.find(d => Array.from(d.querySelectorAll(editorSelector)).some(isLikelyComposerEditor));
      if (dialog) return dialog;

      // Fallback for the newer inline group composer. Return its nearest useful
      // container so the existing editor/media/button lookup remains scoped.
      const inline = document.querySelector<HTMLElement>('[data-pagelet="GroupInlineComposer"]');
      const inlineEditor = inline && Array.from(inline.querySelectorAll(editorSelector)).find(isLikelyComposerEditor);
      if (inlineEditor) return inline;

      // Facebook sometimes mounts the opened composer in a sibling pagelet
      // instead of a dialog or GroupInlineComposer, especially after several
      // group pages have been opened in the same tab.
      const main = document.querySelector<HTMLElement>('[role="main"]') ?? document.body;
      const looseEditor = Array.from(main.querySelectorAll(editorSelector)).find(isLikelyComposerEditor);
      if (looseEditor) return findUsefulSurfaceForEditor(looseEditor);

      return null;
    };

    const found = check();
    if (found) {
      resolve(found);
      return;
    }

    const obs = new MutationObserver(() => {
      const el = check();
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

// Simple helper to wait for an element
function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    // Basic jQuery-like pseudo-selector handling for :has and :contains
    // Since document.querySelector doesn't support :contains, we do a manual check if needed.
    // For simplicity, we'll try a manual approach for the write button:
    const check = () => {
      if (selector.includes(':contains("Write something")')) {
        const spans = Array.from(document.querySelectorAll('span'));
        const span = spans.find(s => s.textContent?.includes('Write something'));
        if (span) {
          // Find closest role="button" parent
          let el: HTMLElement | null = span;
          while (el && el.getAttribute('role') !== 'button') {
            el = el.parentElement;
          }
          if (el) return el;
        }
        return null;
      }

      return document.querySelector(selector);
    };

    let el = check();
    if (el) {
      return resolve(el);
    }

    const observer = new MutationObserver(() => {
      el = check();
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}
